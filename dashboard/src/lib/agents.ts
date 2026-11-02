/**
 * Agents as token holders.
 *
 * An AI agent is an EOA (its key lives in the agent's .env.local; see
 * tctc-mcp's `whoami` / `tctc-mcp agent link`). Its permissions are the
 * control tokens it holds, so this module answers "what does this agent
 * hold, and what does that let it do?" straight from the chain:
 *
 *  - which control-token collections to look at: the Sepolia demo
 *    collections, every control token bound on a watched target, and any
 *    collection deployed / loaded / added here;
 *  - which tokens the agent holds: ERC-1155 via balanceOfBatch over typeIds
 *    0…PROBE_TYPE_IDS-1 plus every typeId bound on a watched target (no
 *    event indexer or archive node needed); ERC-721 via balanceOf;
 *  - what they confer: the watched targets' own hasRole() verdicts.
 *
 * The roster of agents is the only off-chain state: a per-chain list in
 * this browser's localStorage.
 */
import { getAddress, zeroAddress, type Address, type ContractFunctionParameters, type Hex, type PublicClient } from "viem";
import { parseAbi } from "viem";
import {
  ROLE_DICTIONARY,
  ctMetaAbi,
  erc721BalanceAbi,
  expiringCtAbi,
  ierc7303Abi,
  probeRoles,
  shortAddress,
  type RoleInfo,
} from "./core";

/** ERC-1155 typeIds probed for every collection, in addition to bound ones. */
export const PROBE_TYPE_IDS = 32;

const ERC1155_ID = "0xd9b67a26";
const ERC721_ID = "0x80ac58cd";

const erc1155BatchAbi = parseAbi([
  "function balanceOfBatch(address[] accounts, uint256[] ids) view returns (uint256[])",
]);

// ─── registry (off-chain, per chain, this browser) ──────────────────────────

export interface AgentEntry {
  address: Address;
  name?: string;
  /** true once a link signed by the agent's own key has been verified */
  verified: boolean;
  /** issuedAt of the latest verified link (ISO) */
  linkedAt?: string;
  addedAt: string;
}

export interface KnownContract {
  address: Address;
  label?: string;
  /** built-in demo entries cannot be removed */
  builtin?: boolean;
}

export const DEFAULT_TARGETS: Record<number, KnownContract[]> = {
  11155111: [
    { address: "0x4C0a78803D47154B9C6F42EC4AEbab2D1C94c97D", label: "TCTC Demo Token", builtin: true },
    {
      address: "0x3eAb11DE9655817A2e2977A486d9D33eBD10c9Ce",
      label: "TCTC Demo Token (auto-expiry)",
      builtin: true,
    },
    { address: "0x873f0bf314A1e0B566015CEf9dA37783A729Fd02", label: "MyComplexToken", builtin: true },
  ],
};

export const DEFAULT_COLLECTIONS: Record<number, KnownContract[]> = {
  11155111: [
    { address: "0x12342A7F0190B3AF3F4b47546D34006EDA54eE0B", builtin: true },
    { address: "0xb5abB6c060ed287e8B25aD121c8B46eE404fF09b", builtin: true },
  ],
};

type ListKind = "agents" | "targets" | "collections";

const storageKey = (kind: ListKind, chainId: number) => `tctc.${kind}.${chainId}`;

export function loadList<T>(kind: ListKind, chainId: number): T[] {
  try {
    const raw = window.localStorage.getItem(storageKey(kind, chainId));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

export function saveList<T>(kind: ListKind, chainId: number, list: T[]): void {
  try {
    window.localStorage.setItem(storageKey(kind, chainId), JSON.stringify(list));
  } catch {
    /* private mode / storage blocked: the roster lives for this session only */
  }
}

/** Insert or update by address; a verified link upgrades, a manual re-add never downgrades. */
export function upsertAgent(list: AgentEntry[], entry: AgentEntry): AgentEntry[] {
  const i = list.findIndex((a) => a.address.toLowerCase() === entry.address.toLowerCase());
  if (i < 0) return [...list, entry];
  const prev = list[i];
  const merged: AgentEntry = {
    ...prev,
    name: entry.name ?? prev.name,
    verified: prev.verified || entry.verified,
    linkedAt: entry.verified ? entry.linkedAt : prev.linkedAt,
  };
  return list.map((a, j) => (j === i ? merged : a));
}

export function mergeContracts(...lists: KnownContract[][]): KnownContract[] {
  const out = new Map<string, KnownContract>();
  for (const list of lists) {
    for (const c of list) {
      const k = c.address.toLowerCase();
      const prev = out.get(k);
      out.set(k, prev ? { ...c, ...prev, label: prev.label ?? c.label } : c);
    }
  }
  return [...out.values()];
}

// ─── targets: what each control token confers ──────────────────────────────

export interface TargetInfo {
  address: Address;
  label: string;
  supports: boolean;
  roles: RoleInfo[];
}

export function mergeRoles(a: RoleInfo[], b: RoleInfo[]): RoleInfo[] {
  const out = new Map<Hex, RoleInfo>();
  for (const r of [...a, ...b]) if (!out.has(r.hash)) out.set(r.hash, r);
  return [...out.values()];
}

export async function loadTargets(
  client: PublicClient,
  targets: KnownContract[],
): Promise<TargetInfo[]> {
  if (targets.length === 0) return [];
  const head = await client.multicall({
    allowFailure: true,
    contracts: targets.flatMap((t) => [
      {
        address: t.address,
        abi: ierc7303Abi,
        functionName: "supportsInterface",
        args: ["0x4ee69337"],
      } as const,
      { address: t.address, abi: ctMetaAbi, functionName: "name" } as const,
    ]),
  });
  return Promise.all(
    targets.map(async (t, i) => {
      const supports = head[2 * i].status === "success" && head[2 * i].result === true;
      const name = head[2 * i + 1].status === "success" ? (head[2 * i + 1].result as string) : undefined;
      const roles = supports ? await probeRoles(client, t.address, ROLE_DICTIONARY) : [];
      return {
        address: t.address,
        label: t.label ?? name ?? shortAddress(t.address),
        supports,
        roles,
      };
    }),
  );
}

/** Every control token bound on the given targets, with its bound ERC-1155 typeIds. */
export function boundControlTokens(targets: TargetInfo[]): Map<string, { address: Address; typeIds: bigint[] }> {
  const out = new Map<string, { address: Address; typeIds: bigint[] }>();
  const get = (a: Address) => {
    const k = a.toLowerCase();
    if (!out.has(k)) out.set(k, { address: a, typeIds: [] });
    return out.get(k)!;
  };
  for (const t of targets) {
    for (const r of t.roles) {
      for (const a of r.erc721) get(a);
      for (const b of r.erc1155) {
        const e = get(b.address);
        if (!e.typeIds.includes(b.typeId)) e.typeIds.push(b.typeId);
      }
    }
  }
  return out;
}

export interface Conferred {
  role: string;
  target: Address;
  targetLabel: string;
}

export function tokenKey(collection: Address, typeId?: bigint): string {
  return `${collection.toLowerCase()}:${typeId === undefined ? "721" : typeId.toString()}`;
}

/** token key → the (target, role) pairs whose bindings include that token. */
export function conferredRoles(targets: TargetInfo[]): Map<string, Conferred[]> {
  const out = new Map<string, Conferred[]>();
  const add = (k: string, c: Conferred) => {
    const list = out.get(k) ?? [];
    list.push(c);
    out.set(k, list);
  };
  for (const t of targets) {
    for (const r of t.roles) {
      const c = { role: r.name, target: t.address, targetLabel: t.label };
      for (const a of r.erc721) add(tokenKey(a), c);
      for (const b of r.erc1155) add(tokenKey(b.address, b.typeId), c);
    }
  }
  return out;
}

// ─── collections ────────────────────────────────────────────────────────────

export interface CollectionMeta {
  address: Address;
  name?: string;
  owner?: Address;
  standard: "erc1155" | "erc721" | "unknown";
  expiring: boolean;
}

export async function loadCollectionMeta(
  client: PublicClient,
  addresses: Address[],
): Promise<Map<string, CollectionMeta>> {
  const out = new Map<string, CollectionMeta>();
  if (addresses.length === 0) return out;
  const res = await client.multicall({
    allowFailure: true,
    contracts: addresses.flatMap((address) => [
      { address, abi: ctMetaAbi, functionName: "name" } as const,
      { address, abi: ctMetaAbi, functionName: "owner" } as const,
      { address, abi: ierc7303Abi, functionName: "supportsInterface", args: [ERC1155_ID] } as const,
      { address, abi: ierc7303Abi, functionName: "supportsInterface", args: [ERC721_ID] } as const,
      { address, abi: expiringCtAbi, functionName: "expiresAt", args: [zeroAddress, 0n] } as const,
    ]),
  });
  addresses.forEach((address, i) => {
    const r = res.slice(5 * i, 5 * i + 5);
    const ok = <T,>(j: number) => (r[j].status === "success" ? (r[j].result as T) : undefined);
    const standard = ok<boolean>(2) ? "erc1155" : ok<boolean>(3) ? "erc721" : "unknown";
    out.set(address.toLowerCase(), {
      address,
      name: ok<string>(0),
      owner: ok<Address>(1),
      standard,
      expiring: standard === "erc1155" && r[4].status === "success",
    });
  });
  return out;
}

// ─── holdings ───────────────────────────────────────────────────────────────

export interface HeldToken {
  key: string;
  collection: Address;
  standard: "erc1155" | "erc721";
  typeId?: bigint;
  balance: bigint;
  /** expiring collections: unix seconds (0 = no grant) */
  expiresAt?: bigint;
}

export interface EffectiveRole {
  role: string;
  target: Address;
  targetLabel: string;
}

export interface AgentState {
  /** live tokens: balanceOf > 0 right now */
  tokens: HeldToken[];
  /** expiring grants whose time has passed (balanceOf already 0, not yet swept) */
  lapsed: HeldToken[];
  /** roles the watched targets' own hasRole() grants this agent */
  roles: EffectiveRole[];
  /** collections whose reads failed this round (keep the previous view for them) */
  failed: string[];
  checkedAt: number;
}

/**
 * One multicall for every agent: balanceOfBatch / balanceOf / expiresAt per
 * collection, hasRole per watched target role.
 */
export async function fetchAgentStates(
  client: PublicClient,
  agents: Address[],
  collections: CollectionMeta[],
  boundTypeIds: Map<string, bigint[]>,
  targets: TargetInfo[],
): Promise<Map<string, AgentState>> {
  type Slot =
    | { kind: "batch"; agent: number; col: CollectionMeta; ids: bigint[] }
    | { kind: "expiry"; agent: number; col: CollectionMeta; id: bigint }
    | { kind: "bal721"; agent: number; col: CollectionMeta }
    | { kind: "hasRole"; agent: number; target: TargetInfo; role: RoleInfo };
  const contracts: ContractFunctionParameters[] = [];
  const slots: Slot[] = [];

  agents.forEach((agent, ai) => {
    for (const col of collections) {
      if (col.standard === "erc1155") {
        const ids = [...new Set([
          ...Array.from({ length: PROBE_TYPE_IDS }, (_, i) => BigInt(i)),
          ...(boundTypeIds.get(col.address.toLowerCase()) ?? []),
        ])];
        contracts.push({
          address: col.address,
          abi: erc1155BatchAbi,
          functionName: "balanceOfBatch",
          args: [ids.map(() => agent), ids],
        });
        slots.push({ kind: "batch", agent: ai, col, ids });
        if (col.expiring) {
          for (const id of ids) {
            contracts.push({
              address: col.address,
              abi: expiringCtAbi,
              functionName: "expiresAt",
              args: [agent, id],
            });
            slots.push({ kind: "expiry", agent: ai, col, id });
          }
        }
      } else if (col.standard === "erc721") {
        contracts.push({
          address: col.address,
          abi: erc721BalanceAbi,
          functionName: "balanceOf",
          args: [agent],
        });
        slots.push({ kind: "bal721", agent: ai, col });
      }
    }
    for (const target of targets) {
      for (const role of target.roles) {
        contracts.push({
          address: target.address,
          abi: ierc7303Abi,
          functionName: "hasRole",
          args: [role.hash, agent],
        });
        slots.push({ kind: "hasRole", agent: ai, target, role });
      }
    }
  });

  const res = contracts.length
    ? await client.multicall({ contracts, allowFailure: true, batchSize: 16_384 })
    : [];

  const now = Date.now();
  const states = agents.map<AgentState>(() => ({
    tokens: [],
    lapsed: [],
    roles: [],
    failed: [],
    checkedAt: now,
  }));
  const expiries = new Map<string, bigint>(); // `${agent}:${tokenKey}` → expiresAt

  slots.forEach((slot, i) => {
    if (slot.kind === "expiry" && res[i].status === "success") {
      expiries.set(`${slot.agent}:${tokenKey(slot.col.address, slot.id)}`, BigInt(res[i].result as bigint));
    }
  });

  slots.forEach((slot, i) => {
    const r = res[i];
    const st = states[slot.agent];
    if (slot.kind === "hasRole") {
      if (r.status === "success" && r.result === true) {
        st.roles.push({ role: slot.role.name, target: slot.target.address, targetLabel: slot.target.label });
      }
      return;
    }
    if (slot.kind === "expiry") return;
    if (r.status !== "success") {
      const k = slot.col.address.toLowerCase();
      if (!st.failed.includes(k)) st.failed.push(k);
      return;
    }
    if (slot.kind === "bal721") {
      const balance = r.result as bigint;
      if (balance > 0n) {
        st.tokens.push({
          key: tokenKey(slot.col.address),
          collection: slot.col.address,
          standard: "erc721",
          balance,
        });
      }
      return;
    }
    const balances = r.result as readonly bigint[];
    slot.ids.forEach((id, j) => {
      const key = tokenKey(slot.col.address, id);
      const expiresAt = slot.col.expiring ? expiries.get(`${slot.agent}:${key}`) : undefined;
      const token: HeldToken = {
        key,
        collection: slot.col.address,
        standard: "erc1155",
        typeId: id,
        balance: balances[j],
        expiresAt,
      };
      if (balances[j] > 0n) st.tokens.push(token);
      else if (expiresAt !== undefined && expiresAt > 0n) st.lapsed.push(token);
    });
  });

  return new Map(agents.map((a, i) => [a.toLowerCase(), states[i]]));
}

export interface Vanished {
  token: HeldToken;
  reason: "revoked" | "expired";
}

/**
 * Compare two consecutive snapshots of one agent. Tokens that vanished
 * entirely were burned (revoked) — or expired and swept within one poll;
 * tokens that merely lapsed are still listed in `after.lapsed` and are not
 * reported. Reads that failed this round never count as a disappearance.
 */
export function diffSnapshots(
  before: AgentState,
  after: AgentState,
  nowMs: number,
): { vanished: Vanished[]; born: string[] } {
  const live = new Set(after.tokens.map((t) => t.key));
  const lapsed = new Set(after.lapsed.map((t) => t.key));
  const failed = new Set(after.failed);
  const vanished = before.tokens
    .filter(
      (t) => !live.has(t.key) && !lapsed.has(t.key) && !failed.has(t.collection.toLowerCase()),
    )
    .map<Vanished>((token) => ({
      token,
      reason:
        token.expiresAt !== undefined && token.expiresAt > 0n && Number(token.expiresAt) * 1000 <= nowMs
          ? "expired"
          : "revoked",
    }));
  const had = new Set(before.tokens.map((t) => t.key));
  const born = after.tokens.filter((t) => !had.has(t.key)).map((t) => t.key);
  return { vanished, born };
}

/** Stable 0–359 hue per address (FNV-1a over the whole string, so similar prefixes differ). */
export function hueOf(value: string): number {
  let h = 0x811c9dc5;
  for (const ch of value.toLowerCase()) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % 360;
}

export function normalizeAddress(value: string): Address | undefined {
  try {
    return /^0x[0-9a-fA-F]{40}$/.test(value.trim()) ? getAddress(value.trim()) : undefined;
  } catch {
    return undefined;
  }
}
