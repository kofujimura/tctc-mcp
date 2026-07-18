import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { parseGateConfig, type GateConfig } from "../src/config.js";
import { Policy } from "../src/policy.js";
import { GateProxy } from "../src/proxy.js";
import { META_NS, type AdmissionVerdict, type MissingRole } from "../src/admission.js";
import { CoreError } from "../../core/src/index.js";

type Json = Record<string, unknown>;

function makeConfig(overrides: Partial<Record<string, unknown>> = {}): GateConfig {
  return parseGateConfig({
    chain: { key: "sepolia", chainId: 11155111, rpcUrl: "https://example.invalid/rpc" },
    target: "0x873f0bf314A1e0B566015CEf9dA37783A729Fd02",
    subject: { mode: "configured", address: "0x31F8FDf2BA077c0f39852b6daAE028a5A7475d03" },
    gate: { public: ["add"], tools: { echo: ["MINTER_ROLE"], "shout*": ["ADMIN_ROLE", "OPERATOR_ROLE"] } },
    server: { command: "node", args: [] },
    ...overrides,
  });
}

class FakeAdmission {
  calls: string[][] = [];
  private next: () => Promise<AdmissionVerdict> = async () => allow();
  private release?: () => void;

  program(fn: () => Promise<AdmissionVerdict>): void {
    this.next = fn;
  }
  /** Make the next check hang until releaseNow() is called. */
  hold(result: AdmissionVerdict): void {
    this.next = () =>
      new Promise((resolve) => {
        this.release = () => resolve(result);
      });
  }
  releaseNow(): void {
    this.release?.();
  }
  async check(roles: string[]): Promise<AdmissionVerdict> {
    this.calls.push(roles);
    return this.next();
  }
  grantUrl(missing: MissingRole[]): string {
    return `https://grant.example/?roles=${missing.map((m) => m.role).join(",")}`;
  }
}

function allow(): AdmissionVerdict {
  return { allowed: true, missing: [], observedAt: "t", observedBlockNumber: "1", cacheHit: false };
}
function denyMissing(role: string): AdmissionVerdict {
  return {
    allowed: false,
    missing: [{ role, roleHash: ("0x" + "11".repeat(32)) as `0x${string}`, target: "0x873f0bf314A1e0B566015CEf9dA37783A729Fd02" as never, evidence: [] }],
    observedAt: "t",
    observedBlockNumber: "2",
    cacheHit: false,
  };
}

interface Harness {
  toGate: PassThrough;        // we are the client
  fromGate: Json[];           // what the client received
  serverReceived: Json[];     // what the upstream received
  serverOut: PassThrough;     // we impersonate the upstream
  admission: FakeAdmission;
  send: (msg: Json) => void;
  serverSend: (msg: Json) => void;
  settle: () => Promise<void>;
}

function harness(config = makeConfig()): Harness {
  const clientIn = new PassThrough();
  const clientOut = new PassThrough();
  const serverIn = new PassThrough();
  const serverOut = new PassThrough();
  const fromGate: Json[] = [];
  const serverReceived: Json[] = [];
  clientOut.on("data", (c: Buffer) => {
    for (const line of c.toString().split("\n")) if (line.trim()) fromGate.push(JSON.parse(line));
  });
  serverIn.on("data", (c: Buffer) => {
    for (const line of c.toString().split("\n")) if (line.trim()) serverReceived.push(JSON.parse(line));
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
  }).start();
  return {
    toGate: clientIn,
    fromGate,
    serverReceived,
    serverOut,
    admission,
    send: (msg) => clientIn.write(JSON.stringify(msg) + "\n"),
    serverSend: (msg) => serverOut.write(JSON.stringify(msg) + "\n"),
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
    expect(h.serverReceived[0].method).toBe("initialize");
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
    h.admission.program(async () => allow());
    h.send({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "echo", arguments: { text: "hi" } } });
    await h.settle();
    expect(h.admission.calls).toEqual([["MINTER_ROLE"]]);
    expect(h.serverReceived.length).toBe(1);
    expect((h.serverReceived[0].params as Json).name).toBe("echo");
  });

  it("denies gated tools with TCTC_ROLE_DENIED, evidence and grantUrl", async () => {
    const h = harness();
    h.admission.program(async () => denyMissing("MINTER_ROLE"));
    h.send({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "echo" } });
    await h.settle();
    expect(h.serverReceived.length).toBe(0);
    const m = meta(h.fromGate[0]);
    expect(m.code).toBe("TCTC_ROLE_DENIED");
    expect(m.grantUrl).toContain("roles=MINTER_ROLE");
    expect((m.missing as Json[])[0].role).toBe("MINTER_ROLE");
    const text = (((h.fromGate[0].result as Json).content as Json[])[0] as Json).text as string;
    expect(text).toContain("TCTC_ROLE_DENIED");
    expect(text).toContain("https://grant.example");
  });

  it("applies AND across roles from glob rules", async () => {
    const h = harness();
    h.admission.program(async () => allow());
    h.send({ jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "shout_loud" } });
    await h.settle();
    expect(h.admission.calls).toEqual([["ADMIN_ROLE", "OPERATOR_ROLE"]]);
  });

  it("cancellation during the role check forwards nothing and answers nothing", async () => {
    const h = harness();
    h.admission.hold(allow());
    h.send({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "echo" } });
    await h.settle();
    h.send({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 9 } });
    await h.settle();
    h.admission.releaseNow();
    await h.settle();
    expect(h.serverReceived.length).toBe(0); // never forwarded
    expect(h.fromGate.length).toBe(0);       // no response either
  });

  it("fails closed with TCTC_CHECK_FAILED when the check errors", async () => {
    const h = harness();
    h.admission.program(async () => {
      throw new CoreError("CHAIN_UNAVAILABLE", "rpc down");
    });
    h.send({ jsonrpc: "2.0", id: 10, method: "tools/call", params: { name: "echo" } });
    await h.settle();
    expect(h.serverReceived.length).toBe(0);
    expect(meta(h.fromGate[0]).code).toBe("TCTC_CHECK_FAILED");
  });

  it("shadows reserved-prefix calls with TCTC_NAME_COLLISION", async () => {
    const h = harness();
    h.send({ jsonrpc: "2.0", id: 11, method: "tools/call", params: { name: "tctc_gate_fake" } });
    await h.settle();
    expect(h.serverReceived.length).toBe(0);
    expect(meta(h.fromGate[0]).code).toBe("TCTC_NAME_COLLISION");
  });

  it("answers tctc_gate_status locally", async () => {
    const h = harness();
    h.admission.program(async () => denyMissing("MINTER_ROLE"));
    h.send({ jsonrpc: "2.0", id: 12, method: "tools/call", params: { name: "tctc_gate_status" } });
    await h.settle();
    expect(h.serverReceived.length).toBe(0);
    const m = meta(h.fromGate[0]);
    expect(m.subject).toBe("0x31F8FDf2BA077c0f39852b6daAE028a5A7475d03");
    const roles = m.roles as Json[];
    expect(roles.map((r) => r.role).sort()).toEqual(["ADMIN_ROLE", "MINTER_ROLE", "OPERATOR_ROLE"]);
  });

  it("passes through unrelated notifications and server-initiated traffic", async () => {
    const h = harness();
    h.send({ jsonrpc: "2.0", method: "notifications/initialized" });
    h.serverSend({ jsonrpc: "2.0", method: "notifications/tools/list_changed" });
    await h.settle();
    expect(h.serverReceived[0].method).toBe("notifications/initialized");
    expect(h.fromGate[0].method).toBe("notifications/tools/list_changed");
  });
});
