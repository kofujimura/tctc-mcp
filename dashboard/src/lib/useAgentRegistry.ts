import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import type { Address } from "viem";
import {
  DEFAULT_COLLECTIONS,
  DEFAULT_TARGETS,
  loadList,
  mergeContracts,
  saveList,
  upsertAgent,
  type AgentEntry,
  type KnownContract,
} from "./agents";

export interface AgentRegistry {
  agents: AgentEntry[];
  addAgent: (entry: AgentEntry) => void;
  removeAgent: (address: Address) => void;
  /** built-in demo targets + user-watched ones (inspected targets are added automatically) */
  targets: KnownContract[];
  addTarget: (address: Address) => void;
  removeTarget: (address: Address) => void;
  /** built-in demo collections + deployed / loaded / added ones */
  collections: KnownContract[];
  addCollection: (address: Address) => void;
  removeCollection: (address: Address) => void;
}

const NONE: KnownContract[] = [];

/** Per-chain agent roster and watch lists, persisted in this browser's localStorage. */
export function useAgentRegistry(chainId: number): AgentRegistry {
  const [agents, setAgents] = useState<AgentEntry[]>(() => loadList("agents", chainId));
  const [userTargets, setUserTargets] = useState<KnownContract[]>(() => loadList("targets", chainId));
  const [userCollections, setUserCollections] = useState<KnownContract[]>(() =>
    loadList("collections", chainId),
  );

  useEffect(() => {
    setAgents(loadList("agents", chainId));
    setUserTargets(loadList("targets", chainId));
    setUserCollections(loadList("collections", chainId));
  }, [chainId]);

  const addAgent = useCallback(
    (entry: AgentEntry) =>
      setAgents((prev) => {
        const next = upsertAgent(prev, entry);
        saveList("agents", chainId, next);
        return next;
      }),
    [chainId],
  );

  const removeAgent = useCallback(
    (address: Address) =>
      setAgents((prev) => {
        const next = prev.filter((a) => a.address.toLowerCase() !== address.toLowerCase());
        saveList("agents", chainId, next);
        return next;
      }),
    [chainId],
  );

  const listOps = useCallback(
    (
      kind: "targets" | "collections",
      set: Dispatch<SetStateAction<KnownContract[]>>,
      builtins: KnownContract[],
    ) => ({
      add: (address: Address) =>
        set((prev) => {
          const k = address.toLowerCase();
          if (prev.some((c) => c.address.toLowerCase() === k)) return prev;
          if (builtins.some((c) => c.address.toLowerCase() === k)) return prev;
          const next = [...prev, { address }];
          saveList(kind, chainId, next);
          return next;
        }),
      remove: (address: Address) =>
        set((prev) => {
          const next = prev.filter((c) => c.address.toLowerCase() !== address.toLowerCase());
          saveList(kind, chainId, next);
          return next;
        }),
    }),
    [chainId],
  );

  // stable references: a fresh [] per render would re-trigger every dependent effect
  const builtinTargets = DEFAULT_TARGETS[chainId] ?? NONE;
  const builtinCollections = DEFAULT_COLLECTIONS[chainId] ?? NONE;
  const targetOps = useMemo(
    () => listOps("targets", setUserTargets, builtinTargets),
    [listOps, builtinTargets],
  );
  const collectionOps = useMemo(
    () => listOps("collections", setUserCollections, builtinCollections),
    [listOps, builtinCollections],
  );

  const targets = useMemo(
    () => mergeContracts(builtinTargets, userTargets),
    [builtinTargets, userTargets],
  );
  const collections = useMemo(
    () => mergeContracts(builtinCollections, userCollections),
    [builtinCollections, userCollections],
  );

  return {
    agents,
    addAgent,
    removeAgent,
    targets,
    addTarget: targetOps.add,
    removeTarget: targetOps.remove,
    collections,
    addCollection: collectionOps.add,
    removeCollection: collectionOps.remove,
  };
}
