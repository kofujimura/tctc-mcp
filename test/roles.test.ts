import { describe, it, expect } from "vitest";
import type { Address } from "viem";
import { checkRole } from "../src/roles.js";
import { BalanceCache, TtlCache, type Context } from "../src/context.js";
import { parseConfig } from "../src/config.js";
import { ToolError } from "../src/errors.js";

const CT1 = "0x1111111111111111111111111111111111111111";
const CT2 = "0x2222222222222222222222222222222222222222";
const SUBJECT = "0x31F8FDf2BA077c0f39852b6daAE028a5A7475d03" as Address;

/** ctx with a stubbed public client returning fixed balances per contract. */
function fakeCtx(balances: Record<string, bigint>, cacheTtlMs = 0): {
  ctx: Context;
  calls: string[];
} {
  const config = parseConfig(
    JSON.stringify({
      chains: { sepolia: { chainId: 11155111, rpcUrl: "https://unused" } },
      defaultChain: "sepolia",
      roles: {
        R: {
          controlTokens: [
            { chain: "sepolia", standard: "erc1155", address: CT1, typeId: 1 },
            { chain: "sepolia", standard: "erc721", address: CT2 },
          ],
        },
      },
    }),
    {},
  );
  const calls: string[] = [];
  const chains = {
    public: () => ({
      readContract: async ({ address }: { address: string }) => {
        calls.push(address);
        const b = balances[address.toLowerCase()];
        if (b === undefined) throw new Error("RPC boom");
        return b;
      },
    }),
  } as unknown as Context["chains"];
  return {
    ctx: {
      config,
      chains,
      cache: new BalanceCache(cacheTtlMs),
      discovery: new TtlCache(cacheTtlMs),
      adminMode: false,
    },
    calls,
  };
}

describe("checkRole", () => {
  it("grants with OR semantics when any control token has balance", async () => {
    const { ctx } = fakeCtx({ [CT1]: 0n, [CT2]: 1n });
    const result = await checkRole(ctx, "R", SUBJECT);
    expect(result.hasRole).toBe(true);
    expect(result.evidence).toHaveLength(2);
    expect(result.evidence[0]).toMatchObject({ balance: "0", typeId: "1" });
    expect(result.evidence[1]).toMatchObject({ balance: "1", typeId: null });
  });

  it("denies when all balances are zero", async () => {
    const { ctx } = fakeCtx({ [CT1]: 0n, [CT2]: 0n });
    expect((await checkRole(ctx, "R", SUBJECT)).hasRole).toBe(false);
  });

  it("throws ROLE_NOT_CONFIGURED for unknown roles", async () => {
    const { ctx } = fakeCtx({});
    await expect(checkRole(ctx, "NOPE", SUBJECT)).rejects.toMatchObject({
      code: "ROLE_NOT_CONFIGURED",
    });
  });

  it("maps RPC failures to CHAIN_UNAVAILABLE", async () => {
    const { ctx } = fakeCtx({ [CT1]: 1n }); // CT2 missing → throws
    await expect(checkRole(ctx, "R", SUBJECT)).rejects.toSatisfy(
      (e: unknown) => e instanceof ToolError && e.code === "CHAIN_UNAVAILABLE",
    );
  });

  it("serves repeated reads from the cache within the TTL", async () => {
    const { ctx, calls } = fakeCtx({ [CT1]: 1n, [CT2]: 0n }, 60_000);
    await checkRole(ctx, "R", SUBJECT);
    await checkRole(ctx, "R", SUBJECT);
    expect(calls).toHaveLength(2); // one RPC per token, second pass cached
  });
});
