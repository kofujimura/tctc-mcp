import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Address, PublicClient } from "viem";
import type { RoleInfo } from "./core";
import {
  boundControlTokens,
  conferredRoles,
  fetchAgentStates,
  loadCollectionMeta,
  loadTargets,
  mergeRoles,
  type AgentState,
  type CollectionMeta,
  type Conferred,
  type TargetInfo,
} from "./agents";
import type { AgentRegistry } from "./useAgentRegistry";

const REFRESH_MS = 12000;

export interface Holdings {
  targets: TargetInfo[];
  /** bound ERC-1155 typeIds per collection (grant shortcuts) */
  bound: Map<string, { address: Address; typeIds: bigint[] }>;
  conferred: Map<string, Conferred[]>;
  collectionMeta: Map<string, CollectionMeta>;
  /** per lower-case subject address */
  states: Map<string, AgentState>;
  checkedAt?: Date;
  error?: string;
  setError: (message?: string) => void;
  live: boolean;
  setLive: (v: boolean) => void;
  refresh: () => void;
}

interface Options {
  /** false in story mode: nothing is read from the chain */
  enabled: boolean;
  client: PublicClient;
  registry: AgentRegistry;
  /** the target inspected on the Manage page, with any hand-added roles */
  inspected?: { address: Address; roles: RoleInfo[] };
  /** every account whose tokens are shown: the viewer and the agents */
  subjects: Address[];
  /** bumps whenever any part of the page wrote to the chain */
  writeTick: number;
}

/**
 * Reads, for every subject, the control tokens it holds and the roles the
 * watched targets grant it — one multicall per poll, no indexer.
 */
export function useHoldings({ enabled, client, registry, inspected, subjects, writeTick }: Options): Holdings {
  const [live, setLive] = useState(true);
  const [error, setError] = useState<string>();
  const [loadedTargets, setLoadedTargets] = useState<TargetInfo[]>([]);
  const [collectionMeta, setCollectionMeta] = useState<Map<string, CollectionMeta>>(new Map());
  const [states, setStates] = useState<Map<string, AgentState>>(new Map());
  const [checkedAt, setCheckedAt] = useState<Date>();

  // ── targets: role structure, read once per watch-list change ─────────────
  const targetKey = registry.targets.map((t) => t.address.toLowerCase()).join(",");
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    loadTargets(client, registry.targets)
      .then((t) => !cancelled && setLoadedTargets(t))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message.split("\n")[0] : String(e)));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, client, targetKey]);

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
    if (!enabled) return;
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
  }, [enabled, client, collectionKey, writeTick]);

  // ── holdings: one multicall for every subject ────────────────────────────
  const gen = useRef(0);
  const subjectKey = subjects.map((a) => a.toLowerCase()).join(",");
  const refresh = useCallback(async () => {
    if (!enabled || subjects.length === 0 || collectionMeta.size === 0) return;
    const my = ++gen.current;
    const boundIds = new Map([...bound].map(([k, v]) => [k, v.typeIds]));
    try {
      const next = await fetchAgentStates(client, subjects, [...collectionMeta.values()], boundIds, targets);
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
  }, [enabled, client, subjectKey, collectionMeta, bound, targets]);

  useEffect(() => {
    refresh();
  }, [refresh, writeTick]);

  useEffect(() => {
    if (!live || !enabled) return;
    const t = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(t);
  }, [live, enabled, refresh]);

  useEffect(() => {
    // new chain / RPC: nothing read from the previous one is valid
    setStates(new Map());
    setLoadedTargets([]);
    setCollectionMeta(new Map());
  }, [client]);

  return {
    targets,
    bound,
    conferred,
    collectionMeta,
    states,
    checkedAt,
    error,
    setError,
    live,
    setLive,
    refresh,
  };
}
