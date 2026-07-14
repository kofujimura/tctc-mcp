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
import type { TxEntry } from "./components/IssuerActions";

type Support = "idle" | "checking" | "yes" | "no";

const REFRESH_MS = 12000;

export default function App() {
  const boot = useMemo(() => new URLSearchParams(window.location.search), []);

  const [chainKey, setChainKey] = useState(
    CHAIN_PRESETS.some((p) => p.key === boot.get("chain"))
      ? (boot.get("chain") as string)
      : "sepolia",
  );
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
      const accounts = (await ethereum.request({
        method: "eth_requestAccounts",
      })) as string[];
      if (accounts[0]) setAccount(accounts[0] as Address);
    } catch (e) {
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
    [client, targetInput, customRoles, chainKey],
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
  }, [refreshEvidence]);

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
          <button className="btn" onClick={connectWallet}>
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
        <section className="panel">
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
              onChanged={refreshEvidence}
            />
          ))}
        </section>
      )}

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
