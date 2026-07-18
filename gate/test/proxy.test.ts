import { PassThrough } from "node:stream";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseGateConfig, type GateConfig } from "../src/config.js";
import { Policy } from "../src/policy.js";
import { GateProxy } from "../src/proxy.js";
import { META_NS, type AdmissionVerdict, type RoleObservation } from "../src/admission.js";
import { CoreError, roleHash } from "../../core/src/index.js";

type Json = Record<string, unknown>;

function makeConfig(overrides: Partial<Record<string, unknown>> = {}): GateConfig {
  return parseGateConfig({
    chain: { key: "sepolia", chainId: 11155111, rpcUrl: "https://rpc.example/v2/SECRETKEY" },
    target: "0x873f0bf314A1e0B566015CEf9dA37783A729Fd02",
    subject: { mode: "configured", address: "0x31F8FDf2BA077c0f39852b6daAE028a5A7475d03" },
    gate: { public: ["add"], tools: { echo: ["MINTER_ROLE"], "shout*": ["ADMIN_ROLE", "OPERATOR_ROLE"] } },
    server: { command: "node", args: [] },
    ...overrides,
  });
}

function obs(role: string, held: boolean, extra: Partial<RoleObservation> = {}): RoleObservation {
  return {
    role,
    roleHash: roleHash(role),
    held,
    evidence: [{ standard: "erc1155", contract: "0x12342A7F0190B3AF3F4b47546D34006EDA54eE0B" as never, typeId: "1", balanceOf: held ? "1" : "0" }],
    observedAt: "2026-07-18T00:00:00Z",
    observedBlockNumber: "100",
    cacheHit: false,
    ...extra,
  };
}

function verdictFor(roles: string[], missingRoles: string[] = []): AdmissionVerdict {
  const observations = roles.map((r) => obs(r, !missingRoles.includes(r)));
  const missing = observations.filter((o) => !o.held);
  return {
    allowed: missing.length === 0,
    roles: observations,
    missing,
    observedAt: "2026-07-18T00:00:00Z",
    observedBlockNumber: "100",
    cacheHit: false,
  };
}

class FakeAdmission {
  calls: string[][] = [];
  private next: (roles: string[]) => Promise<AdmissionVerdict> = async (roles) => verdictFor(roles);
  private release?: () => void;

  program(fn: (roles: string[]) => Promise<AdmissionVerdict>): void {
    this.next = fn;
  }
  /** Make the NEXT check hang until releaseNow() (later checks resolve normally). */
  holdOnce(): void {
    const prev = this.next;
    let used = false;
    this.next = (roles) => {
      if (used) return prev(roles);
      used = true;
      return new Promise((resolve) => {
        this.release = () => resolve(verdictFor(roles));
      });
    };
  }
  releaseNow(): void {
    this.release?.();
  }
  async check(roles: string[]): Promise<AdmissionVerdict> {
    this.calls.push(roles);
    return this.next(roles);
  }
  grantUrl(missing: { role: string }[]): string {
    return `https://grant.example/?roles=${missing.map((m) => m.role).join(",")}`;
  }
}

interface Harness {
  fromGate: Json[];
  fromGateRaw: string[];
  serverReceived: unknown[];
  serverReceivedRaw: string[];
  admission: FakeAdmission;
  logs: string[];
  send: (msg: Json) => void;
  sendRaw: (raw: string | Buffer) => void;
  serverSend: (msg: Json) => void;
  serverSendRaw: (raw: string | Buffer) => void;
  settle: () => Promise<void>;
}

function harness(config = makeConfig()): Harness {
  const clientIn = new PassThrough();
  const clientOut = new PassThrough();
  const serverIn = new PassThrough();
  const serverOut = new PassThrough();
  const fromGate: Json[] = [];
  const fromGateRaw: string[] = [];
  const serverReceived: unknown[] = [];
  const serverReceivedRaw: string[] = [];
  const logs: string[] = [];
  clientOut.on("data", (c: Buffer) => {
    for (const line of c.toString().split("\n")) if (line.trim()) {
      fromGateRaw.push(line);
      fromGate.push(JSON.parse(line));
    }
  });
  serverIn.on("data", (c: Buffer) => {
    for (const line of c.toString().split("\n")) if (line.trim()) {
      serverReceivedRaw.push(line);
      serverReceived.push(JSON.parse(line));
    }
  });
  const admission = new FakeAdmission();
  new GateProxy({
    config,
    policy: new Policy(config),
    admission,
    clientIn,
    clientOut,
    serverIn,
    serverOut,
    log: (l) => logs.push(l),
  }).start();
  return {
    fromGate,
    fromGateRaw,
    serverReceived,
    serverReceivedRaw,
    admission,
    logs,
    send: (msg) => clientIn.write(JSON.stringify(msg) + "\n"),
    sendRaw: (raw) => clientIn.write(raw),
    serverSend: (msg) => serverOut.write(JSON.stringify(msg) + "\n"),
    serverSendRaw: (raw) => serverOut.write(raw),
    settle: () => new Promise((r) => setTimeout(r, 20)),
  };
}

function meta(msg: Json): Json {
  return ((msg.result as Json)._meta as Json)[META_NS] as Json;
}

describe("GateProxy", () => {
  it("decorates initialize: name suffix, instructions, tools capability", async () => {
    const h = harness();
    h.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });
    await h.settle();
    expect((h.serverReceived[0] as Json).method).toBe("initialize");
    h.serverSend({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "mini", version: "1" }, instructions: "hello" } });
    await h.settle();
    const result = h.fromGate[0].result as Json;
    expect((result.serverInfo as Json).name).toBe("mini (tctc-gated)");
    expect(result.instructions).toContain("hello");
    expect(result.instructions).toContain("tctc-gate");
    expect((result.capabilities as Json).tools).toBeDefined();
  });

  it("appends gate tools only on the first page and annotates gated tools", async () => {
    const h = harness();
    h.send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    await h.settle();
    h.serverSend({ jsonrpc: "2.0", id: 2, result: { tools: [{ name: "echo", description: "echo" }, { name: "add", description: "add" }], nextCursor: "p2" } });
    await h.settle();
    const p1 = (h.fromGate[0].result as Json).tools as Json[];
    expect(p1.map((t) => t.name)).toEqual(["echo", "add", "tctc_gate_status"]);
    expect(p1[0].description).toContain("requires MINTER_ROLE");
    expect(p1[1].description).toBe("add"); // public → untouched

    h.send({ jsonrpc: "2.0", id: 3, method: "tools/list", params: { cursor: "p2" } });
    await h.settle();
    h.serverSend({ jsonrpc: "2.0", id: 3, result: { tools: [{ name: "shout", description: "shout" }, { name: "tctc_gate_fake", description: "squat" }] } });
    await h.settle();
    const p2 = (h.fromGate[1].result as Json).tools as Json[];
    expect(p2.map((t) => t.name)).toEqual(["shout"]); // squatter shadowed, no duplicate gate tools
    expect(p2[0].description).toContain("ADMIN_ROLE AND OPERATOR_ROLE");
  });

  it("forwards public tools without admission checks", async () => {
    const h = harness();
    h.send({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "add", arguments: { a: 1, b: 2 } } });
    await h.settle();
    expect(h.serverReceived.length).toBe(1);
    expect(h.admission.calls.length).toBe(0);
    h.serverSend({ jsonrpc: "2.0", id: 4, result: { content: [{ type: "text", text: "3" }] } });
    await h.settle();
    expect((h.fromGate[0].result as Json).content).toEqual([{ type: "text", text: "3" }]);
  });

  it("denies unmapped tools with TCTC_TOOL_UNMAPPED and no grantUrl", async () => {
    const h = harness();
    h.send({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "mystery" } });
    await h.settle();
    expect(h.serverReceived.length).toBe(0);
    const m = meta(h.fromGate[0]);
    expect(m.code).toBe("TCTC_TOOL_UNMAPPED");
    expect(m.grantUrl).toBeUndefined();
    expect((h.fromGate[0].result as Json).isError).toBe(true);
  });

  it("forwards gated tools when admission allows", async () => {
    const h = harness();
    h.send({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "echo", arguments: { text: "hi" } } });
    await h.settle();
    expect(h.admission.calls).toEqual([["MINTER_ROLE"]]);
    expect(h.serverReceived.length).toBe(1);
    expect(((h.serverReceived[0] as Json).params as Json).name).toBe("echo");
  });

  it("denies gated tools with TCTC_ROLE_DENIED, per-role evidence and grantUrl", async () => {
    const h = harness();
    h.admission.program(async (roles) => verdictFor(roles, ["MINTER_ROLE"]));
    h.send({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "echo" } });
    await h.settle();
    expect(h.serverReceived.length).toBe(0);
    const m = meta(h.fromGate[0]);
    expect(m.code).toBe("TCTC_ROLE_DENIED");
    expect(m.grantUrl).toContain("roles=MINTER_ROLE");
    const missing = m.missing as Json[];
    expect(missing[0].role).toBe("MINTER_ROLE");
    expect(missing[0].target).toBe("0x873f0bf314A1e0B566015CEf9dA37783A729Fd02");
    expect(missing[0].observedBlockNumber).toBe("100"); // per-role observation
    const text = (((h.fromGate[0].result as Json).content as Json[])[0] as Json).text as string;
    expect(text).toContain("TCTC_ROLE_DENIED");
    expect(text).toContain("https://grant.example");
  });

  it("applies AND across roles from glob rules", async () => {
    const h = harness();
    h.send({ jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "shout_loud" } });
    await h.settle();
    expect(h.admission.calls).toEqual([["ADMIN_ROLE", "OPERATOR_ROLE"]]);
  });

  it("cancellation during the role check forwards nothing and answers nothing", async () => {
    const h = harness();
    h.admission.holdOnce();
    h.send({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "echo" } });
    await h.settle();
    h.send({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 9 } });
    await h.settle();
    h.admission.releaseNow();
    await h.settle();
    expect(h.serverReceived.length).toBe(0); // never forwarded
    expect(h.fromGate.length).toBe(0);       // no response either
  });

  it("id reuse: a stale in-flight check cannot settle a newer request", async () => {
    const h = harness();
    h.admission.holdOnce(); // first check for id 9 hangs
    h.send({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "echo", arguments: { n: 1 } } });
    await h.settle();
    // client (illegally but observably) reuses id 9 — second check resolves
    h.send({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "echo", arguments: { n: 2 } } });
    await h.settle();
    expect(h.serverReceived.length).toBe(1); // the second call, forwarded
    expect((((h.serverReceived[0] as Json).params as Json).arguments as Json).n).toBe(2);
    h.admission.releaseNow(); // stale flight resolves late…
    await h.settle();
    expect(h.serverReceived.length).toBe(1); // …and must not forward again
  });

  it("fails closed with TCTC_CHECK_FAILED and never leaks RPC details to the client", async () => {
    const h = harness();
    h.admission.program(async () => {
      throw new CoreError("CHAIN_UNAVAILABLE", "getBlockNumber failed: request to https://rpc.example/v2/SECRETKEY denied");
    });
    h.send({ jsonrpc: "2.0", id: 10, method: "tools/call", params: { name: "echo" } });
    await h.settle();
    expect(h.serverReceived.length).toBe(0);
    expect(meta(h.fromGate[0]).code).toBe("TCTC_CHECK_FAILED");
    const wire = h.fromGateRaw.join("\n");
    expect(wire).not.toContain("SECRETKEY");
    expect(wire).not.toContain("rpc.example");
    // masked detail goes to the gate's own log
    expect(h.logs.join("\n")).toContain("[rpc]");
    expect(h.logs.join("\n")).not.toContain("SECRETKEY");
  });

  it("shadows reserved-prefix calls with TCTC_NAME_COLLISION", async () => {
    const h = harness();
    h.send({ jsonrpc: "2.0", id: 11, method: "tools/call", params: { name: "tctc_gate_fake" } });
    await h.settle();
    expect(h.serverReceived.length).toBe(0);
    expect(meta(h.fromGate[0]).code).toBe("TCTC_NAME_COLLISION");
  });

  it("answers tctc_gate_status locally with evidence for held roles too", async () => {
    const h = harness();
    h.admission.program(async (roles) => verdictFor(roles, ["MINTER_ROLE"])); // others held
    h.send({ jsonrpc: "2.0", id: 12, method: "tools/call", params: { name: "tctc_gate_status" } });
    await h.settle();
    expect(h.serverReceived.length).toBe(0);
    const m = meta(h.fromGate[0]);
    expect(m.subject).toBe("0x31F8FDf2BA077c0f39852b6daAE028a5A7475d03");
    const roles = m.roles as Json[];
    expect(roles.map((r) => r.role).sort()).toEqual(["ADMIN_ROLE", "MINTER_ROLE", "OPERATOR_ROLE"]);
    const heldRole = roles.find((r) => r.held === true)!;
    expect(heldRole.evidence).toBeDefined(); // held roles carry evidence too
    expect((heldRole.evidence as Json[])[0].balanceOf).toBe("1");
  });

  it("preserves multi-byte UTF-8 split across chunk boundaries (both directions)", async () => {
    const h = harness();
    const note = JSON.stringify({ jsonrpc: "2.0", method: "notifications/message", params: { text: "日本語🎫テスト" } }) + "\n";
    const bytes = Buffer.from(note, "utf8");
    // client → server: write one byte at a time (worst case)
    for (let i = 0; i < bytes.length; i++) h.sendRaw(bytes.subarray(i, i + 1));
    await h.settle();
    expect(((h.serverReceived[0] as Json).params as Json).text).toBe("日本語🎫テスト");
    // server → client: split inside the emoji
    const mid = Math.floor(bytes.length / 2);
    h.serverSendRaw(bytes.subarray(0, mid));
    await h.settle();
    h.serverSendRaw(bytes.subarray(mid));
    await h.settle();
    expect((h.fromGate[0].params as Json).text).toBe("日本語🎫テスト");
  });

  it("forwards valid-JSON non-object lines verbatim without crashing", async () => {
    const h = harness();
    h.sendRaw("null\n");
    h.sendRaw("42\n");
    h.serverSendRaw('"hello"\n');
    await h.settle();
    expect(h.serverReceivedRaw).toEqual(["null", "42"]);
    expect(h.fromGateRaw).toEqual(['"hello"']);
    // and the proxy still works afterwards
    h.send({ jsonrpc: "2.0", id: 13, method: "tools/call", params: { name: "add" } });
    await h.settle();
    expect(h.serverReceived.length).toBe(3);
  });

  it("audits every decision, including public forwards with forwardedMs", async () => {
    const auditPath = join(mkdtempSync(join(tmpdir(), "tctc-gate-audit-")), "audit.jsonl");
    const h = harness(makeConfig({ audit: auditPath }));
    h.send({ jsonrpc: "2.0", id: 14, method: "tools/call", params: { name: "add" } });
    await h.settle();
    h.serverSend({ jsonrpc: "2.0", id: 14, result: { content: [{ type: "text", text: "ok" }] } });
    h.send({ jsonrpc: "2.0", id: 15, method: "tools/call", params: { name: "mystery" } });
    await h.settle();
    await new Promise((r) => setTimeout(r, 50));
    expect(existsSync(auditPath)).toBe(true);
    const lines = readFileSync(auditPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    const pub = lines.find((l) => l.code === "PUBLIC");
    expect(pub.verdict).toBe("allow");
    expect(typeof pub.forwardedMs).toBe("number");
    expect(lines.find((l) => l.code === "TCTC_TOOL_UNMAPPED")).toBeDefined();
  });

  it("passes through unrelated notifications and server-initiated traffic", async () => {
    const h = harness();
    h.send({ jsonrpc: "2.0", method: "notifications/initialized" });
    h.serverSend({ jsonrpc: "2.0", method: "notifications/tools/list_changed" });
    await h.settle();
    expect((h.serverReceived[0] as Json).method).toBe("notifications/initialized");
    expect(h.fromGate[0].method).toBe("notifications/tools/list_changed");
  });
});
