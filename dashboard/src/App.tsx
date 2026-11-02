import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Address, Hex } from "viem";
import {
  CHAIN_PRESETS,
  IERC7303_ID,
  ROLE_DICTIONARY,
  fetchEvidence,
  isAddress,
  makePublicClient,
  probeCtMeta,
  probeRoles,
  probeSupport,
  shortAddress,
  toChain,
  type CtMeta,
  type RoleEvidence,
  type RoleInfo,
} from "./lib/core";
import { RoleCard } from "./components/RoleCard";
import { DeployCT } from "./components/DeployCT";
import { AgentsPanel } from "./components/AgentsPanel";
import type { TxEntry } from "./lib/issuer";
import { useAgentRegistry } from "./lib/useAgentRegistry";
import { parseAgentLink, verifyAgentLink } from "./lib/agent-link";

/** URL params of a signed agent link (stripped once consumed). */
const LINK_PARAMS = ["agent", "name", "ts", "sig", "chainId"];

function bootChainKey(params: URLSearchParams): string {
  const byId = CHAIN_PRESETS.find((p) => String(p.chainId) === params.get("chainId"));
  if (byId) return byId.key;
  const byKey = CHAIN_PRESETS.find((p) => p.key === params.get("chain"));
  return byKey ? byKey.key : "sepolia";
}

type Support = "idle" | "checking" | "yes" | "no";

const REFRESH_MS = 12000;

export default function App() {
  const boot = useMemo(() => new URLSearchParams(window.location.search), []);

  const [chainKey, setChainKey] = useState(() => bootChainKey(boot));
  const [rpcOverride, setRpcOverride] = useState("");
  const [account, setAccount] = useState<Address>();

  const [targetInput, setTargetInput] = useState(boot.get("target") ?? "");
  const [target, setTarget] = useState<Address>();
  const [support, setSupport] = useState<Support>("idle");
  const [customRoles, setCustomRoles] = useState<string[]>(
    boot.get("roles")?.split(",").filter(Boolean) ?? [],
  );
  const [roleInput, setRoleInput] = useState("");
  const [roles, setRoles] = useState<RoleInfo[]>([]);
  const [ctMeta, setCtMeta] = useState<Map<string, CtMeta>>(new Map());

  const [subjectInput, setSubjectInput] = useState(boot.get("subject") ?? "");
  const [live, setLive] = useState(true);
  const [evidence, setEvidence] = useState<Map<Hex, RoleEvidence>>(new Map());
  const [checkedAt, setCheckedAt] = useState<Date>();

  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [txLog, setTxLog] = useState<TxEntry[]>([]);

  const preset = CHAIN_PRESETS.find((p) => p.key === chainKey)!;
  const chain = useMemo(() => toChain(preset, rpcOverride), [preset, rpcOverride]);
  const client = useMemo(() => makePublicClient(chain), [chain]);
  const registry = useAgentRegistry(preset.chainId);

  // Bumped after every confirmed write anywhere on the page, so every view
  // re-reads the chain at once instead of waiting for its next poll.
  const [writeTick, setWriteTick] = useState(0);
  const onWrote = useCallback(() => setWriteTick((t) => t + 1), []);

  const subject: Address | undefined = isAddress(subjectInput)
    ? subjectInput
    : subjectInput.trim() === "" && account
      ? account
      : undefined;

  const pushTx = useCallback(
    (entry: TxEntry) => setTxLog((l) => [entry, ...l].slice(0, 6)),
    [],
  );
  const updateTx = useCallback(
    (id: number, patch: Partial<TxEntry>) =>
      setTxLog((l) => l.map((t) => (t.id === id ? { ...t, ...patch } : t))),
    [],
  );

  async function connectWallet() {
    const ethereum = (window as { ethereum?: { request: (a: object) => Promise<unknown> } })
      .ethereum;
    if (!ethereum) {
      setError("No browser wallet detected — install MetaMask or a compatible wallet.");
      return;
    }
    try {
      // wallet_requestPermissions forces the account picker even when already
      // connected — a plain eth_requestAccounts silently returns the existing
      // account, so switching accounts in the wallet would never reach the page.
      try {
        await ethereum.request({
          method: "wallet_requestPermissions",
          params: [{ eth_accounts: {} }],
        });
      } catch (e) {
        if ((e as { code?: number })?.code === 4001) return; // user closed the picker
        // method unsupported by this wallet — fall through to eth_requestAccounts
      }
      const accounts = (await ethereum.request({
        method: "eth_requestAccounts",
      })) as string[];
      if (accounts[0]) setAccount(accounts[0] as Address);
    } catch (e) {
      if ((e as { code?: number })?.code === 4001) return;
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    const ethereum = (window as { ethereum?: { on?: (ev: string, fn: (a: string[]) => void) => void } })
      .ethereum;
    ethereum?.on?.("accountsChanged", (accounts: string[]) => {
      setAccount(accounts[0] ? (accounts[0] as Address) : undefined);
    });
  }, []);

  const inspect = useCallback(
    async (extraRoles: string[] = customRoles) => {
      setError(undefined);
      setNotice(undefined);
      const input = targetInput.trim();
      if (!isAddress(input)) {
        setError("Target is not a valid 0x address.");
        return;
      }
      setSupport("checking");
      setRoles([]);
      setEvidence(new Map());
      setTarget(input);
      try {
        const ok = await probeSupport(client, input);
        if (!ok) {
          setSupport("no");
          return;
        }
        setSupport("yes");
        registry.addTarget(input);
        const found = await probeRoles(client, input, [
          ...ROLE_DICTIONARY,
          ...extraRoles,
        ]);
        setRoles(found);
        setCtMeta(await probeCtMeta(client, found));
        if (found.length === 0) {
          setNotice(
            "IERC7303 is supported but none of the common role names have bindings — add the contract's role names below.",
          );
        }
        const params = new URLSearchParams();
        params.set("chain", chainKey);
        params.set("target", input);
        if (extraRoles.length > 0) params.set("roles", extraRoles.join(","));
        window.history.replaceState(null, "", `?${params.toString()}`);
      } catch (e) {
        setSupport("idle");
        setError(e instanceof Error ? e.message.split("\n")[0] : String(e));
      }
    },
    [client, targetInput, customRoles, chainKey, registry.addTarget],
  );

  async function addRole() {
    const name = roleInput.trim();
    if (!name || !target) return;
    if (roles.some((r) => r.name === name)) {
      setRoleInput("");
      return;
    }
    try {
      const found = await probeRoles(client, target, [name]);
      if (found.length === 0) {
        setNotice(`No control tokens are bound to "${name}" on this target.`);
        return;
      }
      const merged = [...roles, ...found];
      setRoles(merged);
      setCtMeta(await probeCtMeta(client, merged));
      const nextCustom = [...customRoles, name];
      setCustomRoles(nextCustom);
      setRoleInput("");
      setNotice(undefined);
      const params = new URLSearchParams(window.location.search);
      params.set("roles", nextCustom.join(","));
      window.history.replaceState(null, "", `?${params.toString()}`);
    } catch (e) {
      setError(e instanceof Error ? e.message.split("\n")[0] : String(e));
    }
  }

  const refreshEvidence = useCallback(async () => {
    if (!target || roles.length === 0 || !subject) return;
    try {
      setEvidence(await fetchEvidence(client, target, roles, subject, ctMeta));
      setCheckedAt(new Date());
    } catch {
      /* transient RPC errors: keep the previous evidence */
    }
  }, [client, target, roles, subject, ctMeta]);

  useEffect(() => {
    refreshEvidence();
  }, [refreshEvidence, writeTick]);

  useEffect(() => {
    if (!live) return;
    const t = setInterval(refreshEvidence, REFRESH_MS);
    return () => clearInterval(t);
  }, [live, refreshEvidence]);

  const autoRan = useRef(false);
  useEffect(() => {
    if (!autoRan.current && boot.get("target")) {
      autoRan.current = true;
      inspect();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A signed agent link (printed by tctc-mcp started in the agent's folder):
  // verify the agent's signature, add it to this chain's roster, clean the URL.
  const linkRan = useRef(false);
  useEffect(() => {
    if (linkRan.current) return;
    linkRan.current = true;
    const link = parseAgentLink(boot);
    if (!link) return;
    (async () => {
      const verified = await verifyAgentLink(link);
      registry.addAgent({
        address: link.address,
        name: link.name,
        verified,
        linkedAt: verified ? link.issuedAt : undefined,
        addedAt: new Date().toISOString(),
      });
      const label = `${link.name ? `“${link.name}” ` : ""}(${shortAddress(link.address)})`;
      const chainNote =
        link.chainId !== undefined && link.chainId !== preset.chainId
          ? ` Note: the link is for chain ${link.chainId}, which this dashboard does not support — shown on ${preset.label}.`
          : "";
      setNotice(
        (verified
          ? `Agent ${label} linked — the link is signed by the agent's own key ✓. Its control tokens are shown below and stay visible across agent restarts.`
          : `Agent ${label} added — the link is not signed by the agent's key, so it is marked unverified.`) +
          chainNote,
      );
      const params = new URLSearchParams(window.location.search);
      for (const k of LINK_PARAMS) params.delete(k);
      params.set("chain", preset.key);
      window.history.replaceState(null, "", `?${params.toString()}`);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="app">
      <header>
        <div className="brand">
          <span className="logo">🎫</span>
          <div>
            <h1>TCTC Dashboard</h1>
            <p className="tagline">
              ERC-7303 role manager — a role is a token: grant is a mint, revoke is a
              burn.
            </p>
          </div>
        </div>
        <div className="header-controls">
          <select
            value={chainKey}
            onChange={(e) => {
              setChainKey(e.target.value);
              setSupport("idle");
              setRoles([]);
              setEvidence(new Map());
            }}
          >
            {CHAIN_PRESETS.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </select>
          <button
            className="btn"
            onClick={connectWallet}
            title={account ? "Connected — click to switch account" : "Connect a browser wallet"}
          >
            {account ? shortAddress(account) : "Connect wallet"}
          </button>
        </div>
      </header>

      {error && (
        <div className="banner banner-error" onClick={() => setError(undefined)}>
          {error}
        </div>
      )}
      {notice && (
        <div className="banner banner-info" onClick={() => setNotice(undefined)}>
          {notice}
        </div>
      )}

      <AgentsPanel
        registry={registry}
        inspected={support === "yes" && target ? { address: target, roles } : undefined}
        explorer={preset.explorer}
        account={account}
        chain={chain}
        client={client}
        pushTx={pushTx}
        updateTx={updateTx}
        writeTick={writeTick}
        onWrote={onWrote}
        onUseAsSubject={
          support === "yes"
            ? (address) => {
                setSubjectInput(address);
                document.getElementById("subject-panel")?.scrollIntoView({ behavior: "smooth" });
              }
            : undefined
        }
      />

      <section className="panel">
        <h2>Target contract</h2>
        <p className="hint">
          Any contract implementing the IERC7303 introspection interface — the contract
          itself is the source of truth; nothing is configured here.
        </p>
        <div className="row">
          <input
            className="addr-input"
            placeholder="0x… target contract address"
            value={targetInput}
            onChange={(e) => setTargetInput(e.target.value.trim())}
            onKeyDown={(e) => e.key === "Enter" && inspect()}
            spellCheck={false}
          />
          <button className="btn primary" onClick={() => inspect()}>
            Inspect
          </button>
          {support === "checking" && <span className="chip">checking…</span>}
          {support === "yes" && (
            <span className="chip chip-yes">IERC7303 ✓ ({IERC7303_ID})</span>
          )}
          {support === "no" && (
            <span className="chip chip-no">
              does not declare IERC7303 ({IERC7303_ID})
            </span>
          )}
          {isAddress(targetInput.trim()) && (
            <a
              className="explorer-link"
              href={`${preset.explorer}/address/${targetInput.trim()}`}
              target="_blank"
              rel="noreferrer"
              title={`View this contract on ${new URL(preset.explorer).hostname}`}
            >
              {new URL(preset.explorer).hostname} ↗
            </a>
          )}
        </div>
        {support === "yes" && (
          <div className="row">
            <input
              className="addr-input small"
              placeholder="Add a role name, e.g. CURATOR_ROLE"
              value={roleInput}
              onChange={(e) => setRoleInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addRole()}
              spellCheck={false}
            />
            <button className="btn" onClick={addRole}>
              Add role
            </button>
            <span className="hint">
              common names are probed automatically; add any others
            </span>
          </div>
        )}
      </section>

      {support === "yes" && (
        <section className="panel" id="subject-panel">
          <h2>Subject</h2>
          <div className="row">
            <input
              className="addr-input"
              placeholder={
                account
                  ? `0x… address to check (empty = connected wallet ${shortAddress(account)})`
                  : "0x… address to check (agent wallet, TBA, user…)"
              }
              value={subjectInput}
              onChange={(e) => setSubjectInput(e.target.value.trim())}
              spellCheck={false}
            />
            <label className="toggle">
              <input
                type="checkbox"
                checked={live}
                onChange={(e) => setLive(e.target.checked)}
              />
              live (12s)
            </label>
            <button className="btn" onClick={refreshEvidence} disabled={!subject}>
              Check now
            </button>
            {checkedAt && subject && (
              <span className="hint">
                {shortAddress(subject)} · checked {checkedAt.toLocaleTimeString()}
              </span>
            )}
          </div>
          {registry.agents.length > 0 && (
            <div className="row">
              <span className="recipient-label">agents</span>
              {registry.agents.map((a) => (
                <button
                  key={a.address}
                  className={`chip chip-btn ${
                    subject?.toLowerCase() === a.address.toLowerCase() ? "chip-info" : ""
                  }`}
                  onClick={() => setSubjectInput(a.address)}
                  title={a.address}
                >
                  {a.name ?? shortAddress(a.address)}
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {support === "yes" && roles.length > 0 && (
        <section className="roles">
          {roles.map((role) => (
            <RoleCard
              key={role.hash}
              role={role}
              evidence={evidence.get(role.hash)}
              meta={ctMeta}
              explorer={preset.explorer}
              subject={subject}
              account={account}
              chain={chain}
              client={client}
              pushTx={pushTx}
              updateTx={updateTx}
              onChanged={onWrote}
            />
          ))}
        </section>
      )}

      <DeployCT
        chain={chain}
        client={client}
        account={account}
        explorer={preset.explorer}
        pushTx={pushTx}
        updateTx={updateTx}
        onCollection={registry.addCollection}
        onWrote={onWrote}
      />

      {txLog.length > 0 && (
        <div className="tx-log">
          {txLog.map((t) => (
            <div key={t.id} className={`tx tx-${t.status}`}>
              <span>{t.label}</span>
              <span className="tx-status">
                {t.status === "pending" && "⏳"}
                {t.status === "confirmed" && "✅"}
                {t.status === "failed" && `❌ ${t.error ?? ""}`}
              </span>
              {t.hash && (
                <a
                  href={`${preset.explorer}/tx/${t.hash}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t.hash.slice(0, 10)}…
                </a>
              )}
            </div>
          ))}
        </div>
      )}

      <footer>
        <details>
          <summary>Settings & about</summary>
          <div className="row">
            <label className="hint">RPC override:</label>
            <input
              className="addr-input"
              placeholder={preset.rpcUrl}
              value={rpcOverride}
              onChange={(e) => setRpcOverride(e.target.value)}
              spellCheck={false}
            />
          </div>
          <p className="hint">
            Reads go to the RPC above; writes go through your wallet only — this page
            holds no keys. Everything shown is read from the chain via the IERC7303
            interface (ERC-165 id {IERC7303_ID}); the same on-chain state drives{" "}
            <a href="https://github.com/kofujimura/tctc-mcp" target="_blank" rel="noreferrer">
              tctc-mcp
            </a>{" "}
            for AI agents.{" "}
            <a
              href="https://eips.ethereum.org/EIPS/eip-7303"
              target="_blank"
              rel="noreferrer"
            >
              ERC-7303 spec
            </a>
          </p>
        </details>
      </footer>
    </div>
  );
}
