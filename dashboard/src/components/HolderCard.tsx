import { useEffect, useRef, useState, type ReactNode } from "react";
import { shortAddress } from "../lib/core";
import { diffSnapshots, type AgentState, type HeldToken } from "../lib/agents";
import type { Activity } from "../lib/story";
import type { PartyView, PermitView } from "../lib/world";
import { Icon, PartyAvatar, type IconName } from "./Avatar";
import { PermitCard } from "./PermitCard";

interface Props {
  /** the viewer (a person) or one of their agents */
  variant: "human" | "agent";
  party: PartyView;
  /** agents: a link signed by the agent's own key was verified */
  verified?: boolean;
  /** undefined while the first read is in flight */
  state?: AgentState;
  toPermit: (token: HeldToken) => PermitView;
  tokenHref?: (token: HeldToken) => string | undefined;
  addressHref?: string;
  canRevoke?: (token: HeldToken) => boolean;
  onRevoke?: (token: HeldToken) => Promise<void> | void;
  /** what the holder is doing right now (story mode) */
  activity?: Activity;
  /** under the name, e.g. the collections this person issues */
  aside?: ReactNode;
  /** after the tokens, e.g. the grant control */
  extra?: ReactNode;
  emptyText: string;
  /** how long a burned token stays on screen, in ms */
  ghostMs?: number;
}

interface Ghost {
  token: HeldToken;
  reason: "revoked" | "expired";
  at: number;
}

const GHOST_MS = 9000;
const FRESH_MS = 4000;

const TONE_ICON: Record<Activity["tone"], IconName> = {
  ok: "dot",
  idle: "dot",
  warn: "alert",
  denied: "block",
};

function useNow(enabled: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [enabled]);
  return now;
}

/**
 * A holder and the tokens it holds. The same card serves the person at
 * the top of the page and each agent below; only the shapes differ.
 */
export function HolderCard({
  variant,
  party,
  verified,
  state,
  toPermit,
  tokenHref,
  addressHref,
  canRevoke,
  onRevoke,
  activity,
  aside,
  extra,
  emptyText,
  ghostMs = GHOST_MS,
}: Props) {
  const [ghosts, setGhosts] = useState<Ghost[]>([]);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [busyKey, setBusyKey] = useState<string>();
  const prev = useRef<AgentState>();

  // Diff consecutive snapshots: vanished tokens linger as "burned" ghosts,
  // new ones get a mint animation — the kill switch made visible.
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
      setTimeout(() => setGhosts((g) => g.filter((x) => x.at !== now)), ghostMs);
    }
    if (born.length) {
      setGhosts((g) => g.filter((x) => !born.includes(x.token.key)));
      setFresh((f) => new Set([...f, ...born]));
      setTimeout(() => setFresh((f) => new Set([...f].filter((k) => !born.includes(k)))), FRESH_MS);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const tokens = state?.tokens ?? [];
  const lapsed = state?.lapsed ?? [];
  const anyCountdown = tokens.some((t) => t.expiresAt !== undefined && t.expiresAt > 0n) || lapsed.length > 0;
  const now = useNow(anyCountdown);
  const shape = variant === "human" ? "certificate" : "pass";
  const noun = variant === "human" ? "credential" : "token";

  async function revoke(token: HeldToken) {
    if (!onRevoke) return;
    setBusyKey(token.key);
    try {
      await onRevoke(token);
    } finally {
      setBusyKey(undefined);
    }
  }

  return (
    <article className={`holder holder-${variant}`}>
      <header className="holder-head">
        <PartyAvatar party={party} size={variant === "human" ? 76 : 58} />
        <div className="holder-id">
          <div className="holder-name-row">
            <h3>{party.name}</h3>
            {variant === "agent" && verified === true && (
              <span
                className="chip chip-yes"
                title="A link signed by this account's private key was verified. The key never left the agent."
              >
                <Icon name="check" size={12} /> key-verified
              </span>
            )}
            {variant === "agent" && verified === false && (
              <span className="chip" title="Added by address; not proven by an agent-signed link">
                unverified
              </span>
            )}
          </div>
          {party.note && <p className="holder-note">{party.note}</p>}
          {party.address && (
            <div className="holder-addr">
              <code
                title={`${party.address} (click to copy)`}
                onClick={() => party.address && navigator.clipboard?.writeText(party.address)}
              >
                {shortAddress(party.address)}
              </code>
              {addressHref && (
                <a className="explorer-link" href={addressHref} target="_blank" rel="noreferrer">
                  explorer ↗
                </a>
              )}
            </div>
          )}
          {aside}
        </div>
        <div className="holder-status">
          {activity && (
            <span className={`activity activity-${activity.tone}`}>
              <Icon name={TONE_ICON[activity.tone]} size={13} />
              {activity.text}
            </span>
          )}
          {state ? (
            <span className={`count ${tokens.length > 0 ? "count-some" : "count-none"}`}>
              {tokens.length > 0
                ? `${tokens.length} ${noun}${tokens.length === 1 ? "" : "s"}`
                : variant === "human"
                  ? "no credentials"
                  : "no permissions"}
            </span>
          ) : (
            <span className="count count-none">reading chain…</span>
          )}
        </div>
      </header>

      <div className={`permit-row permit-row-${shape}`}>
        {tokens.map((t) => (
          <PermitCard
            key={`live-${t.key}`}
            permit={toPermit(t)}
            shape={shape}
            variant="live"
            fresh={fresh.has(t.key)}
            now={now}
            href={tokenHref?.(t)}
            onRevoke={canRevoke?.(t) ? () => revoke(t) : undefined}
            busy={busyKey === t.key}
          />
        ))}
        {ghosts.map((g) => (
          <PermitCard
            key={`ghost-${g.token.key}-${g.at}`}
            permit={toPermit(g.token)}
            shape={shape}
            variant="ghost"
            ghostReason={g.reason}
            ghostMs={ghostMs}
            now={now}
          />
        ))}
        {lapsed.map((t) => (
          <PermitCard
            key={`lapsed-${t.key}`}
            permit={toPermit(t)}
            shape={shape}
            variant="lapsed"
            now={now}
            href={tokenHref?.(t)}
          />
        ))}
        {state && tokens.length === 0 && ghosts.length === 0 && lapsed.length === 0 && (
          <div className="permit-empty">{emptyText}</div>
        )}
        {extra}
      </div>
    </article>
  );
}
