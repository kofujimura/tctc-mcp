import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, statSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  AGENT_KEY_VAR,
  DEFAULT_DASHBOARD_URL,
  buildDashboardLink,
  loadAgentIdentity,
  parseDotenv,
  sanitizeAgentName,
} from "../src/agent.js";
import { runAgentCommand } from "../src/agent-cli.js";
import { resolveSubject } from "../src/subject.js";
import { parseConfig } from "../src/config.js";
import { ConfigError } from "../src/errors.js";
import { BalanceCache, TtlCache, type Context } from "../src/context.js";

const KEY = ("0x" + "11".repeat(32)) as `0x${string}`;
const ADDRESS = privateKeyToAccount(KEY).address;
const ADMIN_KEY = "0x" + "22".repeat(32);

function dir(files: Record<string, string> = {}): string {
  const d = mkdtempSync(join(tmpdir(), "tctc-agent-"));
  for (const [name, body] of Object.entries(files)) writeFileSync(join(d, name), body);
  return d;
}

describe("parseDotenv", () => {
  it("handles comments, export, quotes, inline comments and CRLF", () => {
    const vars = parseDotenv(
      [
        "# comment",
        "export A=1",
        'B="two words" ',
        "C='x#y'",
        "D=plain # trailing",
        "E = spaced\r",
        "not a line",
      ].join("\n"),
    );
    expect(vars).toEqual({ A: "1", B: "two words", C: "x#y", D: "plain", E: "spaced" });
  });
});

describe("loadAgentIdentity", () => {
  it("returns undefined when no agent key is configured", () => {
    expect(loadAgentIdentity(dir(), {})).toBeUndefined();
  });

  it("reads the agent key from .env.local in the start folder", () => {
    const d = dir({ ".env.local": `${AGENT_KEY_VAR}=${KEY}\nTCTC_AGENT_NAME="Alice"\n` });
    const id = loadAgentIdentity(d, {})!;
    expect(id.address).toBe(ADDRESS);
    expect(id.name).toBe("Alice");
    expect(id.source).toBe(join(d, ".env.local"));
    expect(id.dashboardUrl).toBe(DEFAULT_DASHBOARD_URL);
  });

  it("accepts a key without the 0x prefix", () => {
    const d = dir({ ".env.local": `${AGENT_KEY_VAR}=${KEY.slice(2)}\n` });
    expect(loadAgentIdentity(d, {})!.address).toBe(ADDRESS);
  });

  it("lets the process environment win over .env.local", () => {
    const other = ("0x" + "33".repeat(32)) as `0x${string}`;
    const d = dir({ ".env.local": `${AGENT_KEY_VAR}=${other}\n` });
    const id = loadAgentIdentity(d, { [AGENT_KEY_VAR]: KEY })!;
    expect(id.address).toBe(ADDRESS);
    expect(id.source).toBe("environment");
  });

  it("never takes the admin key (or anything else) from .env.local", () => {
    const d = dir({ ".env.local": `TCTC_ADMIN_PRIVATE_KEY=${ADMIN_KEY}\nALCHEMY_API_KEY=x\n` });
    const env: NodeJS.ProcessEnv = {};
    expect(loadAgentIdentity(d, env)).toBeUndefined();
    expect(env.TCTC_ADMIN_PRIVATE_KEY).toBeUndefined();
  });

  it("rejects a malformed key without echoing it", () => {
    const bad = "0xdeadbeef";
    const d = dir({ ".env.local": `${AGENT_KEY_VAR}=${bad}\n` });
    let err: unknown;
    try {
      loadAgentIdentity(d, {});
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ConfigError);
    expect((err as Error).message).not.toContain(bad);
  });

  it("strips control characters from the display name", () => {
    expect(sanitizeAgentName("Ali\nce\u0007")).toBe("Ali ce");
    expect(sanitizeAgentName("   ")).toBeUndefined();
    expect(sanitizeAgentName("x".repeat(100))!.length).toBe(64);
  });
});

describe("buildDashboardLink", () => {
  it("produces a signed URL that never contains the key", async () => {
    const d = dir({
      ".env.local": `${AGENT_KEY_VAR}=${KEY}\nTCTC_AGENT_NAME=Alice\nTCTC_DASHBOARD_URL=http://localhost:5173/\n`,
    });
    const id = loadAgentIdentity(d, {})!;
    const link = await buildDashboardLink(id, 11155111, new Date("2026-11-02T00:00:00Z"));
    const url = new URL(link.url);
    expect(url.origin).toBe("http://localhost:5173");
    expect(url.searchParams.get("agent")).toBe(ADDRESS);
    expect(url.searchParams.get("name")).toBe("Alice");
    expect(url.searchParams.get("chainId")).toBe("11155111");
    expect(url.searchParams.get("ts")).toBe("2026-11-02T00:00:00.000Z");
    expect(url.searchParams.get("sig")).toMatch(/^0x[0-9a-f]{130}$/);
    expect(link.url.toLowerCase()).not.toContain(KEY.slice(2));
    expect(JSON.stringify(id.name)).not.toContain(KEY.slice(2));
  });
});

describe("resolveSubject with an agent key", () => {
  const SELF = "0x31F8FDf2BA077c0f39852b6daAE028a5A7475d03";
  function ctx(withAgent: boolean): Context {
    const config = parseConfig(
      JSON.stringify({
        chains: { sepolia: { chainId: 11155111, rpcUrl: "https://unused" } },
        defaultChain: "sepolia",
        self: { address: SELF },
      }),
      {},
    );
    return {
      config,
      chains: {} as Context["chains"],
      cache: new BalanceCache(0),
      discovery: new TtlCache(0),
      adminMode: false,
      agent: withAgent ? loadAgentIdentity(dir(), { [AGENT_KEY_VAR]: KEY }) : undefined,
    };
  }

  it("prefers the agent key over the config's self", async () => {
    expect(await resolveSubject(ctx(true))).toEqual({ address: ADDRESS, via: "agent-key" });
  });

  it("falls back to the config's self without an agent key", async () => {
    expect(await resolveSubject(ctx(false))).toEqual({ address: SELF, via: "config-self" });
  });

  it("still honours an explicit address first", async () => {
    const other = "0x2222222222222222222222222222222222222222" as Address;
    expect(await resolveSubject(ctx(true), { address: other })).toEqual({
      address: other,
      via: "explicit-address",
    });
  });
});

describe("tctc-mcp agent init", () => {
  it("creates a private .env.local once and keeps an existing key", async () => {
    const d = dir({ ".gitignore": ".env.local\n" });
    const log = console.log;
    const lines: string[] = [];
    console.log = (...a: unknown[]) => lines.push(a.join(" "));
    try {
      expect(await runAgentCommand(["init", "--name", "Alice"], d)).toBe(0);
      const envPath = join(d, ".env.local");
      expect(existsSync(envPath)).toBe(true);
      expect(statSync(envPath).mode & 0o777).toBe(0o600);
      const first = readFileSync(envPath, "utf8");
      const firstAddress = loadAgentIdentity(d, {})!.address;

      expect(await runAgentCommand(["init"], d)).toBe(0);
      expect(readFileSync(envPath, "utf8")).toBe(first);
      expect(loadAgentIdentity(d, {})!.address).toBe(firstAddress);
      expect(loadAgentIdentity(d, {})!.name).toBe("Alice");

      const key = parseDotenv(first)[AGENT_KEY_VAR];
      expect(lines.join("\n")).not.toContain(key.slice(2));
      expect(lines.join("\n")).toContain(firstAddress);
    } finally {
      console.log = log;
    }
  });
});
