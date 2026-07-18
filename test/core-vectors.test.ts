/**
 * Cross-implementation vectors (GATE_SPEC §8): @tctc/core and tctc-mcp's
 * src/ must produce identical authorization primitives. Divergence is a
 * test failure, not a code-review hope.
 */
import { describe, expect, it } from "vitest";
import { roleHash as mcpRoleHash, IERC7303_INTERFACE_ID as MCP_ID } from "../src/discovery.js";
import { roleHash as coreRoleHash, IERC7303_INTERFACE_ID as CORE_ID } from "../core/src/index.js";

const NAME_VECTORS = [
  "MINTER_ROLE",
  "BURNER_ROLE",
  "MEMBER_ROLE",
  "TIMED_MINTER_ROLE",
  "ADMIN_ROLE",
  "role with spaces",
  "日本語ロール",
  "",
];

const HASH_VECTORS = [
  "0x" + "ab".repeat(32),
  "0x" + "AB".repeat(32), // must lowercase identically
  "0x9f2df0fed2c77648de5860a4cc508cd0818c85b8b8a1ab4ceeef8d981c8956a6",
];

describe("core ↔ tctc-mcp shared vectors", () => {
  it("agree on the IERC7303 interface id", () => {
    expect(CORE_ID).toBe(MCP_ID);
  });

  it("agree on roleHash for role names", () => {
    for (const name of NAME_VECTORS) {
      expect(coreRoleHash(name)).toBe(mcpRoleHash(name));
    }
  });

  it("agree on 32-byte hash passthrough and case normalization", () => {
    for (const h of HASH_VECTORS) {
      expect(coreRoleHash(h)).toBe(mcpRoleHash(h));
      expect(coreRoleHash(h)).toBe(h.toLowerCase());
    }
  });

  it("hash known role names to their canonical values", () => {
    // keccak256("MINTER_ROLE") — the value visible on-chain and in the dashboard.
    expect(coreRoleHash("MINTER_ROLE")).toBe(
      "0x9f2df0fed2c77648de5860a4cc508cd0818c85b8b8a1ab4ceeef8d981c8956a6",
    );
  });
});
