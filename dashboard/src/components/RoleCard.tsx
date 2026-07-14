import { useEffect, useState } from "react";
import type { Address, Chain, PublicClient } from "viem";
import {
  formatRemaining,
  shortAddress,
  type CtMeta,
  type EvidenceItem,
  type RoleEvidence,
  type RoleInfo,
} from "../lib/core";
import { IssuerActions, type TxEntry } from "./IssuerActions";

interface Props {
  role: RoleInfo;
  evidence?: RoleEvidence;
  meta: Map<string, CtMeta>;
  explorer: string;
  subject?: Address;
  account?: Address;
  chain: Chain;
  client: PublicClient;
  pushTx: (entry: TxEntry) => void;
  updateTx: (id: number, patch: Partial<TxEntry>) => void;
  onChanged: () => void;
}

/** 1-second clock, enabled only when a countdown is actually on screen. */
function useNow(enabled: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [enabled]);
  return now;
}

export function RoleCard({
  role,
  evidence,
  meta,
  explorer,
  subject,
  account,
  chain,
  client,
  pushTx,
  updateTx,
  onChanged,
}: Props) {
  const bindings = role.erc721.length + role.erc1155.length;
  const anyExpiry = (evidence?.items ?? []).some(
    (it) => it.expiresAt !== undefined && it.expiresAt > 0n,
  );
  const now = useNow(anyExpiry);

  function evidenceFor(index: number): EvidenceItem | undefined {
    return evidence?.items[index];
  }

  function balanceChip(item?: EvidenceItem) {
    if (!subject || !item) return null;
    const held = item.balance > 0n;
    return (
      <span className={`chip ${held ? "chip-yes" : "chip-no"}`}>
        balanceOf = {item.balance.toString()}
      </span>
    );
  }

  function expiryChip(item?: EvidenceItem) {
    if (!subject || !item || item.expiresAt === undefined) return null;
    if (item.expiresAt === 0n) return null;
    const left = Number(item.expiresAt) - now / 1000;
    const cls = left <= 0 ? "chip-no" : left < 600 ? "chip-warn" : "chip-yes";
    return (
      <span
        className={`chip ${cls}`}
        title={new Date(Number(item.expiresAt) * 1000).toLocaleString()}
      >
        ⏱ {formatRemaining(left)}
      </span>
    );
  }

  return (
    <div className="role-card">
      <div className="role-head">
        <h3>{role.name}</h3>
        <code
          className="role-hash"
          title={`${role.hash} (click to copy)`}
          onClick={() => navigator.clipboard?.writeText(role.hash)}
        >
          {role.hash.slice(0, 10)}…
        </code>
        {subject &&
          (evidence ? (
            <span className={`badge ${evidence.hasRole ? "badge-yes" : "badge-no"}`}>
              {evidence.hasRole ? "HAS ROLE" : "NO ROLE"}
            </span>
          ) : (
            <span className="badge">…</span>
          ))}
      </div>
      {bindings > 1 && (
        <p className="or-note">
          {bindings} control tokens — holding <strong>any one</strong> grants the role (OR).
        </p>
      )}
      <ul className="bindings">
        {role.erc721.map((a, i) => {
          const m = meta.get(a.toLowerCase());
          const item = evidenceFor(i);
          return (
            <li key={`721-${a}`} className="binding">
              <span className="std std-721">ERC-721</span>
              <a href={`${explorer}/address/${a}`} target="_blank" rel="noreferrer">
                {m?.name ?? shortAddress(a)}
              </a>
              <code className="mini">{shortAddress(a)}</code>
              {balanceChip(item)}
              {account && m?.owner?.toLowerCase() === account.toLowerCase() && (
                <span className="issuer-note">
                  you are the issuer — grant/revoke via the contract (ERC-721 mint
                  interfaces vary)
                </span>
              )}
            </li>
          );
        })}
        {role.erc1155.map((b, j) => {
          const m = meta.get(b.address.toLowerCase());
          const item = evidenceFor(role.erc721.length + j);
          const isIssuer =
            account && m?.owner?.toLowerCase() === account.toLowerCase();
          return (
            <li key={`1155-${b.address}-${b.typeId}`} className="binding">
              <span className="std std-1155">ERC-1155</span>
              <a
                href={`${explorer}/address/${b.address}`}
                target="_blank"
                rel="noreferrer"
              >
                {m?.name ?? shortAddress(b.address)}
              </a>
              <code className="mini">
                {shortAddress(b.address)} · typeId {b.typeId.toString()}
              </code>
              {m?.expiring && (
                <span className="chip chip-info" title="ExpiringControlTokens: balanceOf turns 0 past expiry — gasless auto-revocation">
                  auto-expiry
                </span>
              )}
              {balanceChip(item)}
              {expiryChip(item)}
              {isIssuer && account && (
                <IssuerActions
                  ctAddress={b.address}
                  typeId={b.typeId}
                  expiring={Boolean(m?.expiring)}
                  chain={chain}
                  client={client}
                  account={account}
                  defaultTo={subject ?? ""}
                  pushTx={pushTx}
                  updateTx={updateTx}
                  onChanged={onChanged}
                />
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
