import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { Address, Chain, PublicClient } from "viem";
import { formatRemaining, shortAddress } from "../lib/core";
import {
  diffSnapshots,
  hueOf,
  tokenKey,
  type AgentEntry,
  type AgentState,
  type CollectionMeta,
  type Conferred,
  type HeldToken,
} from "../lib/agents";
import { DURATIONS, issuerWrite, type TxEntry } from "../lib/issuer";

interface Props {
  agent: AgentEntry;
  state?: AgentState;
  collections: Map<string, CollectionMeta>;
  conferred: Map<string, Conferred[]>;
  /** bound ERC-1155 typeIds per collection (grant shortcuts) */
  bound: Map<string, { address: Address; typeIds: bigint[] }>;
  explorer: string;
  account?: Address;
  chain: Chain;
  client: PublicClient;
  pushTx: (entry: TxEntry) => void;
  updateTx: (id: number, patch: Partial<TxEntry>) => void;
  onChanged: () => void;
  onRemove: () => void;
  onUseAsSubject?: () => void;
}

interface Ghost {
  token: HeldToken;
  reason: "revoked" | "expired";
  at: number;
}

const GHOST_MS = 9000;
const FRESH_MS = 4000;

function useNow(enabled: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [enabled]);
  return now;
}

export function AgentAvatar({ address, name }: { address: Address; name?: string }) {
  const style = {
    "--h1": hueOf(address),
    "--h2": hueOf(`${address}:2`),
  } as CSSProperties;
  const initial = name?.trim()?.[0]?.toUpperCase();
  return (
    <div className="agent-avatar" style={style} aria-hidden>
      {initial ?? "🤖"}
    </div>
  );
}

export function AgentCard({
  agent,
  state,
  collections,
  conferred,
  bound,
  explorer,
  account,
  chain,
  client,
  pushTx,
  updateTx,
  onChanged,
  onRemove,
  onUseAsSubject,
}: Props) {
  const [ghosts, setGhosts] = useState<Ghost[]>([]);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [busyKey, setBusyKey] = useState<string>();
  const [showGrant, setShowGrant] = useState(false);
  const prev = useRef<AgentState>();

  // Diff consecutive on-chain snapshots: vanished tokens linger as "burned"
  // ghosts, new ones get a mint animation — the kill switch made visible.
  useEffect(() => {
    if (!state) return;
    const before = prev.current;
    prev.current = state;
    if (!before) return;
    const now = Date.now();
    const live = new Set(state.tokens.map((t) => t.key));
    const { vanished, born } = diffSnapshots(before, state, now);
    const gone: Ghost[] = vanished.map((v) => ({ ...v, at: now }));
    if (gone.length) {
      setGhosts((g) => [...g.filter((x) => !live.has(x.token.key)), ...gone]);
      setTimeout(() => setGhosts((g) => g.filter((x) => x.at !== now)), GHOST_MS);
    }
    if (born.length) {
      setGhosts((g) => g.filter((x) => !born.includes(x.token.key)));
      setFresh((f) => new Set([...f, ...born]));
      setTimeout(
        () => setFresh((f) => new Set([...f].filter((k) => !born.includes(k)))),
        FRESH_MS,
      );
    }
  }, [state]);

  useEffect(() => {
    if (!confirmRemove) return;
    const t = setTimeout(() => setConfirmRemove(false), 3000);
    return () => clearTimeout(t);
  }, [confirmRemove]);

  const tokens = state?.tokens ?? [];
  const lapsed = state?.lapsed ?? [];
  const roles = state?.roles ?? [];
  const anyCountdown = tokens.some((t) => t.expiresAt !== undefined && t.expiresAt > 0n) || lapsed.length > 0;
  const now = useNow(anyCountdown);

  const isIssuer = (t: HeldToken) => {
    const owner = collections.get(t.collection.toLowerCase())?.owner;
    return Boolean(account && owner && owner.toLowerCase() === account.toLowerCase());
  };

  async function revoke(t: HeldToken) {
    if (!account || t.typeId === undefined) return;
    const meta = collections.get(t.collection.toLowerCase());
    setBusyKey(t.key);
    const ok = await issuerWrite({
      action: "revoke",
      ctAddress: t.collection,
      typeId: t.typeId,
      expiring: Boolean(meta?.expiring),
      to: agent.address,
      chain,
      client,
      account,
      pushTx,
      updateTx,
      label: `Revoke #${t.typeId} (${meta?.name ?? shortAddress(t.collection)}) from ${agent.name ?? shortAddress(agent.address)}`,
    });
    setBusyKey(undefined);
    if (ok) onChanged();
  }

  function tokenCard(t: HeldToken, variant: "live" | "lapsed" | "ghost", ghost?: Ghost) {
    const meta = collections.get(t.collection.toLowerCase());
    const grants = conferred.get(t.key) ?? [];
    const style = { "--hue": hueOf(t.collection) } as CSSProperties;
    const left = t.expiresAt && t.expiresAt > 0n ? Number(t.expiresAt) - now / 1000 : undefined;
    const cls = [
      "token",
      `token-${variant}`,
      variant === "live" && fresh.has(t.key) ? "token-fresh" : "",
    ].join(" ");
    return (
      <div key={`${variant}-${t.key}`} className={cls} style={style}>
        <div className="token-top">
          <span className={`std ${t.standard === "erc721" ? "std-721" : "std-1155"}`}>
            {t.standard === "erc721" ? "ERC-721" : "ERC-1155"}
          </span>
          {variant === "live" && left !== undefined && (
            <span
              className={`chip ${left < 600 ? "chip-warn" : "chip-yes"}`}
              title={`expires ${new Date(Number(t.expiresAt) * 1000).toLocaleString()} — balanceOf turns 0 by itself`}
            >
              ⏱ {formatRemaining(left)}
            </span>
          )}
          {variant === "lapsed" && <span className="chip chip-no">expired</span>}
          {variant === "ghost" && (
            <span className="chip chip-no">{ghost?.reason === "expired" ? "expired ⏱" : "burned 🔥"}</span>
          )}
        </div>
        <div className="token-id">
          {t.standard === "erc721" ? `×${t.balance.toString()}` : `#${t.typeId?.toString()}`}
        </div>
        <a
          className="token-collection"
          href={`${explorer}/token/${t.collection}?a=${agent.address}`}
          target="_blank"
          rel="noreferrer"
          title={t.collection}
        >
          {meta?.name ?? shortAddress(t.collection)}
        </a>
        <div className="token-grants">
          {grants.length > 0 ? (
            grants.map((g) => (
              <div key={`${g.target}-${g.role}`} className="token-grant" title={`${g.role} on ${g.target}`}>
                → <strong>{g.role}</strong> · {g.targetLabel}
              </div>
            ))
          ) : (
            <div className="token-grant muted">not bound on a watched target</div>
          )}
        </div>
        {variant === "live" && t.standard === "erc1155" && isIssuer(t) && (
          <button
            className="btn revoke btn-sm"
            disabled={busyKey === t.key}
            onClick={() => revoke(t)}
            title="burnByIssuer — immediate on-chain revocation; the agent loses the permission at once"
          >
            {busyKey === t.key ? "Revoking…" : "Revoke ✕"}
          </button>
        )}
        {variant === "lapsed" && left !== undefined && (
          <div className="token-grant muted">
            lapsed {formatRemaining(-left).replace(" left", "")} ago — no transaction needed
          </div>
        )}
      </div>
    );
  }

  const tokenCount = tokens.length;
  const roleCount = roles.length;

  return (
    <div className="agent-card">
      <div className="agent-head">
        <AgentAvatar address={agent.address} name={agent.name} />
        <div className="agent-id">
          <div className="agent-name-row">
            <h3>{agent.name ?? "Unnamed agent"}</h3>
            {agent.verified ? (
              <span
                className="chip chip-yes"
                title={`A link signed by this account's private key was verified${agent.linkedAt ? ` (signed ${new Date(agent.linkedAt).toLocaleString()})` : ""}. The key never left the agent.`}
              >
                ✓ key-verified
              </span>
            ) : (
              <span className="chip" title="Added by address; not proven by an agent-signed link">
                unverified
              </span>
            )}
          </div>
          <div className="agent-addr">
            <code
              title={`${agent.address} (click to copy)`}
              onClick={() => navigator.clipboard?.writeText(agent.address)}
            >
              {shortAddress(agent.address)}
            </code>
            <span className="mini">EOA</span>
            <a
              className="explorer-link"
              href={`${explorer}/address/${agent.address}`}
              target="_blank"
              rel="noreferrer"
            >
              explorer ↗
            </a>
          </div>
        </div>
        <div className="agent-summary">
          {state ? (
            <span className={`badge ${tokenCount > 0 ? "badge-yes" : "badge-none"}`}>
              {tokenCount > 0
                ? `${tokenCount} token${tokenCount === 1 ? "" : "s"} · ${roleCount} role${roleCount === 1 ? "" : "s"}`
                : "NO PERMISSIONS"}
            </span>
          ) : (
            <span className="badge">reading chain…</span>
          )}
          <div className="agent-actions">
            {onUseAsSubject && (
              <button className="btn btn-sm" onClick={onUseAsSubject} title="Check this agent against the inspected target below">
                Use as subject
              </button>
            )}
            <button
              className={`btn btn-sm ${confirmRemove ? "revoke" : ""}`}
              onClick={() => (confirmRemove ? onRemove() : setConfirmRemove(true))}
              title="Remove from this dashboard (on-chain tokens are unaffected)"
            >
              {confirmRemove ? "Remove?" : "✕"}
            </button>
          </div>
        </div>
      </div>

      <div className="token-grid">
        {tokens.map((t) => tokenCard(t, "live"))}
        {ghosts.map((g) => tokenCard(g.token, "ghost", g))}
        {lapsed.map((t) => tokenCard(t, "lapsed"))}
        {state && tokens.length === 0 && ghosts.length === 0 && (
          <div className="token token-empty">
            <div className="token-id">∅</div>
            <div className="token-grant muted">
              holds no control tokens — this agent can do nothing gated by them
            </div>
          </div>
        )}
      </div>

      <div className="agent-roles">
        <span className="recipient-label">effective roles</span>
        {roles.length > 0 ? (
          roles.map((r) => (
            <span
              key={`${r.target}-${r.role}`}
              className="chip chip-yes"
              title={`${r.targetLabel} (${r.target}).hasRole(${r.role}, agent) = true`}
            >
              {r.role} · {r.targetLabel}
            </span>
          ))
        ) : (
          <span className="hint">{state ? "none on the watched targets" : "…"}</span>
        )}
      </div>

      <GrantRow
        open={showGrant}
        setOpen={setShowGrant}
        agent={agent}
        collections={collections}
        conferred={conferred}
        bound={bound}
        account={account}
        chain={chain}
        client={client}
        pushTx={pushTx}
        updateTx={updateTx}
        onChanged={onChanged}
      />
    </div>
  );
}

interface GrantProps {
  open: boolean;
  setOpen: (v: boolean) => void;
  agent: AgentEntry;
  collections: Map<string, CollectionMeta>;
  conferred: Map<string, Conferred[]>;
  bound: Map<string, { address: Address; typeIds: bigint[] }>;
  account?: Address;
  chain: Chain;
  client: PublicClient;
  pushTx: (entry: TxEntry) => void;
  updateTx: (id: number, patch: Partial<TxEntry>) => void;
  onChanged: () => void;
}

/** Mint a control token to this agent — only for collections the connected wallet issues. */
function GrantRow({
  open,
  setOpen,
  agent,
  collections,
  conferred,
  bound,
  account,
  chain,
  client,
  pushTx,
  updateTx,
  onChanged,
}: GrantProps) {
  const issuable = [...collections.values()].filter(
    (c) =>
      c.standard === "erc1155" &&
      account &&
      c.owner?.toLowerCase() === account.toLowerCase(),
  );
  const [col, setCol] = useState<string>("");
  const [typeIdInput, setTypeIdInput] = useState("1");
  const [seconds, setSeconds] = useState(600);
  const [busy, setBusy] = useState(false);

  const selected = collections.get(col) ?? issuable[0];
  const options = selected ? bound.get(selected.address.toLowerCase())?.typeIds ?? [] : [];

  useEffect(() => {
    if (options.length > 0 && !options.some((o) => o.toString() === typeIdInput)) {
      setTypeIdInput(options[0].toString());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.address]);

  if (!account) {
    return <p className="hint grant-hint">Connect the issuer's wallet to grant or revoke this agent's tokens.</p>;
  }
  if (issuable.length === 0) {
    return (
      <p className="hint grant-hint">
        Your wallet ({shortAddress(account)}) is not the issuer of any watched collection.
      </p>
    );
  }
  if (!open) {
    return (
      <div className="row">
        <button className="btn grant btn-sm" onClick={() => setOpen(true)}>
          ＋ Grant a control token
        </button>
      </div>
    );
  }

  const typeId = /^\d+$/.test(typeIdInput) ? BigInt(typeIdInput) : undefined;

  async function grant() {
    if (!selected || typeId === undefined || !account) return;
    setBusy(true);
    const ok = await issuerWrite({
      action: "grant",
      ctAddress: selected.address,
      typeId,
      expiring: selected.expiring,
      seconds,
      to: agent.address,
      chain,
      client,
      account,
      pushTx,
      updateTx,
      label: `Grant #${typeId} (${selected.name ?? shortAddress(selected.address)}) → ${agent.name ?? shortAddress(agent.address)}`,
    });
    setBusy(false);
    if (ok) {
      setOpen(false);
      onChanged();
    }
  }

  return (
    <div className="row grant-row">
      <select
        value={selected?.address.toLowerCase()}
        onChange={(e) => setCol(e.target.value)}
        title="Control-token collection you issue"
      >
        {issuable.map((c) => (
          <option key={c.address} value={c.address.toLowerCase()}>
            {c.name ?? shortAddress(c.address)}
            {c.expiring ? " (auto-expiring)" : ""}
          </option>
        ))}
      </select>
      {options.length > 0 ? (
        <select value={typeIdInput} onChange={(e) => setTypeIdInput(e.target.value)} title="typeId">
          {options.map((id) => {
            const g = selected ? conferred.get(tokenKey(selected.address, id)) ?? [] : [];
            return (
              <option key={id.toString()} value={id.toString()}>
                #{id.toString()}
                {g.length ? ` → ${g.map((x) => `${x.role} · ${x.targetLabel}`).join(", ")}` : ""}
              </option>
            );
          })}
          {!options.some((o) => o.toString() === typeIdInput) && (
            <option value={typeIdInput}>#{typeIdInput}</option>
          )}
        </select>
      ) : null}
      <input
        className="addr-input tiny"
        value={typeIdInput}
        onChange={(e) => setTypeIdInput(e.target.value.trim())}
        title="typeId (any number)"
        spellCheck={false}
      />
      {selected?.expiring && (
        <select value={seconds} onChange={(e) => setSeconds(Number(e.target.value))} title="validity">
          {DURATIONS.map((d) => (
            <option key={d.seconds} value={d.seconds}>
              {d.label}
            </option>
          ))}
        </select>
      )}
      <button className="btn grant btn-sm" disabled={busy || typeId === undefined} onClick={grant}>
        {busy ? "Granting…" : selected?.expiring ? "Grant (timed)" : "Grant"}
      </button>
      <button className="btn btn-sm" onClick={() => setOpen(false)}>
        Cancel
      </button>
    </div>
  );
}
