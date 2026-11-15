import { formatRemaining } from "../lib/core";
import { KIND_LABEL } from "../lib/directory";
import type { PermitView } from "../lib/world";
import { Icon, KindIcon, PartyAvatar } from "./Avatar";

/** The kind of application behind a door, when it is known. */
const VIA_LABEL = { mcp: "MCP server", web: "Web API", contract: "Smart contract" } as const;

interface Props {
  permit: PermitView;
  /** a person's credential is a landscape certificate; an agent's token is a portrait pass */
  shape: "certificate" | "pass";
  variant: "live" | "lapsed" | "ghost";
  ghostReason?: "revoked" | "expired";
  /** how long a ghost takes to fade out, in ms */
  ghostMs?: number;
  /** just minted: plays the mint animation */
  fresh?: boolean;
  /** ms, for countdowns */
  now: number;
  /** explorer page for this token and holder */
  href?: string;
  /** present only when the viewer issued this token and may burn it */
  onRevoke?: () => void;
  busy?: boolean;
}

/**
 * One permission, drawn as the token it is: what it is called, who issued
 * it, which doors it opens, and until when.
 */
export function PermitCard({
  permit,
  shape,
  variant,
  ghostReason,
  ghostMs,
  fresh,
  now,
  href,
  onRevoke,
  busy,
}: Props) {
  const { token, issuer } = permit;
  const left =
    token.expiresAt !== undefined && token.expiresAt > 0n ? Number(token.expiresAt) - now / 1000 : undefined;
  const cls = [
    "permit",
    `permit-${shape}`,
    `permit-${variant}`,
    `k-${issuer.kind}`,
    variant === "live" && fresh ? "permit-fresh" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const kindText = permit.byYou ? (shape === "pass" ? "Delegated by you" : "Issued by you") : KIND_LABEL[issuer.kind];
  const idText = `${permit.collectionName} ${permit.idLabel}`;
  // the stamp across a card that no longer counts (drawn by CSS from this attribute)
  const stamp = variant === "live" ? undefined : variant === "ghost" && ghostReason !== "expired" ? "Burned" : "Expired";

  return (
    <article
      className={cls}
      data-stamp={stamp}
      style={variant === "ghost" && ghostMs ? { animationDuration: `${ghostMs}ms` } : undefined}
    >
      <header className="permit-band">
        {shape === "pass" && <span className="permit-hole" aria-hidden />}
        <span className="permit-kind">
          <KindIcon kind={issuer.kind} size={14} />
          {kindText}
        </span>
      </header>

      <div className="permit-body">
        {shape === "certificate" && (
          <div className="permit-seal">
            <PartyAvatar party={issuer} size={40} />
          </div>
        )}
        <div className="permit-main">
          <h4 className="permit-title">{permit.title}</h4>
          <div className="permit-issuer" title={issuer.address}>
            {shape === "pass" && <PartyAvatar party={issuer} size={22} />}
            <span className="permit-by">issued by</span>
            <strong>{issuer.name}</strong>
            {issuer.kind === "you" && issuer.name !== "You" && <span className="you-tag">you</span>}
          </div>
          {permit.places.length > 0 ? (
            <ul className="permit-places">
              {permit.places.map((p) => (
                <li key={`${p.target}-${p.role}`} title={`${p.role} on ${p.targetLabel} (${p.target})`}>
                  <Icon name={p.via ?? "contract"} size={13} />
                  <span className="place-name">{p.targetLabel}</span>
                  {p.via ? (
                    <span className="place-via">{VIA_LABEL[p.via]}</span>
                  ) : (
                    <span className="place-role">{p.role}</span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="permit-noplace">not bound on a watched target</p>
          )}
        </div>
      </div>

      <footer className="permit-foot">
        <div className="permit-foot-row">
          {variant === "ghost" && (
            <span className="state state-burned">
              <Icon name={ghostReason === "expired" ? "clock" : "flame"} />
              {ghostReason === "expired" ? "expired" : "revoked · burned"}
            </span>
          )}
          {variant === "lapsed" && (
            <span className="state state-expired">
              <Icon name="clock" />
              expired{left !== undefined ? ` ${formatRemaining(-left).replace(" left", "")} ago` : ""} · no transaction
            </span>
          )}
          {variant === "live" && left !== undefined && (
            <span
              className={`state ${left < 600 ? "state-warn" : "state-timed"}`}
              title={`expires ${new Date(Number(token.expiresAt) * 1000).toLocaleString()} — the balance turns 0 by itself`}
            >
              <Icon name="clock" />
              {formatRemaining(left)}
            </span>
          )}
          {variant === "live" && left === undefined && <span className="state state-open">no expiry</span>}
          {variant === "live" && onRevoke && (
            <button
              className="btn revoke btn-sm"
              disabled={busy}
              onClick={onRevoke}
              title="burnByIssuer — the holder loses this permission at every door that reads the ledger"
            >
              {busy ? "Revoking…" : "Revoke"}
            </button>
          )}
        </div>
        {href ? (
          <a className="permit-id" href={href} target="_blank" rel="noreferrer" title={token.collection}>
            {idText}
          </a>
        ) : (
          <span className="permit-id" title={token.collection}>
            {idText}
          </span>
        )}
      </footer>
    </article>
  );
}
