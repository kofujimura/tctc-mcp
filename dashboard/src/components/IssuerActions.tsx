import { useEffect, useState } from "react";
import type { Address, Chain, Hex, PublicClient } from "viem";
import {
  expiringCtAbi,
  isAddress,
  makeWalletClient,
  shortAddress,
  standardCtAbi,
} from "../lib/core";

export interface TxEntry {
  id: number;
  label: string;
  status: "pending" | "confirmed" | "failed";
  hash?: Hex;
  error?: string;
}

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

const DURATIONS: { label: string; seconds: number }[] = [
  { label: "10 minutes", seconds: 600 },
  { label: "1 hour", seconds: 3600 },
  { label: "1 day", seconds: 86400 },
  { label: "7 days", seconds: 604800 },
  { label: "30 days", seconds: 2592000 },
];

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
    const id = Date.now() + Math.random();
    const verb = action === "grant" ? "Grant" : "Revoke";
    pushTx({
      id,
      label: `${verb} typeId ${typeId.toString()} ${action === "grant" ? "→" : "from"} ${shortAddress(to)}`,
      status: "pending",
    });
    setBusy(true);
    try {
      const wc = makeWalletClient(chain);
      try {
        await wc.switchChain({ id: chain.id });
      } catch {
        try {
          await wc.addChain({ chain });
          await wc.switchChain({ id: chain.id });
        } catch {
          /* let the write surface the real error */
        }
      }
      let hash: Hex;
      if (action === "grant") {
        hash = expiring
          ? await wc.writeContract({
              address: ctAddress,
              abi: expiringCtAbi,
              functionName: "mint",
              args: [to, typeId, BigInt(Math.floor(Date.now() / 1000) + seconds)],
              account,
              chain,
            })
          : await wc.writeContract({
              address: ctAddress,
              abi: standardCtAbi,
              functionName: "mint",
              args: [to, typeId, 1n],
              account,
              chain,
            });
      } else {
        hash = expiring
          ? await wc.writeContract({
              address: ctAddress,
              abi: expiringCtAbi,
              functionName: "burnByIssuer",
              args: [to, typeId],
              account,
              chain,
            })
          : await wc.writeContract({
              address: ctAddress,
              abi: standardCtAbi,
              functionName: "burnByIssuer",
              args: [to, typeId, 1n],
              account,
              chain,
            });
      }
      updateTx(id, { hash });
      await client.waitForTransactionReceipt({ hash });
      updateTx(id, { status: "confirmed" });
      onChanged();
    } catch (e) {
      const message = e instanceof Error ? e.message.split("\n")[0] : String(e);
      updateTx(id, { status: "failed", error: message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="issuer-actions">
      <span className="issuer-tag" title="Connected wallet is the owner() of this control token">
        issuer
      </span>
      <input
        className="addr-input small"
        value={to}
        placeholder="0x… recipient"
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
