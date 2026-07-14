import {
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  http,
  keccak256,
  parseAbi,
  stringToHex,
  zeroAddress,
  type Address,
  type Chain,
  type ContractFunctionParameters,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";

/** ERC-165 interface id of IERC7303 (XOR of its three function selectors). */
export const IERC7303_ID = "0x4ee69337" as const;

/** Canonical Multicall3 address (same on virtually every EVM chain). */
export const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11" as const;

export interface ChainPreset {
  key: string;
  label: string;
  chainId: number;
  rpcUrl: string;
  explorer: string;
}

export const CHAIN_PRESETS: ChainPreset[] = [
  {
    key: "sepolia",
    label: "Sepolia",
    chainId: 11155111,
    rpcUrl: "https://ethereum-sepolia-rpc.publicnode.com",
    explorer: "https://sepolia.etherscan.io",
  },
  {
    key: "mainnet",
    label: "Ethereum",
    chainId: 1,
    rpcUrl: "https://ethereum-rpc.publicnode.com",
    explorer: "https://etherscan.io",
  },
  {
    key: "base",
    label: "Base",
    chainId: 8453,
    rpcUrl: "https://base-rpc.publicnode.com",
    explorer: "https://basescan.org",
  },
  {
    key: "polygon",
    label: "Polygon",
    chainId: 137,
    rpcUrl: "https://polygon-bor-rpc.publicnode.com",
    explorer: "https://polygonscan.com",
  },
];

export function toChain(preset: ChainPreset, rpcOverride?: string): Chain {
  return defineChain({
    id: preset.chainId,
    name: preset.label,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpcOverride?.trim() || preset.rpcUrl] } },
    contracts: { multicall3: { address: MULTICALL3 } },
  });
}

export function makePublicClient(chain: Chain): PublicClient {
  return createPublicClient({ chain, transport: http() });
}

export function makeWalletClient(chain: Chain): WalletClient {
  const ethereum = (window as { ethereum?: unknown }).ethereum;
  if (!ethereum) throw new Error("No browser wallet found (window.ethereum is missing)");
  return createWalletClient({ chain, transport: custom(ethereum as never) });
}

export const ierc7303Abi = parseAbi([
  "function supportsInterface(bytes4 interfaceId) view returns (bool)",
  "function hasRole(bytes32 role, address account) view returns (bool)",
  "function getERC721ControlTokens(bytes32 role) view returns (address[] contractIds)",
  "function getERC1155ControlTokens(bytes32 role) view returns (address[] contractIds, uint256[] typeIds)",
]);

export const erc721BalanceAbi = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
]);

export const erc1155BalanceAbi = parseAbi([
  "function balanceOf(address account, uint256 id) view returns (uint256)",
]);

export const ctMetaAbi = parseAbi([
  "function owner() view returns (address)",
  "function name() view returns (string)",
]);

/** Reference soulbound ERC-1155 control tokens (AgentControlTokens style). */
export const standardCtAbi = parseAbi([
  "function mint(address to, uint256 id, uint256 amount)",
  "function burnByIssuer(address account, uint256 id, uint256 amount)",
]);

/** ExpiringControlTokens: mint carries a unix expiry; balanceOf turns 0 past it. */
export const expiringCtAbi = parseAbi([
  "function mint(address to, uint256 id, uint64 expiry)",
  "function burnByIssuer(address account, uint256 id)",
  "function expiresAt(address account, uint256 id) view returns (uint64)",
]);

/**
 * Common role names probed against the IERC7303 getters. Discovery needs no
 * events or archive node: 2 view calls per candidate, batched in one multicall.
 */
export const ROLE_DICTIONARY = [
  "MINTER_ROLE",
  "BURNER_ROLE",
  "MEMBER_ROLE",
  "ADMIN_ROLE",
  "DEFAULT_ADMIN_ROLE",
  "OPERATOR_ROLE",
  "PAUSER_ROLE",
  "UPGRADER_ROLE",
  "URI_SETTER_ROLE",
  "TRANSFER_ROLE",
  "ISSUER_ROLE",
  "VERIFIER_ROLE",
  "VALIDATOR_ROLE",
  "AGENT_ROLE",
  "GOVERNOR_ROLE",
  "EDITOR_ROLE",
  "MODERATOR_ROLE",
  "TREASURER_ROLE",
];

/** "MINTER_ROLE" → keccak256 of the name; a 32-byte 0x value is the hash itself. */
export function roleHash(nameOrHash: string): Hex {
  if (/^0x[0-9a-fA-F]{64}$/.test(nameOrHash)) {
    return nameOrHash.toLowerCase() as Hex;
  }
  return keccak256(stringToHex(nameOrHash));
}

export interface Erc1155Binding {
  address: Address;
  typeId: bigint;
}

export interface RoleInfo {
  name: string;
  hash: Hex;
  erc721: Address[];
  erc1155: Erc1155Binding[];
}

export interface CtMeta {
  name?: string;
  owner?: Address;
  /** true when the contract answers expiresAt() — ExpiringControlTokens style */
  expiring?: boolean;
}

export interface EvidenceItem {
  standard: "erc721" | "erc1155";
  address: Address;
  typeId?: bigint;
  balance: bigint;
  /** unix seconds; only for expiring ERC-1155 control tokens (0 = no grant) */
  expiresAt?: bigint;
}

export interface RoleEvidence {
  hasRole: boolean;
  items: EvidenceItem[];
}

export async function probeSupport(
  client: PublicClient,
  target: Address,
): Promise<boolean> {
  try {
    return await client.readContract({
      address: target,
      abi: ierc7303Abi,
      functionName: "supportsInterface",
      args: [IERC7303_ID],
    });
  } catch {
    return false;
  }
}

/**
 * Probe candidate role names against the IERC7303 getters and keep the ones
 * with at least one control-token binding. One multicall round-trip.
 */
export async function probeRoles(
  client: PublicClient,
  target: Address,
  names: string[],
): Promise<RoleInfo[]> {
  const seen = new Set<string>();
  const candidates: { name: string; hash: Hex }[] = [];
  for (const name of names) {
    const hash = roleHash(name);
    if (seen.has(hash)) continue;
    seen.add(hash);
    candidates.push({ name, hash });
  }

  const contracts = candidates.flatMap(({ hash }) => [
    {
      address: target,
      abi: ierc7303Abi,
      functionName: "getERC721ControlTokens",
      args: [hash],
    } as const,
    {
      address: target,
      abi: ierc7303Abi,
      functionName: "getERC1155ControlTokens",
      args: [hash],
    } as const,
  ]);

  const res = await client.multicall({ contracts, allowFailure: true });

  const roles: RoleInfo[] = [];
  candidates.forEach(({ name, hash }, i) => {
    const r721 = res[2 * i];
    const r1155 = res[2 * i + 1];
    const erc721 =
      r721.status === "success" ? [...(r721.result as readonly Address[])] : [];
    let erc1155: Erc1155Binding[] = [];
    if (r1155.status === "success") {
      const [addrs, typeIds] = r1155.result as readonly [
        readonly Address[],
        readonly bigint[],
      ];
      erc1155 = addrs.map((address, j) => ({ address, typeId: typeIds[j] }));
    }
    if (erc721.length > 0 || erc1155.length > 0) {
      roles.push({ name, hash, erc721, erc1155 });
    }
  });
  return roles;
}

/** owner()/name() for every distinct control token + expiresAt() capability probe. */
export async function probeCtMeta(
  client: PublicClient,
  roles: RoleInfo[],
): Promise<Map<string, CtMeta>> {
  const addresses = new Map<string, { address: Address; sampleTypeId?: bigint }>();
  for (const role of roles) {
    for (const a of role.erc721) {
      const k = a.toLowerCase();
      if (!addresses.has(k)) addresses.set(k, { address: a });
    }
    for (const b of role.erc1155) {
      const k = b.address.toLowerCase();
      const existing = addresses.get(k);
      if (!existing) {
        addresses.set(k, { address: b.address, sampleTypeId: b.typeId });
      } else if (existing.sampleTypeId === undefined) {
        existing.sampleTypeId = b.typeId;
      }
    }
  }

  const entries = [...addresses.values()];
  const contracts = entries.flatMap((e) => [
    { address: e.address, abi: ctMetaAbi, functionName: "owner" } as const,
    { address: e.address, abi: ctMetaAbi, functionName: "name" } as const,
    {
      address: e.address,
      abi: expiringCtAbi,
      functionName: "expiresAt",
      args: [zeroAddress, e.sampleTypeId ?? 0n],
    } as const,
  ]);

  const res = await client.multicall({ contracts, allowFailure: true });

  const meta = new Map<string, CtMeta>();
  entries.forEach((e, i) => {
    const owner = res[3 * i];
    const name = res[3 * i + 1];
    const expiring = res[3 * i + 2];
    meta.set(e.address.toLowerCase(), {
      owner: owner.status === "success" ? (owner.result as Address) : undefined,
      name: name.status === "success" ? (name.result as string) : undefined,
      expiring: e.sampleTypeId !== undefined && expiring.status === "success",
    });
  });
  return meta;
}

/**
 * The full verdict for one subject: the target's own hasRole() answer per
 * role, plus the per-control-token balanceOf evidence behind it (and
 * expiresAt for expiring control tokens). One multicall round-trip.
 */
export async function fetchEvidence(
  client: PublicClient,
  target: Address,
  roles: RoleInfo[],
  subject: Address,
  meta: Map<string, CtMeta>,
): Promise<Map<Hex, RoleEvidence>> {
  interface Slot {
    kind: "hasRole" | "bal721" | "bal1155" | "expiresAt";
    roleHash: Hex;
    itemIndex?: number;
  }
  const contracts: ContractFunctionParameters[] = [];
  const slots: Slot[] = [];
  const skeleton = new Map<Hex, RoleEvidence>();

  for (const role of roles) {
    const items: EvidenceItem[] = [];
    contracts.push({
      address: target,
      abi: ierc7303Abi,
      functionName: "hasRole",
      args: [role.hash, subject],
    });
    slots.push({ kind: "hasRole", roleHash: role.hash });

    for (const a of role.erc721) {
      items.push({ standard: "erc721", address: a, balance: 0n });
      contracts.push({
        address: a,
        abi: erc721BalanceAbi,
        functionName: "balanceOf",
        args: [subject],
      });
      slots.push({ kind: "bal721", roleHash: role.hash, itemIndex: items.length - 1 });
    }
    for (const b of role.erc1155) {
      items.push({ standard: "erc1155", address: b.address, typeId: b.typeId, balance: 0n });
      contracts.push({
        address: b.address,
        abi: erc1155BalanceAbi,
        functionName: "balanceOf",
        args: [subject, b.typeId],
      });
      slots.push({ kind: "bal1155", roleHash: role.hash, itemIndex: items.length - 1 });
      if (meta.get(b.address.toLowerCase())?.expiring) {
        contracts.push({
          address: b.address,
          abi: expiringCtAbi,
          functionName: "expiresAt",
          args: [subject, b.typeId],
        });
        slots.push({ kind: "expiresAt", roleHash: role.hash, itemIndex: items.length - 1 });
      }
    }
    skeleton.set(role.hash, { hasRole: false, items });
  }

  const res = await client.multicall({ contracts, allowFailure: true });

  slots.forEach((slot, i) => {
    const r = res[i];
    if (r.status !== "success") return;
    const evidence = skeleton.get(slot.roleHash)!;
    if (slot.kind === "hasRole") {
      evidence.hasRole = r.result as boolean;
    } else if (slot.kind === "expiresAt") {
      evidence.items[slot.itemIndex!].expiresAt = BigInt(r.result as bigint);
    } else {
      evidence.items[slot.itemIndex!].balance = r.result as bigint;
    }
  });
  return skeleton;
}

export function isAddress(value: string): value is Address {
  return /^0x[0-9a-fA-F]{40}$/.test(value);
}

export function shortAddress(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export function formatRemaining(secondsLeft: number): string {
  if (secondsLeft <= 0) return "expired";
  const d = Math.floor(secondsLeft / 86400);
  const h = Math.floor((secondsLeft % 86400) / 3600);
  const m = Math.floor((secondsLeft % 3600) / 60);
  const s = Math.floor(secondsLeft % 60);
  if (d > 0) return `${d}d ${h}h left`;
  if (h > 0) return `${h}h ${m}m left`;
  if (m > 0) return `${m}m ${s}s left`;
  return `${s}s left`;
}
