import type { Readable, Writable } from "node:stream";
import { appendFile } from "node:fs";
import type { GateConfig } from "./config.js";
import type { Policy } from "./policy.js";
import { denyResult, META_NS, type AdmissionVerdict, type MissingRole } from "./admission.js";
import { isCoreUnavailable } from "./admission.js";

type Json = Record<string, unknown>;

/** What the proxy needs from the admission layer (injectable for tests). */
export interface AdmissionLike {
  check(roles: string[]): Promise<AdmissionVerdict>;
  grantUrl(missing: MissingRole[]): string;
}

const GATE_TOOLS = [
  {
    name: "tctc_gate_status",
    description:
      "tctc-gate self-check: bound subject, every configured role with its current on-chain verdict and balance evidence, cache state. Read-only; does not touch the wrapped server.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
];

/**
 * Newline-delimited JSON-RPC splitter (MCP stdio framing). Unparsable lines
 * are forwarded verbatim: the gate only interprets what it must, and a
 * malformed line is the wrapped server's error to report, not ours to eat.
 */
function lineSplitter(onLine: (line: string) => void): (chunk: Buffer) => void {
  let buffer = "";
  return (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
    let idx: number;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx).replace(/\r$/, "");
      buffer = buffer.slice(idx + 1);
      if (line.trim() !== "") onLine(line);
    }
  };
}

export interface GateProxyOptions {
  config: GateConfig;
  policy: Policy;
  admission: AdmissionLike;
  clientIn: Readable;   // from the MCP client (agent)
  clientOut: Writable;  // to the MCP client
  serverIn: Writable;   // to the wrapped server (its stdin)
  serverOut: Readable;  // from the wrapped server (its stdout)
  log?: (line: string) => void; // human diagnostics (stderr)
}

export class GateProxy {
  private pendingInitialize = new Set<string | number>();
  private pendingToolsList = new Map<string | number, { firstPage: boolean }>();
  /** tools/call requests whose admission check is still running. */
  private inFlightChecks = new Map<string | number, { cancelled: boolean }>();

  constructor(private readonly o: GateProxyOptions) {}

  start(): void {
    this.o.clientIn.on("data", lineSplitter((line) => this.fromClient(line)));
    this.o.serverOut.on("data", lineSplitter((line) => this.fromServer(line)));
  }

  // ---------- client → server ----------

  private fromClient(line: string): void {
    let msg: Json;
    try {
      msg = JSON.parse(line) as Json;
    } catch {
      this.o.serverIn.write(line + "\n");
      return;
    }
    const method = msg.method as string | undefined;
    const id = msg.id as string | number | undefined;

    if (method === undefined) {
      // response from client to a server-initiated request — pass through
      this.forwardToServer(msg);
      return;
    }

    if (id !== undefined) {
      // request
      if (method === "initialize") {
        this.pendingInitialize.add(id);
        this.forwardToServer(msg);
        return;
      }
      if (method === "tools/list") {
        const params = (msg.params ?? {}) as Json;
        this.pendingToolsList.set(id, { firstPage: params.cursor === undefined });
        this.forwardToServer(msg);
        return;
      }
      if (method === "tools/call") {
        this.handleToolsCall(msg, id);
        return;
      }
      this.forwardToServer(msg);
      return;
    }

    // notification
    if (method === "notifications/cancelled") {
      const rid = ((msg.params ?? {}) as Json).requestId as string | number | undefined;
      if (rid !== undefined && this.inFlightChecks.has(rid)) {
        // The wrapped server never saw this request: abort the check,
        // forward nothing, respond nothing (GATE_SPEC §5.3).
        this.inFlightChecks.get(rid)!.cancelled = true;
        return;
      }
    }
    this.forwardToServer(msg);
  }

  private handleToolsCall(msg: Json, id: string | number): void {
    const params = (msg.params ?? {}) as Json;
    const name = String(params.name ?? "");

    if (name === "tctc_gate_status") {
      void this.answerGateStatus(id);
      return;
    }
    if (name.startsWith("tctc_gate_")) {
      this.respond(id, denyResult("TCTC_NAME_COLLISION", name, this.o.config, {
        text: `TCTC_NAME_COLLISION: "${name}" is in tctc-gate's reserved namespace; the wrapped server's tool of this name is shadowed.`,
      }));
      return;
    }

    const resolution = this.o.policy.resolve(name);
    if (resolution.kind === "public") {
      this.forwardToServer(msg);
      return;
    }
    if (resolution.kind === "unmapped") {
      // No grantUrl: no role would help — the fix is a config change (§5.3).
      this.respond(id, denyResult("TCTC_TOOL_UNMAPPED", name, this.o.config, {
        text: `TCTC_TOOL_UNMAPPED: "${name}" has no policy entry and tctc-gate denies by default. The principal must map it in gate.tools (or gate.public) to make it callable.`,
      }));
      this.audit({ tool: name, verdict: "deny", code: "TCTC_TOOL_UNMAPPED" });
      return;
    }

    const flight = { cancelled: false };
    this.inFlightChecks.set(id, flight);
    void this.o.admission
      .check(resolution.roles)
      .then((verdict) => {
        this.inFlightChecks.delete(id);
        if (flight.cancelled) return; // aborted: never forwarded, no response
        if (verdict.allowed) {
          this.audit({ tool: name, verdict: "allow", roles: resolution.roles, observedBlockNumber: verdict.observedBlockNumber, cacheHit: verdict.cacheHit });
          this.forwardToServer(msg);
          return;
        }
        const grantUrl = this.o.admission.grantUrl(verdict.missing);
        const missingNames = verdict.missing.map((m) => m.role).join(", ");
        this.respond(id, denyResult("TCTC_ROLE_DENIED", name, this.o.config, {
          text: `TCTC_ROLE_DENIED: ${name} requires ${missingNames} on ${this.o.config.target}. Ask your principal to grant it: ${grantUrl}`,
          missing: verdict.missing,
          observedAt: verdict.observedAt,
          observedBlockNumber: verdict.observedBlockNumber,
          cacheHit: verdict.cacheHit,
          cacheExpiresAt: verdict.cacheExpiresAt,
          grantUrl,
        }));
        this.audit({ tool: name, verdict: "deny", code: "TCTC_ROLE_DENIED", roles: resolution.roles, missing: verdict.missing.map((m) => m.role), observedBlockNumber: verdict.observedBlockNumber, cacheHit: verdict.cacheHit });
      })
      .catch((e) => {
        this.inFlightChecks.delete(id);
        if (flight.cancelled) return;
        const reason = isCoreUnavailable(e) ? (e as Error).message : `unexpected error: ${(e as Error).message}`;
        this.respond(id, denyResult("TCTC_CHECK_FAILED", name, this.o.config, {
          text: `TCTC_CHECK_FAILED: the role verdict is indeterminate (${reason}). tctc-gate fails closed.`,
        }));
        this.audit({ tool: name, verdict: "deny", code: "TCTC_CHECK_FAILED" });
      });
  }

  private async answerGateStatus(id: string | number): Promise<void> {
    const roles = this.o.policy.allRoles();
    try {
      const verdict = roles.length > 0 ? await this.o.admission.check(roles) : undefined;
      const held = roles.filter((r) => !verdict?.missing.some((m) => m.role === r));
      const meta = {
        subject: this.o.config.subject.address,
        identity: this.o.config.subject.mode,
        target: this.o.config.target,
        chainId: this.o.config.chain.chainId,
        roles: roles.map((r) => ({
          role: r,
          held: !verdict?.missing.some((m) => m.role === r),
          evidence: verdict?.missing.find((m) => m.role === r)?.evidence,
        })),
        observedAt: verdict?.observedAt,
        observedBlockNumber: verdict?.observedBlockNumber,
        cacheHit: verdict?.cacheHit,
        public: this.o.config.gate.public,
      };
      const text =
        `tctc-gate status — subject ${this.o.config.subject.address} (identity: configured) on ${this.o.config.target} ` +
        `(chainId ${this.o.config.chain.chainId}), block ${verdict?.observedBlockNumber ?? "n/a"}: ` +
        (roles.length === 0 ? "no roles configured." : `held: [${held.join(", ") || "none"}]; missing: [${verdict?.missing.map((m) => m.role).join(", ") || "none"}].`);
      this.respond(id, { content: [{ type: "text", text }], _meta: { [META_NS]: meta } });
    } catch (e) {
      this.respond(id, denyResult("TCTC_CHECK_FAILED", "tctc_gate_status", this.o.config, {
        text: `TCTC_CHECK_FAILED: ${(e as Error).message}`,
      }));
    }
  }

  // ---------- server → client ----------

  private fromServer(line: string): void {
    let msg: Json;
    try {
      msg = JSON.parse(line) as Json;
    } catch {
      this.o.clientOut.write(line + "\n");
      return;
    }
    const id = msg.id as string | number | undefined;
    if (id !== undefined && msg.method === undefined && this.pendingInitialize.has(id)) {
      this.pendingInitialize.delete(id);
      this.forwardToClient(this.decorateInitialize(msg));
      return;
    }
    const listMark = id !== undefined && msg.method === undefined ? this.pendingToolsList.get(id) : undefined;
    if (listMark) {
      this.pendingToolsList.delete(id!);
      this.forwardToClient(this.decorateToolsList(msg, listMark.firstPage));
      return;
    }
    this.forwardToClient(msg);
  }

  private decorateInitialize(msg: Json): Json {
    const result = msg.result as Json | undefined;
    if (!result) return msg;
    const serverInfo = (result.serverInfo ?? {}) as Json;
    if (typeof serverInfo.name === "string" && !serverInfo.name.endsWith(" (tctc-gated)")) {
      serverInfo.name = `${serverInfo.name} (tctc-gated)`;
    }
    result.serverInfo = serverInfo;
    const capabilities = (result.capabilities ?? {}) as Json;
    capabilities.tools = { ...((capabilities.tools ?? {}) as Json) };
    result.capabilities = capabilities;
    const gateNote =
      `This server is wrapped by tctc-gate: tools are token-gated by ERC-7303 roles on ` +
      `${this.o.config.target} (chainId ${this.o.config.chain.chainId}) for subject ` +
      `${this.o.config.subject.address}. Call tctc_gate_status for the current verdicts. ` +
      `Denied calls return code TCTC_ROLE_DENIED with a grant URL for your principal; do not retry without a new grant.`;
    result.instructions = typeof result.instructions === "string" && result.instructions.length > 0
      ? `${result.instructions}\n\n${gateNote}`
      : gateNote;
    return msg;
  }

  private decorateToolsList(msg: Json, firstPage: boolean): Json {
    const result = msg.result as Json | undefined;
    if (!result || !Array.isArray(result.tools)) return msg;
    let tools = result.tools as Json[];

    // Reserved-prefix shadowing (§5.2): never silently merge.
    const collisions = tools.filter((t) => String(t.name ?? "").startsWith("tctc_gate_"));
    if (collisions.length > 0) {
      for (const t of collisions) {
        this.o.log?.(`tctc-gate: upstream tool "${t.name}" uses the reserved prefix and is shadowed`);
        this.audit({ tool: String(t.name), verdict: "shadowed", code: "TCTC_NAME_COLLISION" });
      }
      tools = tools.filter((t) => !String(t.name ?? "").startsWith("tctc_gate_"));
    }

    if (this.o.config.listMode === "annotate") {
      tools = tools.map((t) => {
        const resolution = this.o.policy.resolve(String(t.name ?? ""));
        if (resolution.kind !== "gated") return t;
        const note = `[tctc-gate: requires ${resolution.roles.join(" AND ")} on ${this.o.config.target}]`;
        const description = typeof t.description === "string" && t.description.length > 0
          ? `${t.description}\n${note}`
          : note;
        return { ...t, description };
      });
    }

    if (firstPage) tools = [...tools, ...GATE_TOOLS];
    result.tools = tools;
    return msg;
  }

  // ---------- plumbing ----------

  private forwardToServer(msg: Json): void {
    this.o.serverIn.write(JSON.stringify(msg) + "\n");
  }

  private forwardToClient(msg: Json): void {
    this.o.clientOut.write(JSON.stringify(msg) + "\n");
  }

  private respond(id: string | number, result: unknown): void {
    this.forwardToClient({ jsonrpc: "2.0", id, result } as Json);
  }

  private audit(entry: Record<string, unknown>): void {
    if (!this.o.config.audit) return;
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      chainId: this.o.config.chain.chainId,
      target: this.o.config.target,
      subject: this.o.config.subject.address,
      ...entry,
    });
    appendFile(this.o.config.audit, line + "\n", () => {});
  }
}
