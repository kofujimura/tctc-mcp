import type { ReactNode } from "react";
import type { Address } from "viem";
import type { AgentEntry, AgentState, HeldToken } from "../lib/agents";
import { KIND_LABEL } from "../lib/directory";
import type { Activity } from "../lib/story";
import { agentParty, issuedBy, issuerKinds, permitView, resolveParty, type ViewContext } from "../lib/world";
import { KindIcon } from "./Avatar";
import { HolderCard } from "./HolderCard";

interface Props {
  ctx: ViewContext;
  /** per lower-case holder address */
  states: Map<string, AgentState>;
  /** block explorer base URL; omitted in story mode, where nothing is on a chain */
  explorer?: string;
  /** what each holder is doing (story mode) */
  activity?: Map<string, Activity>;
  showVerified?: boolean;
  canRevoke: (holder: Address, token: HeldToken) => boolean;
  onRevoke: (holder: Address, token: HeldToken) => Promise<void> | void;
  renderGrant?: (agent: AgentEntry) => ReactNode;
  /** no viewer yet: offer to connect a wallet */
  onConnect?: () => void;
  onManage?: () => void;
  /** refresh controls for the live view */
  tools?: ReactNode;
  error?: string;
  /** how long a burned token stays on screen, in ms (longer in a talk) */
  ghostMs?: number;
}

/**
 * The page's main view: a person and their agents, and nothing but the
 * tokens each one holds. The person is on top (round, landscape
 * certificates); the agents are below (square robots, portrait passes).
 */
export function Overview({
  ctx,
  states,
  explorer,
  activity,
  showVerified = true,
  canRevoke,
  onRevoke,
  renderGrant,
  onConnect,
  onManage,
  tools,
  error,
  ghostMs,
}: Props) {
  const toPermit = (t: HeldToken) => permitView(t, ctx);
  const tokenHref = (holder: Address) =>
    explorer ? (t: HeldToken) => `${explorer}/token/${t.collection}?a=${holder}` : undefined;
  const addressHref = (a: Address) => (explorer ? `${explorer}/address/${a}` : undefined);

  const me = ctx.me ? resolveParty(ctx.me, ctx) : undefined;
  const meAddress = ctx.me;
  const mine = issuedBy(ctx.collections, ctx.me);
  const shown = [meAddress, ...ctx.agents.map((a) => a.address)]
    .filter((a): a is Address => Boolean(a))
    .flatMap((a) => states.get(a.toLowerCase())?.tokens ?? []);
  const kinds = issuerKinds(shown.map(toPermit));

  return (
    <div className="stage">
      <section className="zone zone-you">
        <div className="zone-head">
          <div className="zone-label">
            <KindIcon kind="you" size={15} />
            You
            <span>human principal</span>
          </div>
        </div>
        {me && meAddress ? (
          <HolderCard
            variant="human"
            party={me}
            state={states.get(meAddress.toLowerCase())}
            toPermit={toPermit}
            tokenHref={tokenHref(meAddress)}
            addressHref={addressHref(meAddress)}
            canRevoke={(t) => canRevoke(meAddress, t)}
            onRevoke={(t) => onRevoke(meAddress, t)}
            activity={activity?.get(meAddress.toLowerCase())}
            aside={
              mine.length > 0 && (
                <p className="you-issue">
                  <span className="recipient-label">you issue</span>
                  {mine.map((c) => (
                    <span key={c.address} className="chip k-you issue-chip" title={c.address}>
                      {c.name ?? c.address}
                    </span>
                  ))}
                </p>
              )
            }
            emptyText="You hold no credentials on the watched collections."
            ghostMs={ghostMs}
          />
        ) : (
          <div className="zone-empty">
            <p>
              Connect your wallet to see the credentials you hold, and to grant or revoke your agents’
              tokens.
            </p>
            {onConnect && (
              <button className="btn primary" onClick={onConnect}>
                Connect wallet
              </button>
            )}
          </div>
        )}
      </section>

      {ctx.agents.length > 0 && (
        <div className="delegate-divider" aria-hidden>
          <span>{mine.length > 0 ? "you delegate" : "acting for you"}</span>
        </div>
      )}

      <section className="zone zone-agents">
        <div className="zone-head">
          <div className="zone-label">
            <KindIcon kind="agent" size={15} />
            Your agents
            <span>AI · each can do only what its tokens allow</span>
          </div>
          {tools}
        </div>
        {error && <p className="hint error-text">{error}</p>}
        {ctx.agents.length === 0 ? (
          <div className="zone-empty">
            <p>No agents on this dashboard yet.</p>
            {onManage && (
              <button className="btn primary" onClick={onManage}>
                Add an agent
              </button>
            )}
          </div>
        ) : (
          <div className={ctx.agents.length === 1 ? "agent-grid agent-grid-solo" : "agent-grid"}>
            {ctx.agents.map((a) => (
              <HolderCard
                key={a.address}
                variant="agent"
                party={agentParty(a, ctx)}
                verified={showVerified ? a.verified : undefined}
                state={states.get(a.address.toLowerCase())}
                toPermit={toPermit}
                tokenHref={tokenHref(a.address)}
                addressHref={addressHref(a.address)}
                canRevoke={(t) => canRevoke(a.address, t)}
                onRevoke={(t) => onRevoke(a.address, t)}
                activity={activity?.get(a.address.toLowerCase())}
                extra={renderGrant?.(a)}
                emptyText="Holds no tokens — this agent can do nothing they gate."
                ghostMs={ghostMs}
              />
            ))}
          </div>
        )}
      </section>

      {kinds.length > 0 && (
        <div className="legend">
          <span className="recipient-label">issued by</span>
          {kinds.map((k) => (
            <span key={k} className={`legend-item k-${k}`}>
              <span className="legend-dot">
                <KindIcon kind={k} size={12} />
              </span>
              {KIND_LABEL[k]}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
