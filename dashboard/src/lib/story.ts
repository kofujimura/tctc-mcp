/**
 * Story mode: a scripted world shown through the same cards as the live
 * view, for talks and screen recordings (?story=ica2026).
 *
 * Nothing here is read from a chain. A story is a cast, a set of tokens
 * and a list of scenes; replaying the scenes yields who holds what, in
 * the same shapes the chain reader produces (AgentState, CollectionMeta,
 * Conferred), so every card, countdown and burn animation is the real
 * one. All addresses are obviously made up (0x1000…0001).
 *
 * The cast and wording for the IEEE ICA 2026 talk live in ICA2026 and
 * ICA2026_WIDE below; docs/ICA2026_TALK_SCENARIO.md explains the scenes.
 */
import type { Address } from "viem";
import {
  tokenKey,
  type AgentEntry,
  type AgentState,
  type CollectionMeta,
  type Conferred,
  type EffectiveRole,
  type HeldToken,
} from "./agents";
import type { Directory, PartyKind } from "./directory";

export type Tone = "ok" | "warn" | "denied" | "idle";

export interface Activity {
  text: string;
  tone: Tone;
}

export interface StoryParty {
  id: string;
  address: Address;
  name: string;
  kind: PartyKind;
  note?: string;
  avatar?: string;
}

export interface StoryCollection {
  id: string;
  address: Address;
  name: string;
  /** party id of the issuer: the collection's owner() */
  issuer: string;
}

export interface StoryDoor {
  id: string;
  address: Address;
  label: string;
  via: "contract" | "mcp" | "web";
}

export interface StoryToken {
  id: string;
  collection: string;
  typeId: bigint;
  title: string;
  /** [role, door id] pairs this token satisfies */
  opens: [string, string][];
}

export type StoryOp =
  | { op: "grant"; to: string; token: string; ttl?: number }
  | { op: "revoke"; from: string; token: string }
  /** make a held token expire `in` seconds after the scene starts */
  | { op: "expire"; of: string; token: string; in: number }
  /** what a party is doing; `after` delays it (seconds from the scene start) */
  | { op: "status"; who: string; text: string; tone: Tone; after?: number };

export interface StoryScene {
  title: string;
  caption: string;
  ops: StoryOp[];
}

export interface Story {
  id: string;
  title: string;
  /** party id of the viewer */
  me: string;
  parties: StoryParty[];
  collections: StoryCollection[];
  doors: StoryDoor[];
  tokens: StoryToken[];
  scenes: StoryScene[];
}

/** 0x<prefix>000…<n>: a made-up address that reads as one at a glance. */
function fake(prefix: string, n: number): Address {
  const tail = n.toString(16).padStart(4, "0");
  return `0x${prefix}${"0".repeat(40 - prefix.length - tail.length)}${tail}` as Address;
}

/**
 * The concept video's story (about six minutes): one employee, one agent,
 * two issuers. One token Mika mints is accepted by four applications —
 * two MCP servers, a web API and a smart contract, the paper's case study
 * — and one burn closes all four. A second, timed token from her employer
 * shows a different issuer and an expiry that needs no transaction.
 */
export const ICA2026: Story = {
  id: "ica2026",
  title: "Grant once, revoke everywhere",
  me: "mika",
  parties: [
    { id: "mika", address: fake("1000", 1), name: "Mika Sato", kind: "you", note: "Software engineer · Acme Corp", avatar: "person:18" },
    { id: "acme", address: fake("2000", 1), name: "Acme Corp", kind: "employer" },
    { id: "kit", address: fake("a100", 1), name: "Kit", kind: "agent", note: "Mika's coding agent", avatar: "bot:212:5" },
  ],
  collections: [
    { id: "staff", address: fake("c100", 1), name: "Acme Staff Credentials", issuer: "acme" },
    { id: "mine", address: fake("c200", 1), name: "Mika's Delegations", issuer: "mika" },
    { id: "ops", address: fake("c300", 1), name: "Acme Production Passes", issuer: "acme" },
  ],
  doors: [
    { id: "files", address: fake("d100", 1), label: "Project files", via: "mcp" },
    { id: "memory", address: fake("d200", 1), label: "Agent memory", via: "mcp" },
    { id: "summary", address: fake("d300", 1), label: "Summary API", via: "web" },
    { id: "registry", address: fake("d400", 1), label: "Release registry", via: "contract" },
    { id: "deploy", address: fake("d500", 1), label: "Deploy pipeline", via: "web" },
    { id: "delegations", address: fake("d600", 1), label: "Issuing delegations", via: "contract" },
  ],
  tokens: [
    // held by the human
    { id: "employee", collection: "staff", typeId: 1n, title: "Employee ID", opens: [["STAFF", "summary"], ["ISSUER", "delegations"]] },
    // the delegation token: one token, four applications
    {
      id: "release",
      collection: "mine",
      typeId: 1n,
      title: "Release assistant",
      opens: [["RELEASER", "files"], ["RELEASER", "memory"], ["RELEASER", "summary"], ["RELEASER", "registry"]],
    },
    // a qualification token from another issuer, with a time limit
    { id: "prod", collection: "ops", typeId: 1n, title: "Production access · 30 min", opens: [["DEPLOYER", "deploy"]] },
  ],
  scenes: [
    {
      title: "Mika and her agent",
      caption:
        "Mika is an engineer at Acme Corp. What she may do is a token too: an Employee ID her employer issued. Her coding agent, Kit, holds nothing yet, so it can do nothing.",
      ops: [
        { op: "grant", to: "mika", token: "employee" },
        { op: "status", who: "kit", text: "Waiting — no permissions", tone: "idle" },
      ],
    },
    {
      title: "Grant once",
      caption:
        "Mika mints one token to Kit. Four applications accept it: two MCP servers, a web API and a smart contract. None of them keeps its own list of who is allowed.",
      ops: [
        { op: "grant", to: "kit", token: "release" },
        { op: "status", who: "kit", text: "Reading the project files", tone: "ok" },
        { op: "status", who: "kit", text: "Saving facts to memory", tone: "ok", after: 4 },
        { op: "status", who: "kit", text: "Summarising the changelog", tone: "ok", after: 8 },
        { op: "status", who: "kit", text: "Recording the release on-chain", tone: "ok", after: 12 },
      ],
    },
    {
      title: "Another issuer, a time limit",
      caption:
        "For the deployment, Acme's operations team issues its own token to Kit, valid for 30 minutes. A different issuer, the same wallet, and no administrator the two share.",
      ops: [
        { op: "grant", to: "kit", token: "prod", ttl: 30 * 60 },
        { op: "status", who: "kit", text: "Deploying release 2.4", tone: "ok" },
      ],
    },
    {
      title: "Time runs out",
      caption:
        "The pass reaches its expiry. No transaction is sent and nobody is online: the door simply stops accepting it, and Kit reports the denial instead of retrying.",
      ops: [
        { op: "expire", of: "kit", token: "prod", in: 6 },
        { op: "status", who: "kit", text: "Denied: deploy — the pass has expired", tone: "denied", after: 6 },
      ],
    },
    {
      title: "Something goes wrong",
      caption:
        "A poisoned file steers Kit off its task. Mika does not need the agent's cooperation to stop it.",
      ops: [{ op: "status", who: "kit", text: "Off task: trying to upload the source tree", tone: "warn" }],
    },
    {
      title: "One burn, every door",
      caption:
        "Mika burns the one token she issued. All four applications read the same ledger, so all four close at the next request.",
      ops: [
        { op: "revoke", from: "kit", token: "release" },
        { op: "status", who: "kit", text: "Denied at every door — delegation revoked", tone: "denied" },
      ],
    },
    {
      title: "On one screen",
      caption:
        "What may this agent do, until when, and how do I stop it now? Each answer is a token you can see, issued by someone you can name.",
      ops: [],
    },
  ],
};

/**
 * A wider tableau for an optional establishing shot: four agents and
 * every kind of issuer at once (employer, government, manager, the
 * person herself, another agent). Too much to narrate in six minutes;
 * useful as a single frame for "anyone a door trusts can issue".
 */
export const ICA2026_WIDE: Story = {
  id: "ica2026-wide",
  title: "Many issuers",
  me: "mika",
  parties: [
    { id: "mika", address: fake("1000", 1), name: "Mika Sato", kind: "you", note: "Accountant · Acme Corp", avatar: "person:18" },
    { id: "acme", address: fake("2000", 1), name: "Acme Corp", kind: "employer" },
    { id: "tax", address: fake("3000", 1), name: "Tax Agency", kind: "government" },
    { id: "kenji", address: fake("4000", 1), name: "Kenji Mori", kind: "manager", note: "Mika's manager" },
    { id: "ledger", address: fake("a100", 1), name: "Ledger", kind: "agent", note: "Bookkeeping agent", avatar: "bot:212:5" },
    { id: "payer", address: fake("a200", 2), name: "Payer", kind: "agent", note: "Payments agent", avatar: "bot:28:74" },
    { id: "filer", address: fake("a300", 3), name: "Filer", kind: "agent", note: "Tax-filing agent", avatar: "bot:268:17" },
    { id: "mini", address: fake("a400", 4), name: "Mini", kind: "agent", note: "Sub-agent of Ledger · invoice matching", avatar: "bot:168:43" },
  ],
  collections: [
    { id: "staff", address: fake("c100", 1), name: "Acme Staff Credentials", issuer: "acme" },
    { id: "licence", address: fake("c200", 1), name: "Tax Agency Licences", issuer: "tax" },
    { id: "finance", address: fake("c300", 1), name: "Acme Finance Approvals", issuer: "kenji" },
    { id: "mine", address: fake("c400", 1), name: "Mika's Delegations", issuer: "mika" },
    { id: "agentpass", address: fake("c500", 1), name: "Acme Agent Passes", issuer: "acme" },
    { id: "registry", address: fake("c600", 1), name: "Tax Agency Registrations", issuer: "tax" },
    { id: "tickets", address: fake("c700", 1), name: "Ledger's Task Tickets", issuer: "ledger" },
  ],
  doors: [
    { id: "files", address: fake("d100", 1), label: "Company files", via: "mcp" },
    { id: "ledgerApi", address: fake("d200", 1), label: "Ledger API", via: "web" },
    { id: "payApi", address: fake("d300", 1), label: "Payments API", via: "web" },
    { id: "payContract", address: fake("d400", 1), label: "Payments contract", via: "contract" },
    { id: "taxDocs", address: fake("d500", 1), label: "Tax documents", via: "mcp" },
    { id: "portal", address: fake("d600", 1), label: "e-Filing portal", via: "web" },
    { id: "delegations", address: fake("d700", 1), label: "Mika's Delegations", via: "contract" },
  ],
  tokens: [
    // held by the human
    { id: "employee", collection: "staff", typeId: 1n, title: "Employee ID", opens: [["STAFF", "ledgerApi"], ["ISSUER", "delegations"]] },
    { id: "accountant", collection: "licence", typeId: 7n, title: "Certified Tax Accountant", opens: [["LICENSEE", "portal"]] },
    { id: "approver", collection: "finance", typeId: 2n, title: "Payment Approver ≤ $5,000", opens: [["APPROVER", "payContract"]] },
    // delegation tokens: issued by the human to her own agents
    { id: "dBook", collection: "mine", typeId: 1n, title: "Bookkeeping delegation", opens: [["BOOKKEEPER", "files"], ["BOOKKEEPER", "ledgerApi"]] },
    { id: "dPay", collection: "mine", typeId: 2n, title: "Payment delegation", opens: [["PAYER", "payApi"], ["PAYER", "payContract"]] },
    { id: "dFile", collection: "mine", typeId: 3n, title: "Filing delegation", opens: [["FILER", "taxDocs"], ["FILER", "portal"]] },
    // qualification tokens: issued by other parties
    { id: "staffPass", collection: "agentpass", typeId: 1n, title: "Staff Agent Pass", opens: [["STAFF_AGENT", "ledgerApi"], ["STAFF_AGENT", "files"]] },
    { id: "budget", collection: "finance", typeId: 5n, title: "Budget ≤ $5,000 · today", opens: [["SPENDER", "payContract"]] },
    { id: "registered", collection: "registry", typeId: 3n, title: "Registered Filing Agent", opens: [["FILING_AGENT", "portal"]] },
    // issued by an agent to its sub-agent
    { id: "ticket", collection: "tickets", typeId: 1n, title: "Invoice-matching ticket", opens: [["MATCHER", "files"]] },
  ],
  scenes: [
    {
      title: "Mika's own credentials",
      caption:
        "Mika is an accountant. What she may do is a set of tokens issued by her employer, a government agency and her manager. Her agents hold nothing yet, so they can do nothing.",
      ops: [
        { op: "grant", to: "mika", token: "employee" },
        { op: "grant", to: "mika", token: "accountant" },
        { op: "grant", to: "mika", token: "approver" },
        { op: "status", who: "ledger", text: "Waiting — no permissions", tone: "idle" },
        { op: "status", who: "payer", text: "Waiting — no permissions", tone: "idle" },
        { op: "status", who: "filer", text: "Waiting — no permissions", tone: "idle" },
        { op: "status", who: "mini", text: "Not started", tone: "idle" },
      ],
    },
    {
      title: "She delegates",
      caption:
        "Mika gives each agent one job by minting a delegation token to it. The token cannot be passed on, and she alone can burn it.",
      ops: [
        { op: "grant", to: "ledger", token: "dBook" },
        { op: "grant", to: "payer", token: "dPay" },
        { op: "grant", to: "filer", token: "dFile" },
        { op: "status", who: "ledger", text: "Reading company files", tone: "ok" },
        { op: "status", who: "payer", text: "Waiting for a budget", tone: "idle" },
        { op: "status", who: "filer", text: "Waiting for registration", tone: "idle" },
      ],
    },
    {
      title: "Other issuers add their own",
      caption:
        "The employer, the tax agency and the manager each issue a token of their own to the agents. No one copied a user list, and no one shares an administrator.",
      ops: [
        { op: "grant", to: "ledger", token: "staffPass" },
        { op: "grant", to: "payer", token: "budget", ttl: 8 * 3600 },
        { op: "grant", to: "filer", token: "registered" },
        { op: "status", who: "ledger", text: "Posting journal entries", tone: "ok" },
        { op: "status", who: "payer", text: "Paying 3 invoices", tone: "ok" },
        { op: "status", who: "filer", text: "Preparing the quarterly return", tone: "ok" },
      ],
    },
    {
      title: "An agent delegates to an agent",
      caption:
        "Ledger hands a short job to a sub-agent with a ticket that lasts 30 minutes. The issuer of this token is an AI agent.",
      ops: [
        { op: "grant", to: "mini", token: "ticket", ttl: 30 * 60 },
        { op: "status", who: "mini", text: "Matching invoices to payments", tone: "ok" },
      ],
    },
    {
      title: "Time runs out",
      caption:
        "The manager's budget token reaches its expiry. No transaction is sent and nobody is online: every door simply stops accepting it.",
      ops: [
        { op: "expire", of: "payer", token: "budget", in: 6 },
        { op: "status", who: "payer", text: "Denied: payment — the budget has expired", tone: "denied", after: 6 },
      ],
    },
    {
      title: "Something goes wrong",
      caption:
        "A poisoned document steers Filer off its task. Mika does not need the agent's cooperation to stop it.",
      ops: [{ op: "status", who: "filer", text: "Off task: trying to e-mail client data", tone: "warn" }],
    },
    {
      title: "One burn, every door",
      caption:
        "Mika burns one token. The portal and the MCP tools read the same ledger, so both close at once. The agency's registration is untouched, and useless without her delegation.",
      ops: [
        { op: "revoke", from: "filer", token: "dFile" },
        { op: "status", who: "filer", text: "Denied at every door — delegation revoked", tone: "denied" },
      ],
    },
    {
      title: "On one screen",
      caption:
        "What may each agent do, until when, and how do I stop it? Every answer is a token you can see, issued by someone you can name.",
      ops: [],
    },
  ],
};

export const STORIES: Record<string, Story> = {
  [ICA2026.id]: ICA2026,
  [ICA2026_WIDE.id]: ICA2026_WIDE,
};

// ─── static view: cast, collections, what each token opens ─────────────────

export interface StoryView {
  me: Address;
  agents: AgentEntry[];
  collections: Map<string, CollectionMeta>;
  conferred: Map<string, Conferred[]>;
  directory: Directory;
}

const need = <T,>(v: T | undefined, what: string): T => {
  if (v === undefined) throw new Error(`story: unknown ${what}`);
  return v;
};

function index(story: Story) {
  const party = (id: string) => need(story.parties.find((p) => p.id === id), `party "${id}"`);
  const collection = (id: string) =>
    need(story.collections.find((c) => c.id === id), `collection "${id}"`);
  const door = (id: string) => need(story.doors.find((d) => d.id === id), `door "${id}"`);
  const token = (id: string) => need(story.tokens.find((t) => t.id === id), `token "${id}"`);
  const keyOf = (id: string) => {
    const t = token(id);
    return tokenKey(collection(t.collection).address, t.typeId);
  };
  return { party, collection, door, token, keyOf };
}

export function storyView(story: Story): StoryView {
  const ix = index(story);
  const me = ix.party(story.me);

  const collections = new Map<string, CollectionMeta>();
  for (const c of story.collections) {
    collections.set(c.address.toLowerCase(), {
      address: c.address,
      name: c.name,
      owner: ix.party(c.issuer).address,
      standard: "erc1155",
      // any timed grant in the script makes the collection an expiring one
      expiring: story.scenes.some((s) =>
        s.ops.some((o) => o.op === "grant" && o.ttl !== undefined && ix.token(o.token).collection === c.id),
      ),
    });
  }

  const conferred = new Map<string, Conferred[]>();
  const directory: Directory = {
    me: { address: me.address, name: me.name, note: me.note, avatar: me.avatar },
    parties: {},
    tokens: {},
  };
  for (const t of story.tokens) {
    const key = ix.keyOf(t.id);
    directory.tokens[key] = { title: t.title };
    conferred.set(
      key,
      t.opens.map(([role, doorId]) => {
        const d = ix.door(doorId);
        return { role, target: d.address, targetLabel: d.label, via: d.via };
      }),
    );
  }
  for (const p of story.parties) {
    directory.parties[p.address.toLowerCase()] = {
      name: p.name,
      kind: p.kind,
      note: p.note,
      avatar: p.avatar,
    };
  }

  const agents: AgentEntry[] = story.parties
    .filter((p) => p.kind === "agent")
    .map((p) => ({ address: p.address, name: p.name, verified: true, addedAt: "" }));

  return { me: me.address, agents, collections, conferred, directory };
}

// ─── replay: scenes → who holds what ────────────────────────────────────────

export interface StoryGrant {
  holder: string;
  token: string;
  /** unix seconds */
  expiresAt?: number;
}

export interface StoryState {
  grants: StoryGrant[];
  status: Record<string, Activity>;
}

/**
 * Apply scenes 0…entered.length-1, each at the moment it was entered
 * (ms), then the viewer's own clicks. Timed grants count from their
 * scene's entry, so a countdown keeps running across re-renders.
 */
export function replay(story: Story, entered: number[], manual: StoryOp[], nowMs: number): StoryState {
  const state: StoryState = { grants: [], status: {} };
  const apply = (op: StoryOp, atMs: number) => {
    const at = Math.floor(atMs / 1000);
    if (op.op === "grant") {
      state.grants = state.grants.filter((g) => !(g.holder === op.to && g.token === op.token));
      state.grants.push({
        holder: op.to,
        token: op.token,
        expiresAt: op.ttl === undefined ? undefined : at + op.ttl,
      });
    } else if (op.op === "revoke") {
      state.grants = state.grants.filter((g) => !(g.holder === op.from && g.token === op.token));
    } else if (op.op === "expire") {
      state.grants = state.grants.map((g) =>
        g.holder === op.of && g.token === op.token ? { ...g, expiresAt: at + op.in } : g,
      );
    } else if (nowMs >= atMs + (op.after ?? 0) * 1000) {
      state.status[op.who] = { text: op.text, tone: op.tone };
    }
  };
  entered.forEach((atMs, i) => story.scenes[i]?.ops.forEach((op) => apply(op, atMs)));
  manual.forEach((op) => apply(op, nowMs));
  return state;
}

/** The replayed state as chain-reader snapshots, keyed by lower-case holder address. */
export function storyStates(story: Story, state: StoryState, nowMs: number): Map<string, AgentState> {
  const ix = index(story);
  const view = storyView(story);
  const out = new Map<string, AgentState>();
  const holders = story.parties.filter((p) => p.kind === "agent" || p.id === story.me);
  for (const p of holders) {
    const st: AgentState = { tokens: [], lapsed: [], roles: [], failed: [], checkedAt: nowMs };
    for (const g of state.grants.filter((x) => x.holder === p.id)) {
      const t = ix.token(g.token);
      const collection = ix.collection(t.collection);
      const live = g.expiresAt === undefined || g.expiresAt * 1000 > nowMs;
      const held: HeldToken = {
        key: tokenKey(collection.address, t.typeId),
        collection: collection.address,
        standard: "erc1155",
        typeId: t.typeId,
        balance: live ? 1n : 0n,
        expiresAt: g.expiresAt === undefined ? undefined : BigInt(g.expiresAt),
      };
      if (!live) {
        st.lapsed.push(held);
        continue;
      }
      st.tokens.push(held);
      for (const c of view.conferred.get(held.key) ?? []) {
        const role: EffectiveRole = { role: c.role, target: c.target, targetLabel: c.targetLabel };
        if (!st.roles.some((r) => r.role === role.role && r.target === role.target)) st.roles.push(role);
      }
    }
    out.set(p.address.toLowerCase(), st);
  }
  return out;
}

/** Party statuses keyed by lower-case address, for the cards. */
export function storyActivity(story: Story, state: StoryState): Map<string, Activity> {
  const out = new Map<string, Activity>();
  for (const p of story.parties) {
    const a = state.status[p.id];
    if (a) out.set(p.address.toLowerCase(), a);
  }
  return out;
}

/** The op for the viewer burning a token it issued, or undefined if it cannot. */
export function manualRevoke(story: Story, holder: Address, key: string): StoryOp | undefined {
  const ix = index(story);
  const party = story.parties.find((p) => p.address.toLowerCase() === holder.toLowerCase());
  const token = story.tokens.find((t) => ix.keyOf(t.id) === key);
  if (!party || !token) return undefined;
  if (ix.collection(token.collection).issuer !== story.me) return undefined;
  return { op: "revoke", from: party.id, token: token.id };
}
