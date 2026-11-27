/**
 * Cross-implementation check: a link signed by tctc-mcp (src/agent.ts) must
 * verify in the dashboard (dashboard/src/lib/agent-link.ts), and any change
 * to a signed field must break verification.
 */
import { describe, it, expect } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { agentLinkMessage as serverMessage, buildDashboardLink, loadAgentIdentity } from "../src/agent.js";
import {
  agentLinkMessage as dashboardMessage,
  parseAgentLink,
  verifyAgentLink,
} from "../dashboard/src/lib/agent-link.js";

const KEY = ("0x" + "44".repeat(32)) as `0x${string}`;
const ADDRESS = privateKeyToAccount(KEY).address;

async function signedParams(name?: string): Promise<URLSearchParams> {
  const id = loadAgentIdentity("/nonexistent-dir", {
    TCTC_AGENT_PRIVATE_KEY: KEY,
    ...(name ? { TCTC_AGENT_NAME: name } : {}),
  })!;
  const link = await buildDashboardLink(id, 11155111, new Date("2026-11-02T12:34:56Z"));
  return new URL(link.url).searchParams;
}

describe("agent link: tctc-mcp ↔ dashboard", () => {
  it("both sides build the identical message", () => {
    const f = { agent: ADDRESS, name: "Alice", chainId: 11155111, issuedAt: "2026-11-02T00:00:00.000Z" };
    expect(dashboardMessage(f)).toBe(serverMessage(f));
  });

  it("a server-signed link verifies in the dashboard", async () => {
    const link = parseAgentLink(await signedParams("Alice 🤖"))!;
    expect(link.address).toBe(ADDRESS);
    expect(link.name).toBe("Alice 🤖");
    expect(link.chainId).toBe(11155111);
    expect(await verifyAgentLink(link)).toBe(true);
  });

  it("a link without a name verifies too", async () => {
    const link = parseAgentLink(await signedParams())!;
    expect(link.name).toBeUndefined();
    expect(await verifyAgentLink(link)).toBe(true);
  });

  it("tampering with any signed field breaks verification", async () => {
    const base = await signedParams("Alice");
    for (const [k, v] of [
      ["name", "Mallory"],
      ["chainId", "1"],
      ["ts", "2027-01-01T00:00:00.000Z"],
      ["agent", "0x2222222222222222222222222222222222222222"],
    ]) {
      const p = new URLSearchParams(base);
      p.set(k, v);
      expect(await verifyAgentLink(parseAgentLink(p)!), k).toBe(false);
    }
  });

  it("unsigned or malformed links parse but do not verify", async () => {
    const p = new URLSearchParams({ agent: ADDRESS.toLowerCase() });
    const link = parseAgentLink(p)!;
    expect(link.address).toBe(ADDRESS);
    expect(await verifyAgentLink(link)).toBe(false);
    expect(parseAgentLink(new URLSearchParams({ agent: "0x123" }))).toBeUndefined();
  });
});
