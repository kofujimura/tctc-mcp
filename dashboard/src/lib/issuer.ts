import type { Address, Chain, Hex, PublicClient } from "viem";
import { expiringCtAbi, makeWalletClient, shortAddress, standardCtAbi } from "./core";

export interface TxEntry {
  id: number;
  label: string;
  status: "pending" | "confirmed" | "failed";
  hash?: Hex;
  error?: string;
}

export interface IssuerWrite {
  action: "grant" | "revoke";
  ctAddress: Address;
  typeId: bigint;
  /** ExpiringControlTokens style: grant carries a unix expiry, revoke takes no amount. */
  expiring: boolean;
  to: Address;
  /** grant on an expiring control token: validity from now, in seconds */
  seconds?: number;
  chain: Chain;
  client: PublicClient;
  account: Address;
  pushTx: (entry: TxEntry) => void;
  updateTx: (id: number, patch: Partial<TxEntry>) => void;
  /** tx log label override */
  label?: string;
}

/**
 * Grant = mint, revoke = burnByIssuer (the kill switch), signed by the
 * connected browser wallet as the control token's owner(). Resolves true
 * once the transaction is confirmed.
 */
export async function issuerWrite(w: IssuerWrite): Promise<boolean> {
  const id = Date.now() + Math.random();
  const verb = w.action === "grant" ? "Grant" : "Revoke";
  w.pushTx({
    id,
    label:
      w.label ??
      `${verb} typeId ${w.typeId.toString()} ${w.action === "grant" ? "→" : "from"} ${shortAddress(w.to)}`,
    status: "pending",
  });
  try {
    const wc = makeWalletClient(w.chain);
    try {
      await wc.switchChain({ id: w.chain.id });
    } catch {
      try {
        await wc.addChain({ chain: w.chain });
        await wc.switchChain({ id: w.chain.id });
      } catch {
        /* let the write surface the real error */
      }
    }
    const common = { address: w.ctAddress, account: w.account, chain: w.chain } as const;
    let hash: Hex;
    if (w.action === "grant") {
      hash = w.expiring
        ? await wc.writeContract({
            ...common,
            abi: expiringCtAbi,
            functionName: "mint",
            args: [w.to, w.typeId, BigInt(Math.floor(Date.now() / 1000) + (w.seconds ?? 3600))],
          })
        : await wc.writeContract({
            ...common,
            abi: standardCtAbi,
            functionName: "mint",
            args: [w.to, w.typeId, 1n],
          });
    } else {
      hash = w.expiring
        ? await wc.writeContract({
            ...common,
            abi: expiringCtAbi,
            functionName: "burnByIssuer",
            args: [w.to, w.typeId],
          })
        : await wc.writeContract({
            ...common,
            abi: standardCtAbi,
            functionName: "burnByIssuer",
            args: [w.to, w.typeId, 1n],
          });
    }
    w.updateTx(id, { hash });
    await w.client.waitForTransactionReceipt({ hash });
    w.updateTx(id, { status: "confirmed" });
    return true;
  } catch (e) {
    const message = e instanceof Error ? e.message.split("\n")[0] : String(e);
    w.updateTx(id, { status: "failed", error: message });
    return false;
  }
}

export const DURATIONS: { label: string; seconds: number }[] = [
  { label: "2 minutes", seconds: 120 },
  { label: "10 minutes", seconds: 600 },
  { label: "1 hour", seconds: 3600 },
  { label: "1 day", seconds: 86400 },
  { label: "7 days", seconds: 604800 },
  { label: "30 days", seconds: 2592000 },
];
