import { useEffect, useState } from "react";
import type { Address, Chain, PublicClient } from "viem";
import { isAddress } from "../lib/core";
import { DURATIONS, issuerWrite, type TxEntry } from "../lib/issuer";

export type { TxEntry } from "../lib/issuer";

interface Props {
  ctAddress: Address;
  typeId: bigint;
  expiring: boolean;
  chain: Chain;
  client: PublicClient;
  account: Address;
  defaultTo: string;
  pushTx: (entry: TxEntry) => void;
  updateTx: (id: number, patch: Partial<TxEntry>) => void;
  onChanged: () => void;
}

/**
 * Grant / revoke controls, shown only when the connected wallet is the
 * owner() of this control token. Grant = mint, revoke = burnByIssuer (the
 * kill switch). For expiring control tokens the grant carries a unix expiry.
 */
export function IssuerActions({
  ctAddress,
  typeId,
  expiring,
  chain,
  client,
  account,
  defaultTo,
  pushTx,
  updateTx,
  onChanged,
}: Props) {
  const [to, setTo] = useState(defaultTo);
  const [touched, setTouched] = useState(false);
  const [seconds, setSeconds] = useState(3600);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!touched) setTo(defaultTo);
  }, [defaultTo, touched]);

  async function send(action: "grant" | "revoke") {
    if (!isAddress(to)) return;
    setBusy(true);
    const ok = await issuerWrite({
      action,
      ctAddress,
      typeId,
      expiring,
      to,
      seconds,
      chain,
      client,
      account,
      pushTx,
      updateTx,
    });
    setBusy(false);
    if (ok) onChanged();
  }

  return (
    <div className="issuer-actions">
      <span
        className="issuer-tag"
        title="Your connected wallet is the owner() of this control token, so you can grant and revoke"
      >
        issuer: you
      </span>
      <span className="recipient-label">recipient</span>
      <input
        className="addr-input small"
        value={to}
        placeholder="0x… recipient"
        title="Address to grant to / revoke from (defaults to the subject above)"
        onChange={(e) => {
          setTo(e.target.value.trim());
          setTouched(true);
        }}
        spellCheck={false}
      />
      {expiring && (
        <select value={seconds} onChange={(e) => setSeconds(Number(e.target.value))}>
          {DURATIONS.map((d) => (
            <option key={d.seconds} value={d.seconds}>
              {d.label}
            </option>
          ))}
        </select>
      )}
      <button
        className="btn grant"
        disabled={busy || !isAddress(to)}
        onClick={() => send("grant")}
      >
        {expiring ? "Grant (timed)" : "Grant"}
      </button>
      <button
        className="btn revoke"
        disabled={busy || !isAddress(to)}
        onClick={() => send("revoke")}
        title="burnByIssuer — immediate on-chain revocation, no holder cooperation needed"
      >
        Revoke ✕
      </button>
    </div>
  );
}
