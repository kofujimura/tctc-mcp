/**
 * The directory: human-readable labels for the addresses and tokens the
 * dashboard shows — like a contacts list.
 *
 * The chain says which account issued a token (the collection's owner())
 * and which account holds it, but not that the issuer is "the employer" or
 * that typeId 1 is a "Staff Agent Pass". Those labels live here: built-in
 * defaults for the Sepolia demo, plus whatever the user names in this
 * browser (localStorage, per chain). Labels never change what a target
 * enforces; they only change what a card says.
 */
import type { Address } from "viem";

/** Who a party is to the viewer. "you" and "agent" are derived, the rest are labels. */
export type PartyKind = "you" | "agent" | "employer" | "government" | "manager" | "org" | "unknown";

/** Kinds a user can assign to an issuer. */
export const LABEL_KINDS: PartyKind[] = ["employer", "government", "manager", "org", "unknown"];

export const KIND_LABEL: Record<PartyKind, string> = {
  you: "You",
  agent: "AI agent",
  employer: "Employer",
  government: "Government",
  manager: "Manager",
  org: "Organization",
  unknown: "Unlabelled",
};

export interface PartyLabel {
  name?: string;
  kind?: PartyKind;
  /** one line on what this party does, e.g. "Bookkeeping agent" */
  note?: string;
  /** "bot:<hue>:<variant>" for a generated robot, or an image data URL */
  avatar?: string;
}

export interface TokenLabel {
  title?: string;
}

export interface MeLabel {
  /** used when no wallet is connected */
  address?: Address;
  name?: string;
  note?: string;
  avatar?: string;
}

export interface Directory {
  me: MeLabel;
  /** lower-case address → label */
  parties: Record<string, PartyLabel>;
  /** tokenKey() → label */
  tokens: Record<string, TokenLabel>;
}

export const EMPTY_DIRECTORY: Directory = { me: {}, parties: {}, tokens: {} };

/** Built-in labels for the public demo deployments. */
export const DEFAULT_DIRECTORY: Record<number, Directory> = {
  11155111: {
    me: {},
    parties: {},
    tokens: {
      "0x12342a7f0190b3af3f4b47546d34006eda54ee0b:1": { title: "MinterCert" },
      "0x12342a7f0190b3af3f4b47546d34006eda54ee0b:2": { title: "BurnerCert" },
    },
  },
};

/** `over` wins field by field; empty strings count as "not set". */
export function mergeDirectory(base: Directory, over: Directory): Directory {
  const clean = <T extends object>(o: T): Partial<T> =>
    Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== "")) as Partial<T>;
  const mergeMap = <T extends object>(a: Record<string, T>, b: Record<string, T>) => {
    const out: Record<string, T> = { ...a };
    for (const [k, v] of Object.entries(b)) out[k] = { ...(a[k] ?? {}), ...clean(v) } as T;
    return out;
  };
  return {
    me: { ...base.me, ...clean(over.me) },
    parties: mergeMap(base.parties, over.parties),
    tokens: mergeMap(base.tokens, over.tokens),
  };
}

const storageKey = (chainId: number) => `tctc.directory.${chainId}`;

export function loadDirectory(chainId: number): Directory {
  try {
    const raw = window.localStorage.getItem(storageKey(chainId));
    const parsed = raw ? (JSON.parse(raw) as Partial<Directory>) : {};
    return {
      me: parsed.me ?? {},
      parties: parsed.parties ?? {},
      tokens: parsed.tokens ?? {},
    };
  } catch {
    return EMPTY_DIRECTORY;
  }
}

export function saveDirectory(chainId: number, directory: Directory): void {
  try {
    window.localStorage.setItem(storageKey(chainId), JSON.stringify(directory));
  } catch {
    /* private mode / quota (a large image): the labels live for this session only */
  }
}
