import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DEFAULT_DIRECTORY,
  EMPTY_DIRECTORY,
  loadDirectory,
  mergeDirectory,
  saveDirectory,
  type Directory,
  type MeLabel,
  type PartyLabel,
  type TokenLabel,
} from "./directory";

export interface DirectoryApi {
  /** built-in defaults with this browser's labels on top */
  directory: Directory;
  setMe: (patch: MeLabel) => void;
  setParty: (address: string, patch: PartyLabel) => void;
  setToken: (key: string, patch: TokenLabel) => void;
}

/** Per-chain labels, persisted in this browser's localStorage. */
export function useDirectory(chainId: number): DirectoryApi {
  const [user, setUser] = useState<Directory>(() => loadDirectory(chainId));

  useEffect(() => {
    setUser(loadDirectory(chainId));
  }, [chainId]);

  const update = useCallback(
    (fn: (d: Directory) => Directory) =>
      setUser((prev) => {
        const next = fn(prev);
        saveDirectory(chainId, next);
        return next;
      }),
    [chainId],
  );

  const setMe = useCallback(
    (patch: MeLabel) => update((d) => ({ ...d, me: { ...d.me, ...patch } })),
    [update],
  );
  const setParty = useCallback(
    (address: string, patch: PartyLabel) =>
      update((d) => {
        const k = address.toLowerCase();
        return { ...d, parties: { ...d.parties, [k]: { ...d.parties[k], ...patch } } };
      }),
    [update],
  );
  const setToken = useCallback(
    (key: string, patch: TokenLabel) =>
      update((d) => ({ ...d, tokens: { ...d.tokens, [key]: { ...d.tokens[key], ...patch } } })),
    [update],
  );

  const directory = useMemo(
    () => mergeDirectory(DEFAULT_DIRECTORY[chainId] ?? EMPTY_DIRECTORY, user),
    [chainId, user],
  );

  return { directory, setMe, setParty, setToken };
}
