import { describe, expect, it } from "vitest";
import { buildChildEnv, parseGateConfig, globsIntersect, ConfigError } from "../src/config.js";

const ROLE_HASH = "0x" + "ab".repeat(32);

function base(): Record<string, unknown> {
  return {
    chain: { key: "sepolia", chainId: 11155111, rpcUrl: "https://example.invalid/rpc" },
    target: "0x873f0bf314A1e0B566015CEf9dA37783A729Fd02",
    subject: { mode: "configured", address: "0x31F8FDf2BA077c0f39852b6daAE028a5A7475d03" },
    gate: { public: ["echo"], tools: { write_file: ["MINTER_ROLE"] } },
    server: { command: "node", args: ["server.mjs"] },
  };
}

describe("parseGateConfig", () => {
  it("accepts a minimal valid config with defaults", () => {
    const c = parseGateConfig(base());
    expect(c.cache.allowSeconds).toBe(0);
    expect(c.cache.denySeconds).toBe(10);
    expect(c.listMode).toBe("annotate");
    expect(c.server.inherit).toEqual(["PATH", "HOME"]);
  });

  it("rejects empty role lists (empty AND would be unconditional allow)", () => {
    const raw = base();
    (raw.gate as Record<string, unknown>).tools = { write_file: [] };
    expect(() => parseGateConfig(raw)).toThrow(ConfigError);
  });

  it("accepts 32-byte role hashes in role positions", () => {
    const raw = base();
    (raw.gate as Record<string, unknown>).tools = { dangerous: [ROLE_HASH] };
    expect(() => parseGateConfig(raw)).not.toThrow();
  });

  it("rejects 32-byte hex anywhere else", () => {
    const raw = base();
    (raw as Record<string, unknown>).audit = ROLE_HASH;
    expect(() => parseGateConfig(raw)).toThrow(/only role positions/);
  });

  it("rejects literal values in server.env", () => {
    const raw = base();
    (raw.server as Record<string, unknown>).env = { API_KEY: "sk-live-abcdef" };
    expect(() => parseGateConfig(raw)).toThrow(/\$\{ENV_NAME\}/);
  });

  it("accepts ${ENV} references in server.env and resolves them at spawn", () => {
    const raw = base();
    (raw.server as Record<string, unknown>).env = { API_KEY: "${UPSTREAM_KEY}" };
    const c = parseGateConfig(raw);
    const env = buildChildEnv(c, { PATH: "/bin", UPSTREAM_KEY: "s3cr3t" });
    expect(env.API_KEY).toBe("s3cr3t");
    expect(env.PATH).toBe("/bin");
    expect(Object.keys(env).sort()).toEqual(["API_KEY", "PATH"]); // nothing else inherited
  });

  it("fails at spawn when a referenced env var is missing", () => {
    const raw = base();
    (raw.server as Record<string, unknown>).env = { API_KEY: "${MISSING_VAR}" };
    const c = parseGateConfig(raw);
    expect(() => buildChildEnv(c, {})).toThrow(/MISSING_VAR/);
  });

  it("rejects a tool listed in both public and tools", () => {
    const raw = base();
    (raw.gate as Record<string, unknown>).tools = { echo: ["MINTER_ROLE"] };
    expect(() => parseGateConfig(raw)).toThrow(/both/);
  });

  it("rejects the reserved tctc_gate_ prefix in policy", () => {
    const raw = base();
    (raw.gate as Record<string, unknown>).tools = { tctc_gate_evil: ["MINTER_ROLE"] };
    expect(() => parseGateConfig(raw)).toThrow(/reserved/);
  });

  it("rejects equal-specificity overlapping globs at startup", () => {
    const raw = base();
    (raw.gate as Record<string, unknown>).tools = { "delete_*": ["A_ROLE"], "*_delete": ["B_ROLE"] };
    expect(() => parseGateConfig(raw)).toThrow(/equal specificity/);
  });

  it("allows overlapping globs of different specificity", () => {
    const raw = base();
    (raw.gate as Record<string, unknown>).tools = { "delete_*": ["A_ROLE"], "delete_all_*": ["B_ROLE"] };
    expect(() => parseGateConfig(raw)).not.toThrow();
  });
});

describe("globsIntersect", () => {
  it("detects overlap", () => {
    expect(globsIntersect("delete_*", "*_dangerous")).toBe(true);
    expect(globsIntersect("a*", "*b")).toBe(true);
    expect(globsIntersect("exact", "exact")).toBe(true);
  });
  it("detects disjoint patterns", () => {
    expect(globsIntersect("read_*", "write_*")).toBe(false);
    expect(globsIntersect("a", "b")).toBe(false);
  });
});
