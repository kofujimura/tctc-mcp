/**
 * Dashboard agent view logic (dashboard/src/lib/agents.ts) against a stubbed
 * multicall: what an agent holds, what it confers, and how consecutive
 * snapshots turn into "burned" / "minted" transitions.
 */
import { describe, it, expect } from "vitest";
import type { Address, PublicClient } from "viem";
import {
  conferredRoles,
  diffSnapshots,
  fetchAgentStates,
  hueOf,
  tokenKey,
  upsertAgent,
  type AgentEntry,
  type AgentState,
  type CollectionMeta,
  type TargetInfo,
} from "../dashboard/src/lib/agents.js";
import { roleHash } from "../dashboard/src/lib/core.js";

const AGENT = "0x773370e5C2D1351574789aFd0a9678E301B5B071" as Address;
const ACT = "0x12342A7F0190B3AF3F4b47546D34006EDA54eE0B" as Address; // standard 1155
const ECT = "0xb5abB6c060ed287e8B25aD121c8B46eE404fF09b" as Address; // expiring 1155
const MEM = "0x4223260CEf7cbA173C227b1B11E8a6a8Ce2E388a" as Address; // 721
const DEMO = "0x4C0a78803D47154B9C6F42EC4AEbab2D1C94c97D" as Address; // target

const collections: CollectionMeta[] = [
  { address: ACT, name: "ACT", standard: "erc1155", expiring: false },
  { address: ECT, name: "ECT", standard: "erc1155", expiring: true },
  { address: MEM, name: "MEM", standard: "erc721", expiring: false },
];

const targets: TargetInfo[] = [
  {
    address: DEMO,
    label: "TCTC Demo Token",
    supports: true,
    roles: [
      { name: "MINTER_ROLE", hash: roleHash("MINTER_ROLE"), erc721: [], erc1155: [{ address: ACT, typeId: 1n }] },
      { name: "TIMED_ROLE", hash: roleHash("TIMED_ROLE"), erc721: [], erc1155: [{ address: ECT, typeId: 2n }] },
      { name: "BIG_ROLE", hash: roleHash("BIG_ROLE"), erc721: [], erc1155: [{ address: ACT, typeId: 1000n }] },
    ],
  },
];

interface World {
  held: Record<string, bigint>; // tokenKey → live balance
  expiry: Record<string, bigint>; // tokenKey → expiresAt
  roles: Set<string>; // role hashes hasRole() answers true for
  fail?: Set<string>; // lower-case addresses whose reads fail
}

function fakeClient(w: World): PublicClient {
  return {
    multicall: async ({ contracts }: { contracts: any[] }) =>
      contracts.map((c) => {
        const addr = String(c.address).toLowerCase();
        if (w.fail?.has(addr)) return { status: "failure", error: new Error("boom") };
        switch (c.functionName) {
          case "balanceOfBatch":
            return {
              status: "success",
              result: (c.args[1] as bigint[]).map((id) => w.held[tokenKey(c.address, id)] ?? 0n),
            };
          case "expiresAt":
            return { status: "success", result: w.expiry[tokenKey(c.address, c.args[1])] ?? 0n };
          case "balanceOf":
            return { status: "success", result: w.held[tokenKey(c.address)] ?? 0n };
          case "hasRole":
            return { status: "success", result: w.roles.has(c.args[0]) };
          default:
            return { status: "failure", error: new Error("unexpected") };
        }
      }),
  } as unknown as PublicClient;
}

const bound = new Map([[ACT.toLowerCase(), [1n, 1000n]], [ECT.toLowerCase(), [2n]]]);

async function snapshot(w: World): Promise<AgentState> {
  const states = await fetchAgentStates(fakeClient(w), [AGENT], collections, bound, targets);
  return states.get(AGENT.toLowerCase())!;
}

describe("fetchAgentStates", () => {
  it("finds held tokens across standards, including bound typeIds beyond the probe range", async () => {
    const future = BigInt(Math.floor(Date.now() / 1000) + 3600);
    const st = await snapshot({
      held: {
        [tokenKey(ACT, 1n)]: 1n,
        [tokenKey(ACT, 1000n)]: 1n,
        [tokenKey(ECT, 2n)]: 1n,
        [tokenKey(MEM)]: 2n,
      },
      expiry: { [tokenKey(ECT, 2n)]: future },
      roles: new Set([roleHash("MINTER_ROLE")]),
    });
    expect(st.tokens.map((t) => t.key).sort()).toEqual(
      [tokenKey(ACT, 1n), tokenKey(ACT, 1000n), tokenKey(ECT, 2n), tokenKey(MEM)].sort(),
    );
    expect(st.tokens.find((t) => t.key === tokenKey(ECT, 2n))!.expiresAt).toBe(future);
    expect(st.tokens.find((t) => t.key === tokenKey(MEM))!.balance).toBe(2n);
    expect(st.roles).toEqual([{ role: "MINTER_ROLE", target: DEMO, targetLabel: "TCTC Demo Token" }]);
    expect(st.lapsed).toEqual([]);
    expect(st.failed).toEqual([]);
  });

  it("reports an expired-but-unswept grant as lapsed, not held", async () => {
    const past = BigInt(Math.floor(Date.now() / 1000) - 60);
    const st = await snapshot({ held: {}, expiry: { [tokenKey(ECT, 2n)]: past }, roles: new Set() });
    expect(st.tokens).toEqual([]);
    expect(st.lapsed.map((t) => t.key)).toEqual([tokenKey(ECT, 2n)]);
  });

  it("marks collections whose reads failed", async () => {
    const st = await snapshot({ held: {}, expiry: {}, roles: new Set(), fail: new Set([ACT.toLowerCase()]) });
    expect(st.failed).toEqual([ACT.toLowerCase()]);
  });
});

describe("diffSnapshots", () => {
  const base = { lapsed: [], roles: [], failed: [], checkedAt: 0 };
  const tok = (col: Address, id: bigint, expiresAt?: bigint) => ({
    key: tokenKey(col, id),
    collection: col,
    standard: "erc1155" as const,
    typeId: id,
    balance: 1n,
    expiresAt,
  });

  it("a vanished token is a burn; a new one is a mint", () => {
    const before: AgentState = { ...base, tokens: [tok(ACT, 1n)] };
    const after: AgentState = { ...base, tokens: [tok(ACT, 2n)] };
    const d = diffSnapshots(before, after, Date.now());
    expect(d.vanished.map((v) => [v.token.key, v.reason])).toEqual([[tokenKey(ACT, 1n), "revoked"]]);
    expect(d.born).toEqual([tokenKey(ACT, 2n)]);
  });

  it("a token that moved to lapsed is not a burn", () => {
    const t = tok(ECT, 2n, 100n);
    const d = diffSnapshots({ ...base, tokens: [t] }, { ...base, tokens: [], lapsed: [t] }, 200_000);
    expect(d.vanished).toEqual([]);
  });

  it("a token past its expiry that vanished (swept) is reported as expired", () => {
    const t = tok(ECT, 2n, 100n);
    const d = diffSnapshots({ ...base, tokens: [t] }, { ...base, tokens: [] }, 200_000);
    expect(d.vanished.map((v) => v.reason)).toEqual(["expired"]);
  });

  it("a failed read never produces a false burn", () => {
    const d = diffSnapshots(
      { ...base, tokens: [tok(ACT, 1n)] },
      { ...base, tokens: [], failed: [ACT.toLowerCase()] },
      Date.now(),
    );
    expect(d.vanished).toEqual([]);
  });
});

describe("registry helpers", () => {
  const entry = (over: Partial<AgentEntry>): AgentEntry => ({
    address: AGENT,
    verified: false,
    addedAt: "2026-11-02T00:00:00.000Z",
    ...over,
  });

  it("a verified link upgrades an entry; a manual re-add never downgrades it", () => {
    let list = upsertAgent([], entry({ name: "manual" }));
    list = upsertAgent(list, entry({ address: AGENT.toLowerCase() as Address, name: "Alice", verified: true, linkedAt: "t1" }));
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: "Alice", verified: true, linkedAt: "t1" });
    list = upsertAgent(list, entry({}));
    expect(list[0]).toMatchObject({ name: "Alice", verified: true, linkedAt: "t1" });
  });

  it("maps each control token to the roles it confers", () => {
    const m = conferredRoles(targets);
    expect(m.get(tokenKey(ACT, 1n))).toEqual([
      { role: "MINTER_ROLE", target: DEMO, targetLabel: "TCTC Demo Token" },
    ]);
    expect(m.get(tokenKey(ACT, 7n))).toBeUndefined();
  });

  it("gives similar addresses distinct hues", () => {
    expect(hueOf(ACT)).not.toBe(hueOf(MEM));
    expect(hueOf(ACT)).toBe(hueOf(ACT.toLowerCase()));
  });
});
