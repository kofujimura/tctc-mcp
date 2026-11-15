/**
 * Dashboard view model (dashboard/src/lib/world.ts, directory.ts) and
 * story mode (story.ts): who a token's issuer is to the viewer, what a
 * card is called, and that replaying a story's scenes yields the holdings
 * the talk describes — one token for four applications, an expiry with
 * no transaction, one burn that removes everything it opened.
 */
import { describe, it, expect } from "vitest";
import type { Address } from "viem";
import { diffSnapshots, tokenKey, type AgentEntry, type CollectionMeta, type HeldToken } from "../dashboard/src/lib/agents.js";
import { mergeDirectory, type Directory } from "../dashboard/src/lib/directory.js";
import {
  ICA2026,
  STORIES,
  manualRevoke,
  replay,
  storyActivity,
  storyStates,
  storyView,
} from "../dashboard/src/lib/story.js";
import { issuedBy, issuerKinds, permitView, resolveParty, type ViewContext } from "../dashboard/src/lib/world.js";

const ME = "0x1111111111111111111111111111111111111111" as Address;
const AGENT = "0x2222222222222222222222222222222222222222" as Address;
const EMPLOYER = "0x3333333333333333333333333333333333333333" as Address;
const STRANGER = "0x4444444444444444444444444444444444444444" as Address;
const MINE = "0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa" as Address;
const THEIRS = "0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB" as Address;
const BOTS = "0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC" as Address;

const agents: AgentEntry[] = [{ address: AGENT, name: "Kit", verified: true, addedAt: "" }];

function context(directory: Partial<Directory> = {}): ViewContext {
  const collections = new Map<string, CollectionMeta>(
    (
      [
        { address: MINE, name: "My Delegations", owner: ME, standard: "erc1155", expiring: false },
        { address: THEIRS, name: "Acme Passes", owner: EMPLOYER, standard: "erc1155", expiring: true },
        { address: BOTS, name: "Kit's Tickets", owner: AGENT, standard: "erc1155", expiring: true },
      ] satisfies CollectionMeta[]
    ).map((c) => [c.address.toLowerCase(), c]),
  );
  return {
    me: ME,
    agents,
    collections,
    conferred: new Map([
      [tokenKey(MINE, 1n), [{ role: "RELEASER", target: STRANGER, targetLabel: "Release registry" }]],
    ]),
    directory: { me: {}, parties: {}, tokens: {}, ...directory },
  };
}

const held = (collection: Address, typeId: bigint): HeldToken => ({
  key: tokenKey(collection, typeId),
  collection,
  standard: "erc1155",
  typeId,
  balance: 1n,
});

describe("resolveParty", () => {
  it("calls the viewer's own address you, by the name set for it", () => {
    expect(resolveParty(ME, context())).toMatchObject({ kind: "you", name: "You" });
    expect(resolveParty(ME, context({ me: { name: "Mika" } }))).toMatchObject({ kind: "you", name: "Mika" });
  });

  it("recognises a rostered agent, so a token it issued says an agent issued it", () => {
    expect(resolveParty(AGENT, context())).toMatchObject({ kind: "agent", name: "Kit" });
  });

  it("takes any other issuer's name and kind from the directory", () => {
    const ctx = context({ parties: { [EMPLOYER.toLowerCase()]: { name: "Acme Corp", kind: "employer" } } });
    expect(resolveParty(EMPLOYER, ctx)).toMatchObject({ kind: "employer", name: "Acme Corp" });
  });

  it("shows an unlabelled issuer by its short address, and a missing owner as unknown", () => {
    expect(resolveParty(STRANGER, context())).toMatchObject({ kind: "unknown", name: "0x4444…4444" });
    expect(resolveParty(undefined, context()).kind).toBe("unknown");
  });

  it("matches addresses regardless of letter case", () => {
    expect(resolveParty(ME.toUpperCase().replace("0X", "0x") as Address, context()).kind).toBe("you");
  });
});

describe("permitView", () => {
  it("titles a card from the directory, else from the collection name and id", () => {
    const key = tokenKey(MINE, 1n);
    expect(permitView(held(MINE, 1n), context()).title).toBe("My Delegations #1");
    expect(permitView(held(MINE, 1n), context({ tokens: { [key]: { title: "Release assistant" } } })).title).toBe(
      "Release assistant",
    );
  });

  it("marks a token the viewer issued as theirs to burn, and lists what it opens", () => {
    const mine = permitView(held(MINE, 1n), context());
    expect(mine.byYou).toBe(true);
    expect(mine.places.map((p) => p.targetLabel)).toEqual(["Release registry"]);
    const theirs = permitView(held(THEIRS, 1n), context());
    expect(theirs.byYou).toBe(false);
    expect(theirs.places).toEqual([]);
  });

  it("lists the issuer kinds on screen in a fixed order", () => {
    const ctx = context({ parties: { [EMPLOYER.toLowerCase()]: { kind: "employer" } } });
    const permits = [held(BOTS, 1n), held(THEIRS, 1n), held(MINE, 1n)].map((t) => permitView(t, ctx));
    expect(issuerKinds(permits)).toEqual(["you", "employer", "agent"]);
  });

  it("finds the collections an account issues", () => {
    expect(issuedBy(context().collections, ME).map((c) => c.name)).toEqual(["My Delegations"]);
    expect(issuedBy(context().collections, undefined)).toEqual([]);
  });
});

describe("mergeDirectory", () => {
  const base: Directory = {
    me: {},
    parties: { a: { name: "Built-in", kind: "org" } },
    tokens: { t: { title: "MinterCert" } },
  };

  it("lets this browser's label win field by field", () => {
    const merged = mergeDirectory(base, { me: { name: "Mika" }, parties: { a: { kind: "employer" } }, tokens: {} });
    expect(merged.me.name).toBe("Mika");
    expect(merged.parties.a).toEqual({ name: "Built-in", kind: "employer" });
    expect(merged.tokens.t.title).toBe("MinterCert");
  });

  it("treats a cleared field as not set, so the built-in label shows again", () => {
    const merged = mergeDirectory(base, { me: {}, parties: { a: { name: "" } }, tokens: { t: { title: "" } } });
    expect(merged.parties.a.name).toBe("Built-in");
    expect(merged.tokens.t.title).toBe("MinterCert");
  });
});

describe("stories", () => {
  const T0 = 1_700_000_000_000;

  it.each(Object.values(STORIES))("$id: every scene refers only to cast, tokens and doors that exist", (story) => {
    const view = storyView(story);
    expect(view.agents.length).toBeGreaterThan(0);
    const entered = story.scenes.map((_, i) => T0 + i * 1000);
    const state = replay(story, entered, [], T0 + 60_000);
    // every holder with a grant is on screen, and every token has a title and something it opens
    const states = storyStates(story, state, T0 + 60_000);
    for (const g of state.grants) {
      const holder = story.parties.find((p) => p.id === g.holder);
      expect(holder && states.has(holder.address.toLowerCase())).toBe(true);
    }
    for (const [key, places] of view.conferred) {
      expect(view.directory.tokens[key]?.title).toBeTruthy();
      expect(places.length).toBeGreaterThan(0);
    }
  });

  describe("ica2026: grant once, revoke everywhere", () => {
    const story = ICA2026;
    const view = storyView(story);
    const ctx: ViewContext = { ...view };
    const kit = view.agents[0].address.toLowerCase();
    /** the story after its first `n` scenes, each entered 100 s apart, seen `later` s after the last */
    const at = (n: number, later = 0) => {
      const entered = Array.from({ length: n }, (_, i) => T0 + i * 100_000);
      const now = entered[n - 1] + later * 1000;
      const state = replay(story, entered, [], now);
      return { state, now, states: storyStates(story, state, now), activity: storyActivity(story, state) };
    };

    it("starts with the person holding an employer-issued credential and the agent holding nothing", () => {
      const { states } = at(1);
      const mine = states.get(view.me.toLowerCase())!.tokens.map((t) => permitView(t, ctx));
      expect(mine.map((p) => [p.title, p.issuer.kind])).toEqual([["Employee ID", "employer"]]);
      expect(states.get(kit)!.tokens).toEqual([]);
    });

    it("gives the agent one token that four applications of three kinds accept", () => {
      const { states } = at(2);
      const [permit] = states.get(kit)!.tokens.map((t) => permitView(t, ctx));
      expect(permit.title).toBe("Release assistant");
      expect(permit.byYou).toBe(true);
      expect(permit.places.map((p) => p.via)).toEqual(["mcp", "mcp", "web", "contract"]);
      expect(states.get(kit)!.roles).toHaveLength(4);
    });

    it("walks the agent through the applications as the scene plays", () => {
      expect(at(2, 0).activity.get(kit)?.text).toBe("Reading the project files");
      expect(at(2, 9).activity.get(kit)?.text).toBe("Summarising the changelog");
      expect(at(2, 13).activity.get(kit)?.text).toBe("Recording the release on-chain");
    });

    it("adds a timed token from a second issuer", () => {
      const { states, now } = at(3);
      const pass = states.get(kit)!.tokens.map((t) => permitView(t, ctx)).find((p) => !p.byYou)!;
      expect(pass.issuer).toMatchObject({ kind: "employer", name: "Acme Corp" });
      expect(Number(pass.token.expiresAt) - Math.floor(now / 1000)).toBe(30 * 60);
    });

    it("lets that token lapse by time alone: listed as lapsed, never as burned", () => {
      const before = at(4, 5);
      const after = at(4, 7);
      expect(before.states.get(kit)!.tokens).toHaveLength(2);
      expect(after.states.get(kit)!.tokens.map((t) => permitView(t, ctx).title)).toEqual(["Release assistant"]);
      expect(after.states.get(kit)!.lapsed).toHaveLength(1);
      expect(diffSnapshots(before.states.get(kit)!, after.states.get(kit)!, after.now).vanished).toEqual([]);
      expect(before.activity.get(kit)?.tone).toBe("ok");
      expect(after.activity.get(kit)?.tone).toBe("denied");
    });

    it("removes everything the delegation opened with one burn", () => {
      const before = at(5);
      const after = at(6);
      expect(after.states.get(kit)!.tokens).toEqual([]);
      expect(after.states.get(kit)!.roles).toEqual([]);
      const { vanished } = diffSnapshots(before.states.get(kit)!, after.states.get(kit)!, after.now);
      expect(vanished.map((v) => [permitView(v.token, ctx).title, v.reason])).toEqual([
        ["Release assistant", "revoked"],
      ]);
    });

    it("lets the viewer burn only the tokens the viewer issued", () => {
      const { states } = at(3);
      const [release, pass] = states.get(kit)!.tokens;
      const agent = view.agents[0].address;
      expect(manualRevoke(story, agent, release.key)).toEqual({ op: "revoke", from: "kit", token: "release" });
      expect(manualRevoke(story, agent, pass.key)).toBeUndefined();
    });
  });
});
