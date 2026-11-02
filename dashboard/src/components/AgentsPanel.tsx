import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Address, Chain, PublicClient } from "viem";
import { shortAddress, type RoleInfo } from "../lib/core";
import {
  PROBE_TYPE_IDS,
  boundControlTokens,
  conferredRoles,
  fetchAgentStates,
  loadCollectionMeta,
  loadTargets,
  mergeRoles,
  normalizeAddress,
  type AgentState,
  type CollectionMeta,
  type TargetInfo,
} from "../lib/agents";
import type { AgentRegistry } from "../lib/useAgentRegistry";
import type { TxEntry } from "../lib/issuer";
import { AgentCard } from "./AgentCard";

const REFRESH_MS = 12000;

interface Props {
  registry: AgentRegistry;
  /** the target inspected below, with any hand-added roles */
  inspected?: { address: Address; roles: RoleInfo[] };
  explorer: string;
  account?: Address;
  chain: Chain;
  client: PublicClient;
  pushTx: (entry: TxEntry) => void;
  updateTx: (id: number, patch: Partial<TxEntry>) => void;
  /** bumps whenever any part of the page wrote to the chain */
  writeTick: number;
  onWrote: () => void;
  onUseAsSubject?: (address: Address) => void;
}

/**
 * Agents — permissions as tokens. Each AI agent is an EOA; what it may do
 * is exactly the set of control tokens it holds, read live from the chain.
 */
export function AgentsPanel({
  registry,
  inspected,
  explorer,
  account,
  chain,
  client,
  pushTx,
  updateTx,
  writeTick,
  onWrote,
  onUseAsSubject,
}: Props) {
  const { agents } = registry;
  const [addrInput, setAddrInput] = useState("");
  const [nameInput, setNameInput] = useState("");
  const [watchInput, setWatchInput] = useState("");
  const [live, setLive] = useState(true);
  const [error, setError] = useState<string>();
  const [loadedTargets, setLoadedTargets] = useState<TargetInfo[]>([]);
  const [collectionMeta, setCollectionMeta] = useState<Map<string, CollectionMeta>>(new Map());
  const [states, setStates] = useState<Map<string, AgentState>>(new Map());
  const [checkedAt, setCheckedAt] = useState<Date>();

  // ── targets: role structure, read once per watch-list change ─────────────
  const targetKey = registry.targets.map((t) => t.address.toLowerCase()).join(",");
  useEffect(() => {
    let cancelled = false;
    loadTargets(client, registry.targets)
      .then((t) => !cancelled && setLoadedTargets(t))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message.split("\n")[0] : String(e)));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, targetKey]);

  const targets = useMemo(
    () =>
      loadedTargets.map((t) =>
        inspected && t.address.toLowerCase() === inspected.address.toLowerCase()
          ? { ...t, roles: mergeRoles(t.roles, inspected.roles) }
          : t,
      ),
    [loadedTargets, inspected],
  );
  const bound = useMemo(() => boundControlTokens(targets), [targets]);
  const conferred = useMemo(() => conferredRoles(targets), [targets]);

  // ── collections: built-ins + watched + every control token bound on a target
  const collectionAddrs = useMemo(() => {
    const m = new Map<string, Address>();
    for (const c of registry.collections) m.set(c.address.toLowerCase(), c.address);
    for (const [k, v] of bound) if (!m.has(k)) m.set(k, v.address);
    return [...m.values()];
  }, [registry.collections, bound]);
  const collectionKey = collectionAddrs.map((a) => a.toLowerCase()).join(",");

  useEffect(() => {
    let cancelled = false;
    loadCollectionMeta(client, collectionAddrs)
      .then((m) => !cancelled && setCollectionMeta(m))
      .catch(() => {
        /* transient: retried on the next change */
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, collectionKey, writeTick]);

  // ── holdings: one multicall for every agent ──────────────────────────────
  const gen = useRef(0);
  const agentKey = agents.map((a) => a.address.toLowerCase()).join(",");
  const refresh = useCallback(async () => {
    if (agents.length === 0 || collectionMeta.size === 0) return;
    const my = ++gen.current;
    const boundIds = new Map([...bound].map(([k, v]) => [k, v.typeIds]));
    try {
      const next = await fetchAgentStates(
        client,
        agents.map((a) => a.address),
        [...collectionMeta.values()],
        boundIds,
        targets,
      );
      if (my !== gen.current) return;
      setStates((prev) => {
        // a collection whose read failed keeps its previous tokens (no false "burned")
        const merged = new Map<string, AgentState>();
        for (const [k, st] of next) {
          const old = prev.get(k);
          if (old && st.failed.length) {
            const failed = new Set(st.failed);
            merged.set(k, {
              ...st,
              tokens: [...st.tokens, ...old.tokens.filter((t) => failed.has(t.collection.toLowerCase()))],
            });
          } else {
            merged.set(k, st);
          }
        }
        return merged;
      });
      setCheckedAt(new Date());
      setError(undefined);
    } catch (e) {
      if (my === gen.current) setError(e instanceof Error ? e.message.split("\n")[0] : String(e));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, agentKey, collectionMeta, bound, targets]);

  useEffect(() => {
    refresh();
  }, [refresh, writeTick]);

  useEffect(() => {
    if (!live) return;
    const t = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(t);
  }, [live, refresh]);

  useEffect(() => {
    // new chain / RPC: nothing read from the previous one is valid
    setStates(new Map());
    setLoadedTargets([]);
    setCollectionMeta(new Map());
  }, [client]);

  function addAgent() {
    const address = normalizeAddress(addrInput);
    if (!address) {
      setError("Agent address is not a valid 0x address.");
      return;
    }
    registry.addAgent({
      address,
      name: nameInput.trim() || undefined,
      verified: false,
      addedAt: new Date().toISOString(),
    });
    setAddrInput("");
    setNameInput("");
    setError(undefined);
  }

  async function addWatch() {
    const address = normalizeAddress(watchInput);
    if (!address) {
      setError("Not a valid 0x address.");
      return;
    }
    // A target answers IERC7303; anything else is treated as a collection.
    const [info] = await loadTargets(client, [{ address }]).catch(() => [undefined]);
    if (info?.supports) registry.addTarget(address);
    else registry.addCollection(address);
    setWatchInput("");
  }

  const builtinTargets = new Set(registry.targets.filter((t) => t.builtin).map((t) => t.address.toLowerCase()));
  const builtinCollections = new Set(
    registry.collections.filter((c) => c.builtin).map((c) => c.address.toLowerCase()),
  );
  const userCollections = new Set(registry.collections.map((c) => c.address.toLowerCase()));

  return (
    <section className="panel agents-panel">
      <div className="panel-head">
        <div>
          <h2>Agents — permissions as tokens</h2>
          <p className="hint">
            Each AI agent is an EOA. What it may do is exactly the set of control tokens it
            holds — read live from the chain, revocable by burning.
          </p>
        </div>
        <div className="panel-tools">
          <label className="toggle">
            <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} />
            live (12s)
          </label>
          <button className="btn btn-sm" onClick={refresh} disabled={agents.length === 0}>
            Refresh
          </button>
          {checkedAt && agents.length > 0 && (
            <span className="hint">checked {checkedAt.toLocaleTimeString()}</span>
          )}
        </div>
      </div>

      <div className="row">
        <input
          className="addr-input"
          placeholder="0x… agent EOA address"
          value={addrInput}
          onChange={(e) => setAddrInput(e.target.value.trim())}
          onKeyDown={(e) => e.key === "Enter" && addAgent()}
          spellCheck={false}
        />
        <input
          className="addr-input small name-input"
          placeholder="name (optional)"
          value={nameInput}
          onChange={(e) => setNameInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addAgent()}
        />
        <button className="btn primary" onClick={addAgent} disabled={!normalizeAddress(addrInput)}>
          Add agent
        </button>
      </div>

      {error && <p className="hint error-text">{error}</p>}

      {agents.length === 0 ? (
        <ol className="onboarding">
          <li>
            In the agent's folder, give it its own key:{" "}
            <code>npx tctc-mcp agent init --name "Alice"</code>
            <span className="hint"> — writes <code>.env.local</code> with <code>TCTC_AGENT_PRIVATE_KEY</code> (the agent's EOA).</span>
          </li>
          <li>
            Start the agent there with tctc-mcp. It prints a dashboard link signed by that key
            (also: the <code>whoami</code> tool, or <code>npx tctc-mcp agent link</code>).
          </li>
          <li>
            Open the link — the agent appears here, key-verified. Restart it any time: same
            folder, same key, same tokens, same card. Or paste its address above.
          </li>
        </ol>
      ) : (
        <div className="agent-list">
          {agents.map((a) => (
            <AgentCard
              key={a.address}
              agent={a}
              state={states.get(a.address.toLowerCase())}
              collections={collectionMeta}
              conferred={conferred}
              bound={bound}
              explorer={explorer}
              account={account}
              chain={chain}
              client={client}
              pushTx={pushTx}
              updateTx={updateTx}
              onChanged={onWrote}
              onRemove={() => registry.removeAgent(a.address)}
              onUseAsSubject={onUseAsSubject ? () => onUseAsSubject(a.address) : undefined}
            />
          ))}
        </div>
      )}

      <details className="watching">
        <summary>
          Watching {targets.length} target{targets.length === 1 ? "" : "s"} ·{" "}
          {collectionMeta.size} control-token collection{collectionMeta.size === 1 ? "" : "s"}
        </summary>
        <p className="hint">
          Roles are read from the targets' own <code>hasRole()</code>; tokens from the
          collections (ERC-1155 typeIds 0–{PROBE_TYPE_IDS - 1} plus every typeId bound on a
          target). Inspected targets and deployed collections are added automatically.
        </p>
        <div className="watch-list">
          {targets.map((t) => (
            <span key={t.address} className="chip watch-chip" title={t.address}>
              🎯 {t.label}
              {!t.supports && " (no IERC7303)"}
              {!builtinTargets.has(t.address.toLowerCase()) && (
                <button className="chip-x" onClick={() => registry.removeTarget(t.address)} title="stop watching">
                  ×
                </button>
              )}
            </span>
          ))}
          {[...collectionMeta.values()].map((c) => (
            <span key={c.address} className="chip watch-chip" title={c.address}>
              🎫 {c.name ?? shortAddress(c.address)}
              {c.expiring ? " ⏱" : ""}
              {account && c.owner?.toLowerCase() === account.toLowerCase() ? " · you issue" : ""}
              {userCollections.has(c.address.toLowerCase()) &&
                !builtinCollections.has(c.address.toLowerCase()) && (
                  <button
                    className="chip-x"
                    onClick={() => registry.removeCollection(c.address)}
                    title="stop watching"
                  >
                    ×
                  </button>
                )}
            </span>
          ))}
        </div>
        <div className="row">
          <input
            className="addr-input"
            placeholder="0x… watch another target (IERC7303) or control-token collection"
            value={watchInput}
            onChange={(e) => setWatchInput(e.target.value.trim())}
            onKeyDown={(e) => e.key === "Enter" && addWatch()}
            spellCheck={false}
          />
          <button className="btn" onClick={addWatch} disabled={!normalizeAddress(watchInput)}>
            Watch
          </button>
        </div>
      </details>
    </section>
  );
}
