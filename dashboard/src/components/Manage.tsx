import { useState } from "react";
import type { Address, PublicClient } from "viem";
import { shortAddress } from "../lib/core";
import { PROBE_TYPE_IDS, loadTargets, normalizeAddress, tokenKey, type AgentEntry } from "../lib/agents";
import { KIND_LABEL, LABEL_KINDS, type PartyKind } from "../lib/directory";
import type { AgentRegistry } from "../lib/useAgentRegistry";
import type { DirectoryApi } from "../lib/useDirectory";
import type { Holdings } from "../lib/useHoldings";
import { agentParty, resolveParty, type ViewContext } from "../lib/world";
import { PartyAvatar, isImage, shuffledBot } from "./Avatar";

interface Props {
  registry: AgentRegistry;
  dir: DirectoryApi;
  holdings: Holdings;
  ctx: ViewContext;
  account?: Address;
  client: PublicClient;
}

/** Square-crop an image file to a small PNG data URL that fits in localStorage. */
async function fileToAvatar(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("That file is not an image the browser can read."));
      i.src = url;
    });
    const size = 192;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const g = canvas.getContext("2d");
    if (!g) throw new Error("Canvas is not available in this browser.");
    const s = Math.min(img.naturalWidth, img.naturalHeight);
    g.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, size, size);
    return canvas.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(url);
  }
}

function ImageButton({ onImage, onError }: { onImage: (dataUrl: string) => void; onError: (m: string) => void }) {
  return (
    <label className="btn btn-sm file-btn" title="Use your own picture, e.g. a character from the talk">
      Image…
      <input
        type="file"
        accept="image/*"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          try {
            onImage(await fileToAvatar(file));
          } catch (err) {
            onError(err instanceof Error ? err.message : String(err));
          }
        }}
      />
    </label>
  );
}

/**
 * Everything that is typed rather than looked at: who "you" are, the
 * agent roster, the names shown on cards, and what is watched.
 */
export function ManagePanels({ registry, dir, holdings, ctx, account, client }: Props) {
  const { agents } = registry;
  const { directory } = dir;
  const [addrInput, setAddrInput] = useState("");
  const [nameInput, setNameInput] = useState("");
  const [watchInput, setWatchInput] = useState("");
  const [meAddrInput, setMeAddrInput] = useState(directory.me.address ?? "");
  const [confirmRemove, setConfirmRemove] = useState<string>();
  const [error, setError] = useState<string>();

  function addAgent() {
    const address = normalizeAddress(addrInput);
    if (!address) {
      setError("Agent address is not a valid 0x address.");
      return;
    }
    registry.addAgent({
      address,
      name: nameInput.trim() || undefined,
      verified: false,
      addedAt: new Date().toISOString(),
    });
    setAddrInput("");
    setNameInput("");
    setError(undefined);
  }

  async function addWatch() {
    const address = normalizeAddress(watchInput);
    if (!address) {
      setError("Not a valid 0x address.");
      return;
    }
    // A target answers IERC7303; anything else is treated as a collection.
    const [info] = await loadTargets(client, [{ address }]).catch(() => [undefined]);
    if (info?.supports) registry.addTarget(address);
    else registry.addCollection(address);
    setWatchInput("");
    setError(undefined);
  }

  function removeAgent(a: AgentEntry) {
    if (confirmRemove === a.address) {
      registry.removeAgent(a.address);
      setConfirmRemove(undefined);
    } else {
      setConfirmRemove(a.address);
      setTimeout(() => setConfirmRemove((c) => (c === a.address ? undefined : c)), 3000);
    }
  }

  const me = ctx.me ? resolveParty(ctx.me, ctx) : undefined;

  // issuers: the owner() of every watched collection that is neither you nor a rostered agent
  const issuers = new Map<string, { address: Address; collections: string[] }>();
  for (const c of holdings.collectionMeta.values()) {
    if (!c.owner) continue;
    const kind = resolveParty(c.owner, ctx).kind;
    if (kind === "you" || kind === "agent") continue;
    const k = c.owner.toLowerCase();
    const entry = issuers.get(k) ?? { address: c.owner, collections: [] };
    entry.collections.push(c.name ?? shortAddress(c.address));
    issuers.set(k, entry);
  }

  // token types worth naming: everything held or lapsed, plus every type bound on a target
  const tokenTypes = new Map<string, { collection: string; id: string }>();
  const nameOf = (address: string) =>
    holdings.collectionMeta.get(address.toLowerCase())?.name ?? shortAddress(address);
  for (const st of holdings.states.values()) {
    for (const t of [...st.tokens, ...st.lapsed]) {
      tokenTypes.set(t.key, {
        collection: nameOf(t.collection),
        id: t.standard === "erc721" ? "any token" : `#${t.typeId?.toString()}`,
      });
    }
  }
  for (const b of holdings.bound.values()) {
    for (const id of b.typeIds) {
      const key = tokenKey(b.address, id);
      if (!tokenTypes.has(key)) tokenTypes.set(key, { collection: nameOf(b.address), id: `#${id.toString()}` });
    }
  }

  const builtinTargets = new Set(registry.targets.filter((t) => t.builtin).map((t) => t.address.toLowerCase()));
  const builtinCollections = new Set(
    registry.collections.filter((c) => c.builtin).map((c) => c.address.toLowerCase()),
  );
  const userCollections = new Set(registry.collections.map((c) => c.address.toLowerCase()));

  return (
    <>
      {error && (
        <div className="banner banner-error" onClick={() => setError(undefined)}>
          {error}
        </div>
      )}

      <section className="panel">
        <h2>You</h2>
        <p className="hint">
          The connected wallet is “you”. Without a wallet, set an address here to see what it holds; granting
          and revoking always go through the wallet.
        </p>
        <div className="manage-row">
          {me ? <PartyAvatar party={me} size={44} /> : <span className="avatar-placeholder" />}
          <input
            className="addr-input small name-input"
            placeholder="Your name"
            value={directory.me.name ?? ""}
            onChange={(e) => dir.setMe({ name: e.target.value })}
          />
          <input
            className="addr-input name-input"
            placeholder="What you do, e.g. Accountant · Acme Corp"
            value={directory.me.note ?? ""}
            onChange={(e) => dir.setMe({ note: e.target.value })}
          />
          {account ? (
            <span className="chip chip-yes" title={account}>
              {shortAddress(account)} connected
            </span>
          ) : (
            <input
              className="addr-input small"
              placeholder="0x… your address (view only)"
              value={meAddrInput}
              onChange={(e) => {
                const v = e.target.value.trim();
                setMeAddrInput(v);
                const address = normalizeAddress(v);
                if (address) dir.setMe({ address });
                else if (v === "") dir.setMe({ address: undefined });
              }}
              spellCheck={false}
            />
          )}
          <ImageButton onImage={(avatar) => dir.setMe({ avatar })} onError={setError} />
          {isImage(directory.me.avatar) && (
            <button className="btn btn-sm" onClick={() => dir.setMe({ avatar: "" })}>
              Remove image
            </button>
          )}
        </div>
      </section>

      <section className="panel">
        <h2>Agents</h2>
        <p className="hint">
          Each AI agent is an account of its own. Add it by its signed link or its address; what it may do is
          read from the chain, never typed here.
        </p>
        <div className="row">
          <input
            className="addr-input"
            placeholder="0x… agent address"
            value={addrInput}
            onChange={(e) => setAddrInput(e.target.value.trim())}
            onKeyDown={(e) => e.key === "Enter" && addAgent()}
            spellCheck={false}
          />
          <input
            className="addr-input small name-input"
            placeholder="name (optional)"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addAgent()}
          />
          <button className="btn primary" onClick={addAgent} disabled={!normalizeAddress(addrInput)}>
            Add agent
          </button>
        </div>

        {agents.length === 0 ? (
          <ol className="onboarding">
            <li>
              In the agent's folder, give it its own key: <code>npx tctc-mcp agent init --name "Alice"</code>
              <span className="hint">
                {" "}
                — writes <code>.env.local</code> with <code>TCTC_AGENT_PRIVATE_KEY</code> (the agent's account).
              </span>
            </li>
            <li>
              Start the agent there with tctc-mcp. It prints a dashboard link signed by that key (also: the{" "}
              <code>whoami</code> tool, or <code>npx tctc-mcp agent link</code>).
            </li>
            <li>
              Open the link — the agent appears on the overview, key-verified. Restart it any time: same folder,
              same key, same tokens, same card. Or paste its address above.
            </li>
          </ol>
        ) : (
          <div className="manage-list">
            {agents.map((a) => {
              const label = directory.parties[a.address.toLowerCase()] ?? {};
              const party = agentParty(a, ctx);
              return (
                <div key={a.address} className="manage-row">
                  <button
                    className="avatar-btn"
                    onClick={() => dir.setParty(a.address, { avatar: shuffledBot(label.avatar, party.seed) })}
                    title="Shuffle the generated robot"
                  >
                    <PartyAvatar party={party} size={44} />
                  </button>
                  <input
                    className="addr-input small name-input"
                    placeholder="Agent name"
                    value={a.name ?? ""}
                    onChange={(e) => registry.addAgent({ ...a, name: e.target.value })}
                  />
                  <input
                    className="addr-input name-input"
                    placeholder="What it does, e.g. Bookkeeping agent"
                    value={label.note ?? ""}
                    onChange={(e) => dir.setParty(a.address, { note: e.target.value })}
                  />
                  <code className="mini" title={a.address}>
                    {shortAddress(a.address)}
                  </code>
                  <span className={`chip ${a.verified ? "chip-yes" : ""}`}>
                    {a.verified ? "key-verified" : "unverified"}
                  </span>
                  <ImageButton onImage={(avatar) => dir.setParty(a.address, { avatar })} onError={setError} />
                  {isImage(label.avatar) && (
                    <button className="btn btn-sm" onClick={() => dir.setParty(a.address, { avatar: "" })}>
                      Use robot
                    </button>
                  )}
                  <button
                    className={`btn btn-sm ${confirmRemove === a.address ? "revoke" : ""}`}
                    onClick={() => removeAgent(a)}
                    title="Remove from this dashboard (on-chain tokens are unaffected)"
                  >
                    {confirmRemove === a.address ? "Remove?" : "Remove"}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="panel">
        <h2>Names on the cards</h2>
        <p className="hint">
          The chain knows which account issued a token, not that it is your employer. Name the issuers and the
          token types here; the names stay in this browser, like contacts, and change nothing a target enforces.
        </p>
        {issuers.size === 0 && tokenTypes.size === 0 && <p className="hint">Nothing to name yet.</p>}
        {issuers.size > 0 && (
          <div className="manage-list">
            {[...issuers.values()].map((i) => {
              const label = directory.parties[i.address.toLowerCase()] ?? {};
              return (
                <div key={i.address} className="manage-row">
                  <PartyAvatar party={resolveParty(i.address, ctx)} size={36} />
                  <input
                    className="addr-input small name-input"
                    placeholder={`Issuer name (${shortAddress(i.address)})`}
                    value={label.name ?? ""}
                    onChange={(e) => dir.setParty(i.address, { name: e.target.value })}
                  />
                  <select
                    value={label.kind ?? "unknown"}
                    onChange={(e) => dir.setParty(i.address, { kind: e.target.value as PartyKind })}
                    title="What this issuer is to you"
                  >
                    {LABEL_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {KIND_LABEL[k]}
                      </option>
                    ))}
                  </select>
                  <span className="hint" title={i.address}>
                    issues {i.collections.join(", ")}
                  </span>
                </div>
              );
            })}
          </div>
        )}
        {tokenTypes.size > 0 && (
          <div className="manage-list">
            {[...tokenTypes.entries()].map(([key, t]) => (
              <div key={key} className="manage-row">
                <span className="token-type">
                  {t.collection} <strong>{t.id}</strong>
                </span>
                <input
                  className="addr-input small name-input"
                  placeholder="Card title, e.g. Staff Agent Pass"
                  value={directory.tokens[key]?.title ?? ""}
                  onChange={(e) => dir.setToken(key, { title: e.target.value })}
                />
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="panel watching">
        <h2>Watching</h2>
        <p className="hint">
          Roles are read from the targets' own <code>hasRole()</code>; tokens from the collections (ERC-1155
          typeIds 0–{PROBE_TYPE_IDS - 1} plus every typeId bound on a target). Inspected targets and deployed
          collections are added automatically.
        </p>
        <div className="watch-list">
          {holdings.targets.map((t) => (
            <span key={t.address} className="chip watch-chip" title={t.address}>
              target · {t.label}
              {!t.supports && " (no IERC7303)"}
              {!builtinTargets.has(t.address.toLowerCase()) && (
                <button className="chip-x" onClick={() => registry.removeTarget(t.address)} title="stop watching">
                  ×
                </button>
              )}
            </span>
          ))}
          {[...holdings.collectionMeta.values()].map((c) => (
            <span key={c.address} className="chip watch-chip" title={c.address}>
              tokens · {c.name ?? shortAddress(c.address)}
              {c.expiring ? " · timed" : ""}
              {account && c.owner?.toLowerCase() === account.toLowerCase() ? " · you issue" : ""}
              {userCollections.has(c.address.toLowerCase()) && !builtinCollections.has(c.address.toLowerCase()) && (
                <button
                  className="chip-x"
                  onClick={() => registry.removeCollection(c.address)}
                  title="stop watching"
                >
                  ×
                </button>
              )}
            </span>
          ))}
        </div>
        <div className="row">
          <input
            className="addr-input"
            placeholder="0x… watch another target (IERC7303) or control-token collection"
            value={watchInput}
            onChange={(e) => setWatchInput(e.target.value.trim())}
            onKeyDown={(e) => e.key === "Enter" && addWatch()}
            spellCheck={false}
          />
          <button className="btn" onClick={addWatch} disabled={!normalizeAddress(watchInput)}>
            Watch
          </button>
        </div>
      </section>
    </>
  );
}
