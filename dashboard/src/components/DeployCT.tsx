import { useState } from "react";
import type { Address, Chain, PublicClient } from "viem";
import {
  ctMetaAbi,
  expiringCtAbi,
  isAddress,
  makeWalletClient,
  shortAddress,
} from "../lib/core";
import {
  ctConstructorAbi,
  expiringCtBytecode,
  standardCtBytecode,
} from "../lib/ct-artifacts";
import { IssuerActions, type TxEntry } from "./IssuerActions";
import { zeroAddress } from "viem";

type Variant = "standard" | "expiring";

interface ManagedCt {
  address: Address;
  name?: string;
  owner?: Address;
  expiring: boolean;
}

interface Props {
  chain: Chain;
  client: PublicClient;
  account?: Address;
  explorer: string;
  pushTx: (entry: TxEntry) => void;
  updateTx: (id: number, patch: Partial<TxEntry>) => void;
}

/**
 * Issue a fresh control-token collection from the browser wallet — the
 * innermost layer of the TCTC onion: issuance governed by onlyOwner alone.
 * The deployed bytecode is byte-identical to the Etherscan-verified Sepolia
 * reference deployments, so explorers auto-verify it by similar match.
 */
export function DeployCT({ chain, client, account, explorer, pushTx, updateTx }: Props) {
  const [variant, setVariant] = useState<Variant>("standard");
  const [ctName, setCtName] = useState("");
  const [busy, setBusy] = useState(false);
  const [manageInput, setManageInput] = useState("");
  const [managed, setManaged] = useState<ManagedCt>();
  const [manageError, setManageError] = useState<string>();
  const [typeIdInput, setTypeIdInput] = useState("1");

  async function loadManaged(address: Address) {
    setManageError(undefined);
    try {
      const res = await client.multicall({
        contracts: [
          { address, abi: ctMetaAbi, functionName: "owner" },
          { address, abi: ctMetaAbi, functionName: "name" },
          {
            address,
            abi: expiringCtAbi,
            functionName: "expiresAt",
            args: [zeroAddress, 0n],
          },
        ],
        allowFailure: true,
      });
      if (res[0].status !== "success") {
        setManaged(undefined);
        setManageError("Could not read owner() — is this a control-token contract?");
        return;
      }
      setManaged({
        address,
        owner: res[0].result as Address,
        name: res[1].status === "success" ? (res[1].result as string) : undefined,
        expiring: res[2].status === "success",
      });
    } catch (e) {
      setManaged(undefined);
      setManageError(e instanceof Error ? e.message.split("\n")[0] : String(e));
    }
  }

  async function deploy() {
    if (!account || !ctName.trim()) return;
    const id = Date.now() + Math.random();
    const label = `Deploy ${variant === "expiring" ? "expiring " : ""}control tokens “${ctName.trim()}”`;
    pushTx({ id, label, status: "pending" });
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
          /* let the deploy surface the real error */
        }
      }
      const hash = await wc.deployContract({
        abi: ctConstructorAbi,
        bytecode: variant === "expiring" ? expiringCtBytecode : standardCtBytecode,
        args: [ctName.trim()],
        account,
        chain,
      });
      updateTx(id, { hash });
      const receipt = await client.waitForTransactionReceipt({ hash });
      const address = receipt.contractAddress;
      if (!address) throw new Error("no contract address in receipt");
      updateTx(id, { status: "confirmed" });
      setManageInput(address);
      await loadManaged(address);
    } catch (e) {
      const message = e instanceof Error ? e.message.split("\n")[0] : String(e);
      updateTx(id, { status: "failed", error: message });
    } finally {
      setBusy(false);
    }
  }

  const typeId = /^\d+$/.test(typeIdInput) ? BigInt(typeIdInput) : undefined;
  const isOwner =
    managed?.owner && account && managed.owner.toLowerCase() === account.toLowerCase();

  return (
    <section className="panel">
      <h2>Issue control tokens</h2>
      <p className="hint">
        Deploy your own soulbound certificate collection — you (the connected wallet)
        become its issuer: only you can mint (grant) and burn (revoke). Bind it from a
        target contract to gate roles with it; one collection can control many targets.
      </p>
      <div className="row">
        <select value={variant} onChange={(e) => setVariant(e.target.value as Variant)}>
          <option value="standard">Standard (revoke by burn)</option>
          <option value="expiring">Auto-expiring (timed grants)</option>
        </select>
        <input
          className="addr-input small"
          placeholder="Collection name, e.g. Acme Ops Certificates"
          value={ctName}
          onChange={(e) => setCtName(e.target.value)}
          spellCheck={false}
        />
        <button
          className="btn primary"
          disabled={busy || !account || !ctName.trim()}
          onClick={deploy}
          title={account ? undefined : "Connect a wallet first"}
        >
          Deploy
        </button>
        {!account && <span className="hint">connect a wallet to deploy</span>}
      </div>

      <div className="row">
        <input
          className="addr-input"
          placeholder="0x… manage an existing control token you issued"
          value={manageInput}
          onChange={(e) => setManageInput(e.target.value.trim())}
          onKeyDown={(e) =>
            e.key === "Enter" && isAddress(manageInput) && loadManaged(manageInput)
          }
          spellCheck={false}
        />
        <button
          className="btn"
          disabled={!isAddress(manageInput)}
          onClick={() => loadManaged(manageInput as Address)}
        >
          Load
        </button>
        {managed && (
          <a
            className="explorer-link"
            href={`${explorer}/address/${managed.address}`}
            target="_blank"
            rel="noreferrer"
          >
            {new URL(explorer).hostname} ↗
          </a>
        )}
      </div>
      {manageError && <p className="hint">{manageError}</p>}

      {managed && (
        <div className="row managed-ct">
          <span className="chip">
            {managed.name ?? shortAddress(managed.address)}
            {managed.expiring ? " · auto-expiring" : ""}
          </span>
          {isOwner && typeId !== undefined ? (
            <>
              <span className="recipient-label">typeId</span>
              <input
                className="addr-input tiny"
                value={typeIdInput}
                onChange={(e) => setTypeIdInput(e.target.value.trim())}
                spellCheck={false}
              />
              <IssuerActions
                ctAddress={managed.address}
                typeId={typeId}
                expiring={managed.expiring}
                chain={chain}
                client={client}
                account={account as Address}
                defaultTo=""
                pushTx={pushTx}
                updateTx={updateTx}
                onChanged={() => loadManaged(managed.address)}
              />
            </>
          ) : isOwner ? (
            <>
              <span className="recipient-label">typeId</span>
              <input
                className="addr-input tiny"
                value={typeIdInput}
                onChange={(e) => setTypeIdInput(e.target.value.trim())}
                spellCheck={false}
              />
              <span className="hint">typeId must be a number</span>
            </>
          ) : (
            <span className="hint">
              issuer is {managed.owner ? shortAddress(managed.owner) : "unknown"} — connect
              that wallet to grant/revoke
            </span>
          )}
        </div>
      )}
      {managed && isOwner && (
        <p className="hint">
          typeIds are yours to assign (1, 2, 3 …) — each typeId is one certificate kind,
          bindable to a role on any target contract.
        </p>
      )}
    </section>
  );
}
