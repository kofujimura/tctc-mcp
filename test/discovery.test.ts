import { describe, it, expect } from "vitest";
import { toFunctionSelector, type Address } from "viem";
import {
  IERC7303_INTERFACE_ID,
  roleHash,
  discoverBindings,
  supportsIERC7303,
} from "../src/discovery.js";
import { checkRole } from "../src/roles.js";
import { BalanceCache, TtlCache, type Context } from "../src/context.js";
import { parseConfig } from "../src/config.js";

const TARGET = "0x4C0a78803D47154B9C6F42EC4AEbab2D1C94c97D" as Address;
const CT = "0x12342A7F0190B3AF3F4b47546D34006EDA54eE0B" as Address;
const SUBJECT = "0x31F8FDf2BA077c0f39852b6daAE028a5A7475d03" as Address;

const MINTER_ROLE_HASH =
  "0x9f2df0fed2c77648de5860a4cc508cd0818c85b8b8a1ab4ceeef8d981c8956a6";

type Call = { functionName: string; address: string; args: unknown[] };

/** ctx whose public client answers per functionName. */
function fakeCtx(
  answers: Record<string, (call: Call) => unknown>,
  ttlMs = 0,
): { ctx: Context; calls: Call[] } {
  const config = parseConfig(
    JSON.stringify({
      chains: { sepolia: { chainId: 11155111, rpcUrl: "https://unused" } },
      defaultChain: "sepolia",
      roles: { MINTER_ROLE: { target: { address: TARGET } } },
    }),
    {},
  );
  const calls: Call[] = [];
  const chains = {
    public: () => ({
      readContract: async (call: Call) => {
        calls.push(call);
        const fn = answers[call.functionName];
        if (!fn) throw new Error(`unexpected call: ${call.functionName}`);
        return fn(call);
      },
    }),
  } as unknown as Context["chains"];
  return {
    ctx: {
      config,
      chains,
      cache: new BalanceCache(ttlMs),
      discovery: new TtlCache(ttlMs),
      adminMode: false,
    },
    calls,
  };
}

describe("IERC7303_INTERFACE_ID", () => {
  it("is the XOR of the three function selectors", () => {
    const selectors = [
      "function hasRole(bytes32,address)",
      "function getERC721ControlTokens(bytes32)",
      "function getERC1155ControlTokens(bytes32)",
    ].map((sig) => BigInt(toFunctionSelector(sig)));
    const xor = selectors.reduce((a, b) => a ^ b, 0n);
    expect("0x" + xor.toString(16).padStart(8, "0")).toBe(IERC7303_INTERFACE_ID);
  });
});

describe("roleHash", () => {
  it("keccak256-hashes role names", () => {
    expect(roleHash("MINTER_ROLE")).toBe(MINTER_ROLE_HASH);
  });

  it("passes 32-byte hex values through unchanged (lowercased)", () => {
    expect(roleHash(MINTER_ROLE_HASH.toUpperCase().replace("0X", "0x"))).toBe(
      MINTER_ROLE_HASH,
    );
  });
});

describe("discoverBindings", () => {
  const supported = {
    supportsInterface: () => true,
    getERC721ControlTokens: () => [],
    getERC1155ControlTokens: () => [[CT], [1n]],
  };

  it("enumerates bindings from the IERC7303 getters", async () => {
    const { ctx } = fakeCtx(supported);
    const b = await discoverBindings(ctx, "sepolia", TARGET, roleHash("MINTER_ROLE"));
    expect(b.erc721).toEqual([]);
    expect(b.erc1155).toEqual([{ address: CT, typeId: 1n }]);
  });

  it("throws NOT_IERC7303 when ERC-165 reports no support", async () => {
    const { ctx } = fakeCtx({ supportsInterface: () => false });
    await expect(
      discoverBindings(ctx, "sepolia", TARGET, roleHash("MINTER_ROLE")),
    ).rejects.toMatchObject({ code: "NOT_IERC7303" });
  });

  it("caches discovery results within the TTL", async () => {
    const { ctx, calls } = fakeCtx(supported, 60_000);
    const hash = roleHash("MINTER_ROLE");
    await discoverBindings(ctx, "sepolia", TARGET, hash);
    await discoverBindings(ctx, "sepolia", TARGET, hash);
    // 3 RPCs for the first discovery (probe + 2 getters), 0 for the second.
    expect(calls).toHaveLength(3);
  });

  it("maps RPC failures to CHAIN_UNAVAILABLE, not to non-support", async () => {
    const { ctx } = fakeCtx({
      supportsInterface: () => {
        throw new Error("RPC boom");
      },
    });
    await expect(supportsIERC7303(ctx, "sepolia", TARGET)).rejects.toMatchObject({
      code: "CHAIN_UNAVAILABLE",
    });
  });
});

describe("checkRole via discovery", () => {
  it("uses discovered bindings for evidence and target.hasRole as verdict", async () => {
    const { ctx, calls } = fakeCtx({
      supportsInterface: () => true,
      getERC721ControlTokens: () => [],
      getERC1155ControlTokens: () => [[CT], [1n]],
      balanceOf: () => 1n,
      hasRole: () => true,
    });
    const result = await checkRole(ctx, "MINTER_ROLE", SUBJECT);
    expect(result.hasRole).toBe(true);
    expect(result.bindingSource).toBe("ierc7303");
    expect(result.target).toBe(TARGET);
    expect(result.roleHash).toBe(MINTER_ROLE_HASH);
    expect(result.evidence).toEqual([
      {
        chain: "sepolia",
        controlToken: CT,
        standard: "erc1155",
        typeId: "1",
        balance: "1",
      },
    ]);
    expect(result.note).toBeUndefined();
    expect(calls.map((c) => c.functionName)).toContain("hasRole");
  });

  it("flags a mismatch but reports the target's answer", async () => {
    const { ctx } = fakeCtx({
      supportsInterface: () => true,
      getERC721ControlTokens: () => [],
      getERC1155ControlTokens: () => [[CT], [1n]],
      balanceOf: () => 1n,
      hasRole: () => false, // custom logic on the target overrides balances
    });
    const result = await checkRole(ctx, "MINTER_ROLE", SUBJECT);
    expect(result.hasRole).toBe(false);
    expect(result.note).toMatch(/authoritative/);
  });
});
