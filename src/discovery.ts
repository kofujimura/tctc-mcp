import {
  keccak256,
  stringToHex,
  parseAbi,
  ContractFunctionExecutionError,
  type Address,
} from "viem";
import type { Context } from "./context.js";
import { ToolError } from "./errors.js";

/**
 * ERC-165 interface id of IERC7303 (XOR of the selectors of hasRole,
 * getERC721ControlTokens, getERC1155ControlTokens).
 */
export const IERC7303_INTERFACE_ID = "0x4ee69337" as const;

const ierc7303Abi = parseAbi([
  "function supportsInterface(bytes4 interfaceId) view returns (bool)",
  "function hasRole(bytes32 role, address account) view returns (bool)",
  "function getERC721ControlTokens(bytes32 role) view returns (address[] contractIds)",
  "function getERC1155ControlTokens(bytes32 role) view returns (address[] contractIds, uint256[] typeIds)",
]);

/** Control-token bindings read from a target contract via IERC7303. */
export interface DiscoveredBindings {
  erc721: Address[];
  erc1155: { address: Address; typeId: bigint }[];
}

/** "MINTER_ROLE" → keccak256 of the name; a 32-byte 0x value is the hash itself. */
export function roleHash(nameOrHash: string): `0x${string}` {
  if (/^0x[0-9a-fA-F]{64}$/.test(nameOrHash)) {
    return nameOrHash.toLowerCase() as `0x${string}`;
  }
  return keccak256(stringToHex(nameOrHash));
}

/**
 * ERC-165 probe. A contract-level failure (no code, revert, no ERC-165)
 * means "not IERC7303"; anything else is a chain problem and must not be
 * misreported as non-support.
 */
export async function supportsIERC7303(
  ctx: Context,
  chain: string,
  target: Address,
): Promise<boolean> {
  const client = ctx.chains.public(chain);
  try {
    return await client.readContract({
      address: target,
      abi: ierc7303Abi,
      functionName: "supportsInterface",
      args: [IERC7303_INTERFACE_ID],
    });
  } catch (e) {
    if (e instanceof ContractFunctionExecutionError) return false;
    throw new ToolError(
      "CHAIN_UNAVAILABLE",
      `supportsInterface probe on ${target} (${chain}) failed: ${(e as Error).message}`,
    );
  }
}

/** Enumerate the control tokens bound to a role, via the IERC7303 getters. */
export async function discoverBindings(
  ctx: Context,
  chain: string,
  target: Address,
  hash: `0x${string}`,
): Promise<DiscoveredBindings> {
  const cacheKey = `${chain}:${target.toLowerCase()}:${hash}`;
  const cached = ctx.discovery.get(cacheKey);
  if (cached !== undefined) return cached;

  if (!(await supportsIERC7303(ctx, chain, target))) {
    throw new ToolError(
      "NOT_IERC7303",
      `${target} (${chain}) does not report support for IERC7303 ` +
        `(ERC-165 interfaceId ${IERC7303_INTERFACE_ID})`,
    );
  }

  const client = ctx.chains.public(chain);
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
    const bindings: DiscoveredBindings = {
      erc721: [...erc721],
      erc1155: contractIds.map((address, i) => ({ address, typeId: typeIds[i] })),
    };
    ctx.discovery.set(cacheKey, bindings);
    return bindings;
  } catch (e) {
    throw new ToolError(
      "CHAIN_UNAVAILABLE",
      `IERC7303 getters on ${target} (${chain}) failed: ${(e as Error).message}`,
    );
  }
}

/** The target contract's own answer — the same logic its modifier enforces. */
export async function hasRoleOnTarget(
  ctx: Context,
  chain: string,
  target: Address,
  hash: `0x${string}`,
  subject: Address,
): Promise<boolean> {
  const client = ctx.chains.public(chain);
  try {
    return await client.readContract({
      address: target,
      abi: ierc7303Abi,
      functionName: "hasRole",
      args: [hash, subject],
    });
  } catch (e) {
    throw new ToolError(
      "CHAIN_UNAVAILABLE",
      `hasRole(${hash}, ${subject}) on ${target} (${chain}) failed: ${(e as Error).message}`,
    );
  }
}
