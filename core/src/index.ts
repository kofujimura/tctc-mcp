/**
 * @tctc/core — shared authorization logic for tctc-mcp and tctc-gate.
 *
 * Source-shared (each consumer compiles this folder into its own dist);
 * not published. The cross-implementation test vectors in
 * test/core-vectors.test.ts assert that this module and tctc-mcp's src/
 * agree — divergence is a test failure, not a code-review hope.
 */
import {
  keccak256,
  stringToHex,
  parseAbi,
  ContractFunctionExecutionError,
  type Address,
  type PublicClient,
} from "viem";

/** ERC-165 interface id of IERC7303. */
export const IERC7303_INTERFACE_ID = "0x4ee69337" as const;

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

export type CoreErrorCode = "NOT_IERC7303" | "CHAIN_UNAVAILABLE" | "CHAIN_MISMATCH";

export class CoreError extends Error {
  constructor(
    readonly code: CoreErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CoreError";
  }
}

/** "MINTER_ROLE" → keccak256 of the name; a 32-byte 0x value is the hash itself. */
export function roleHash(nameOrHash: string): `0x${string}` {
  if (/^0x[0-9a-fA-F]{64}$/.test(nameOrHash)) {
    return nameOrHash.toLowerCase() as `0x${string}`;
  }
  return keccak256(stringToHex(nameOrHash));
}

/** Tiny in-memory TTL cache; ttlMs <= 0 disables caching entirely. */
export class TtlCache<T> {
  private entries = new Map<string, { value: T; at: number }>();

  constructor(readonly ttlMs: number) {}

  get(key: string): T | undefined {
    if (this.ttlMs <= 0) return undefined;
    const e = this.entries.get(key);
    if (!e) return undefined;
    if (Date.now() - e.at > this.ttlMs) {
      this.entries.delete(key);
      return undefined;
    }
    return e.value;
  }

  /** Remaining lifetime in ms, if present. */
  expiresInMs(key: string): number | undefined {
    if (this.ttlMs <= 0) return undefined;
    const e = this.entries.get(key);
    if (!e) return undefined;
    const left = this.ttlMs - (Date.now() - e.at);
    return left > 0 ? left : undefined;
  }

  set(key: string, value: T): void {
    if (this.ttlMs <= 0) return;
    this.entries.set(key, { value, at: Date.now() });
  }
}

/** Control-token bindings read from a target contract via IERC7303. */
export interface DiscoveredBindings {
  erc721: Address[];
  erc1155: { address: Address; typeId: bigint }[];
}

/**
 * ERC-165 probe. A contract-level failure (no code, revert, no ERC-165)
 * means "not IERC7303"; anything else is a chain problem and must not be
 * misreported as non-support.
 */
export async function supportsIERC7303(
  client: PublicClient,
  target: Address,
): Promise<boolean> {
  try {
    return await client.readContract({
      address: target,
      abi: ierc7303Abi,
      functionName: "supportsInterface",
      args: [IERC7303_INTERFACE_ID],
    });
  } catch (e) {
    const fault = chainFault(e);
    if (fault) throw fault;
    if (e instanceof ContractFunctionExecutionError) return false;
    throw new CoreError(
      "CHAIN_UNAVAILABLE",
      `supportsInterface probe on ${target} failed: ${(e as Error).message}`,
    );
  }
}

/**
 * Recover a chain-level fault (chain-id gate, transport failure) buried in a
 * wrapped error's cause chain, so it is never misreported as contract-level
 * behavior such as "not IERC7303". Duck-typed on name+code because the
 * consumer's ToolError class is a different module instance.
 */
function chainFault(e: unknown): CoreError | undefined {
  let current: unknown = e;
  for (let depth = 0; current instanceof Error && depth < 10; depth++) {
    if (current instanceof CoreError) return current;
    const code = (current as { code?: unknown }).code;
    if (
      current.name === "ToolError" &&
      (code === "CHAIN_MISMATCH" || code === "CHAIN_UNAVAILABLE")
    ) {
      return new CoreError(code, current.message);
    }
    current = current.cause;
  }
  return undefined;
}

/** Enumerate the control tokens bound to a role via the IERC7303 getters. */
export async function discoverBindings(
  client: PublicClient,
  target: Address,
  hash: `0x${string}`,
): Promise<DiscoveredBindings> {
  if (!(await supportsIERC7303(client, target))) {
    throw new CoreError(
      "NOT_IERC7303",
      `${target} does not report support for IERC7303 (ERC-165 interfaceId ${IERC7303_INTERFACE_ID})`,
    );
  }
  try {
    const [erc721, [contractIds, typeIds]] = await Promise.all([
      client.readContract({
        address: target,
        abi: ierc7303Abi,
        functionName: "getERC721ControlTokens",
        args: [hash],
      }),
      client.readContract({
        address: target,
        abi: ierc7303Abi,
        functionName: "getERC1155ControlTokens",
        args: [hash],
      }),
    ]);
    return {
      erc721: [...erc721],
      erc1155: contractIds.map((address, i) => ({ address, typeId: typeIds[i] })),
    };
  } catch (e) {
    const fault = chainFault(e);
    if (fault) throw fault;
    throw new CoreError(
      "CHAIN_UNAVAILABLE",
      `IERC7303 getters on ${target} failed: ${(e as Error).message}`,
    );
  }
}

/** The target contract's own answer — the same logic its modifier enforces. */
export async function hasRole(
  client: PublicClient,
  target: Address,
  hash: `0x${string}`,
  subject: Address,
  blockNumber?: bigint,
): Promise<boolean> {
  try {
    return await client.readContract({
      address: target,
      abi: ierc7303Abi,
      functionName: "hasRole",
      args: [hash, subject],
      ...(blockNumber !== undefined ? { blockNumber } : {}),
    });
  } catch (e) {
    const fault = chainFault(e);
    if (fault) throw fault;
    throw new CoreError(
      "CHAIN_UNAVAILABLE",
      `hasRole(${hash}, ${subject}) on ${target} failed: ${(e as Error).message}`,
    );
  }
}

export interface RoleEvidence {
  standard: "erc721" | "erc1155";
  contract: Address;
  typeId?: string;
  balanceOf: string;
}

export interface RoleVerdict {
  role: `0x${string}`;
  hasRole: boolean;
  evidence: RoleEvidence[];
}

export interface PinnedCheck {
  blockNumber: bigint;
  observedAt: string;
  verdicts: RoleVerdict[];
}

/**
 * Pinned admission check (GATE_SPEC §6): fetch the current block number,
 * perform hasRole and all balance-evidence reads pinned to that block, and
 * report that same number — the reported number can never drift from the
 * state it labels. One retry with a fresh number; then CHAIN_UNAVAILABLE.
 */
export async function checkRolesPinned(
  client: PublicClient,
  target: Address,
  subject: Address,
  roles: { hash: `0x${string}`; bindings: DiscoveredBindings }[],
): Promise<PinnedCheck> {
  const run = async (blockNumber: bigint): Promise<PinnedCheck> => {
    const verdicts = await Promise.all(
      roles.map(async ({ hash, bindings }): Promise<RoleVerdict> => {
        const [has, erc721Balances, erc1155Balances] = await Promise.all([
          client.readContract({
            address: target,
            abi: ierc7303Abi,
            functionName: "hasRole",
            args: [hash, subject],
            blockNumber,
          }),
          Promise.all(
            bindings.erc721.map((contract) =>
              client.readContract({
                address: contract,
                abi: erc721BalanceAbi,
                functionName: "balanceOf",
                args: [subject],
                blockNumber,
              }).catch(() => null),
            ),
          ),
          Promise.all(
            bindings.erc1155.map((b) =>
              client.readContract({
                address: b.address,
                abi: erc1155BalanceAbi,
                functionName: "balanceOf",
                args: [subject, b.typeId],
                blockNumber,
              }).catch(() => null),
            ),
          ),
        ]);
        const evidence: RoleEvidence[] = [
          ...bindings.erc721.map((contract, i): RoleEvidence => ({
            standard: "erc721",
            contract,
            balanceOf: erc721Balances[i] === null ? "unavailable" : String(erc721Balances[i]),
          })),
          ...bindings.erc1155.map((b, i): RoleEvidence => ({
            standard: "erc1155",
            contract: b.address,
            typeId: b.typeId.toString(),
            balanceOf: erc1155Balances[i] === null ? "unavailable" : String(erc1155Balances[i]),
          })),
        ];
        return { role: hash, hasRole: has, evidence };
      }),
    );
    return { blockNumber, observedAt: new Date().toISOString(), verdicts };
  };

  let blockNumber: bigint;
  try {
    blockNumber = await client.getBlockNumber();
  } catch (e) {
    const fault = chainFault(e);
    if (fault) throw fault;
    throw new CoreError("CHAIN_UNAVAILABLE", `getBlockNumber failed: ${(e as Error).message}`);
  }
  try {
    return await run(blockNumber);
  } catch (e) {
    const mismatch = chainFault(e);
    if (mismatch?.code === "CHAIN_MISMATCH") throw mismatch;
    try {
      const fresh = await client.getBlockNumber();
      return await run(fresh);
    } catch (retryError) {
      const fault = chainFault(retryError);
      if (fault) throw fault;
      throw new CoreError(
        "CHAIN_UNAVAILABLE",
        `pinned role check on ${target} failed after retry: ${(retryError as Error).message}`,
      );
    }
  }
}
