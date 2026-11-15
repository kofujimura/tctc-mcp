/**
 * View model: turns what the chain says (who holds which token, who owns
 * each collection) plus the directory's labels into what a card shows —
 * a holder, a token with a title, and the party that issued it.
 *
 * Pure functions with no DOM or storage, so the root test suite can
 * import them, and so the live view and the story view share them.
 */
import type { Address } from "viem";
import { shortAddress } from "./core";
import type { AgentEntry, CollectionMeta, Conferred, HeldToken } from "./agents";
import type { Directory, PartyKind } from "./directory";

export interface PartyView {
  address?: Address;
  name: string;
  kind: PartyKind;
  /** one line on what this party does, e.g. "Bookkeeping agent" */
  note?: string;
  /** "bot:<hue>:<variant>" or an image; undefined = generate from `seed` */
  avatar?: string;
  /** stable input for a generated avatar */
  seed: string;
}

export interface ViewContext {
  /** the viewer: the connected wallet, or the address saved as "you" */
  me?: Address;
  agents: AgentEntry[];
  collections: Map<string, CollectionMeta>;
  conferred: Map<string, Conferred[]>;
  directory: Directory;
}

const same = (a?: string, b?: string) => Boolean(a && b && a.toLowerCase() === b.toLowerCase());

/**
 * Who an address is to the viewer. The viewer's own address is "you", a
 * rostered agent is "agent" (so a token issued by an agent says so), and
 * anything else takes its name and kind from the directory.
 */
export function resolveParty(address: Address | undefined, ctx: ViewContext): PartyView {
  if (!address) return { name: "Unknown issuer", kind: "unknown", seed: "unknown" };
  const k = address.toLowerCase();
  const label = ctx.directory.parties[k] ?? {};
  if (same(ctx.me, address)) {
    const me = ctx.directory.me;
    return { address, name: me.name || "You", kind: "you", note: me.note, avatar: me.avatar, seed: k };
  }
  const agent = ctx.agents.find((a) => same(a.address, address));
  if (agent) {
    return {
      address,
      name: agent.name || label.name || shortAddress(address),
      kind: "agent",
      note: label.note,
      avatar: label.avatar,
      seed: k,
    };
  }
  return {
    address,
    name: label.name || shortAddress(address),
    kind: label.kind ?? "unknown",
    note: label.note,
    avatar: label.avatar,
    seed: k,
  };
}

export function agentParty(agent: AgentEntry, ctx: ViewContext): PartyView {
  const label = ctx.directory.parties[agent.address.toLowerCase()] ?? {};
  return {
    address: agent.address,
    name: agent.name || "Unnamed agent",
    kind: "agent",
    note: label.note,
    avatar: label.avatar,
    seed: agent.address.toLowerCase(),
  };
}

export interface PermitView {
  key: string;
  token: HeldToken;
  /** what the card is called: the directory's title, else collection name and id */
  title: string;
  collectionName: string;
  /** "#3" for an ERC-1155 type, "×2" for an ERC-721 balance */
  idLabel: string;
  issuer: PartyView;
  /** issued by the viewer: a delegation token the viewer can burn */
  byYou: boolean;
  /** the (role, target) pairs this token satisfies on the watched targets */
  places: Conferred[];
}

export function permitView(token: HeldToken, ctx: ViewContext): PermitView {
  const meta = ctx.collections.get(token.collection.toLowerCase());
  const collectionName = meta?.name || shortAddress(token.collection);
  const idLabel = token.standard === "erc721" ? `×${token.balance.toString()}` : `#${token.typeId?.toString()}`;
  const label = ctx.directory.tokens[token.key]?.title;
  const issuer = resolveParty(meta?.owner, ctx);
  return {
    key: token.key,
    token,
    title: label || (token.standard === "erc721" ? collectionName : `${collectionName} ${idLabel}`),
    collectionName,
    idLabel,
    issuer,
    byYou: issuer.kind === "you",
    places: ctx.conferred.get(token.key) ?? [],
  };
}

/** Collections whose owner() is the given account: the tokens it can mint and burn. */
export function issuedBy(collections: Map<string, CollectionMeta>, account?: Address): CollectionMeta[] {
  if (!account) return [];
  return [...collections.values()].filter((c) => same(c.owner, account));
}

const KIND_ORDER: PartyKind[] = ["you", "employer", "government", "manager", "agent", "org", "unknown"];

/** Issuer kinds present among the given tokens, in a fixed display order. */
export function issuerKinds(permits: PermitView[]): PartyKind[] {
  const seen = new Set(permits.map((p) => p.issuer.kind));
  return KIND_ORDER.filter((k) => seen.has(k));
}
