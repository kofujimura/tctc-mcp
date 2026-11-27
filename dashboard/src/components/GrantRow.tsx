import { useEffect, useState } from "react";
import type { Address, Chain, PublicClient } from "viem";
import { shortAddress } from "../lib/core";
import { tokenKey, type AgentEntry, type CollectionMeta, type Conferred } from "../lib/agents";
import type { Directory } from "../lib/directory";
import { DURATIONS, issuerWrite, type TxEntry } from "../lib/issuer";
import { issuedBy } from "../lib/world";
import { Icon } from "./Avatar";

interface Props {
  agent: AgentEntry;
  collections: Map<string, CollectionMeta>;
  conferred: Map<string, Conferred[]>;
  /** bound ERC-1155 typeIds per collection (shortcuts) */
  bound: Map<string, { address: Address; typeIds: bigint[] }>;
  directory: Directory;
  account?: Address;
  chain: Chain;
  client: PublicClient;
  pushTx: (entry: TxEntry) => void;
  updateTx: (id: number, patch: Partial<TxEntry>) => void;
  onChanged: () => void;
}

/**
 * Mint a control token to this agent. Shown only when the connected
 * wallet issues at least one watched collection; otherwise there is
 * nothing this viewer could grant.
 */
export function GrantRow({
  agent,
  collections,
  conferred,
  bound,
  directory,
  account,
  chain,
  client,
  pushTx,
  updateTx,
  onChanged,
}: Props) {
  const issuable = issuedBy(collections, account).filter((c) => c.standard === "erc1155");
  const [open, setOpen] = useState(false);
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

  if (!account || issuable.length === 0) return null;

  if (!open) {
    return (
      <button className="permit-add" onClick={() => setOpen(true)} title="Mint a control token you issue to this agent">
        <Icon name="plus" size={18} />
        Grant a token
      </button>
    );
  }

  const typeId = /^\d+$/.test(typeIdInput) ? BigInt(typeIdInput) : undefined;
  const titleOf = (address: Address, id: bigint) => directory.tokens[tokenKey(address, id)]?.title;

  async function grant() {
    if (!selected || typeId === undefined || !account) return;
    setBusy(true);
    const what = titleOf(selected.address, typeId) ?? `#${typeId} (${selected.name ?? shortAddress(selected.address)})`;
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
      label: `Grant ${what} → ${agent.name ?? shortAddress(agent.address)}`,
    });
    setBusy(false);
    if (ok) {
      setOpen(false);
      onChanged();
    }
  }

  return (
    <div className="grant-form">
      <span className="recipient-label">grant to {agent.name ?? shortAddress(agent.address)}</span>
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
      {options.length > 0 && selected && (
        <select value={typeIdInput} onChange={(e) => setTypeIdInput(e.target.value)} title="token type">
          {options.map((id) => {
            const g = conferred.get(tokenKey(selected.address, id)) ?? [];
            const title = titleOf(selected.address, id);
            return (
              <option key={id.toString()} value={id.toString()}>
                {title ? `${title} (#${id.toString()})` : `#${id.toString()}`}
                {g.length ? ` → ${[...new Set(g.map((x) => x.targetLabel))].join(", ")}` : ""}
              </option>
            );
          })}
          {!options.some((o) => o.toString() === typeIdInput) && <option value={typeIdInput}>#{typeIdInput}</option>}
        </select>
      )}
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
