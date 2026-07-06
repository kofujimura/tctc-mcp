import {
  concat,
  encodeAbiParameters,
  getContractAddress,
  keccak256,
  pad,
  parseAbi,
  toHex,
  type Address,
  type Hex,
} from "viem";
import type { Context } from "./context.js";
import type { IdentityConfig } from "./config.js";
import { ToolError } from "./errors.js";

const identityRegistryAbi = parseAbi([
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "function agentURI(uint256 agentId) view returns (string)",
  "function agentWallet(uint256 agentId) view returns (address)",
  "function agentWalletOf(uint256 agentId) view returns (address)",
]);

/**
 * ERC-6551 account address, computed off-chain (counterfactual — valid
 * before deployment). Mirrors the reference registry's CREATE2 derivation:
 * proxy bytecode = ERC-1167 header ++ implementation ++ footer
 *                  ++ abi.encode(salt, chainId, tokenContract, tokenId)
 */
export function computeTbaAddress(params: {
  registry: Address;
  implementation: Address;
  salt: string;
  chainId: number | bigint;
  tokenContract: Address;
  tokenId: bigint;
}): Address {
  const salt32 = pad(toHex(BigInt(params.salt)), { size: 32 }) as Hex;
  const bytecode = concat([
    "0x3d60ad80600a3d3981f3363d3d373d3d3d363d73",
    params.implementation,
    "0x5af43d82803e903d91602b57fd5bf3",
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "uint256" },
        { type: "address" },
        { type: "uint256" },
      ],
      [salt32, BigInt(params.chainId), params.tokenContract, params.tokenId],
    ),
  ]);
  return getContractAddress({
    opcode: "CREATE2",
    from: params.registry,
    salt: salt32,
    bytecode,
  });
}

export interface ResolvedAgent {
  agentId: number;
  owner: Address;
  agentURI: string | null;
  agentWallet: Address | null;
  tba: { address: Address; deployed: boolean };
}

function requireIdentity(ctx: Context): IdentityConfig {
  const identity = ctx.config.identity;
  if (!identity) {
    throw new ToolError(
      "SUBJECT_UNRESOLVED",
      "agentId subjects require the identity section of the config",
    );
  }
  return identity;
}

/** agentId → the TBA address permissions should be bound to (CONCEPT.md §3.2). */
export async function agentTba(ctx: Context, agentId: number): Promise<Address> {
  const identity = requireIdentity(ctx);
  const client = ctx.chains.public(identity.chain);
  try {
    await client.readContract({
      address: identity.identityRegistry as Address,
      abi: identityRegistryAbi,
      functionName: "ownerOf",
      args: [BigInt(agentId)],
    });
  } catch {
    throw new ToolError(
      "SUBJECT_UNRESOLVED",
      `agentId ${agentId} does not exist on identity registry ${identity.identityRegistry}`,
    );
  }
  return computeTbaAddress({
    registry: identity.erc6551.registry as Address,
    implementation: identity.erc6551.accountImplementation as Address,
    salt: identity.erc6551.salt,
    chainId: ctx.chains.chainId(identity.chain),
    tokenContract: identity.identityRegistry as Address,
    tokenId: BigInt(agentId),
  });
}

export async function resolveAgent(ctx: Context, agentId: number): Promise<ResolvedAgent> {
  const identity = requireIdentity(ctx);
  const client = ctx.chains.public(identity.chain);
  const registry = identity.identityRegistry as Address;
  const id = BigInt(agentId);

  let owner: Address;
  try {
    owner = await client.readContract({
      address: registry,
      abi: identityRegistryAbi,
      functionName: "ownerOf",
      args: [id],
    });
  } catch {
    throw new ToolError(
      "SUBJECT_UNRESOLVED",
      `agentId ${agentId} does not exist on identity registry ${registry}`,
    );
  }

  // ERC-8004 is a draft; probe the URI and wallet accessors defensively.
  let agentURI: string | null = null;
  for (const fn of ["tokenURI", "agentURI"] as const) {
    try {
      agentURI = await client.readContract({
        address: registry,
        abi: identityRegistryAbi,
        functionName: fn,
        args: [id],
      });
      break;
    } catch {
      /* try next accessor */
    }
  }

  let agentWallet: Address | null = null;
  for (const fn of ["agentWallet", "agentWalletOf"] as const) {
    try {
      const w = await client.readContract({
        address: registry,
        abi: identityRegistryAbi,
        functionName: fn,
        args: [id],
      });
      agentWallet = w === "0x0000000000000000000000000000000000000000" ? null : w;
      break;
    } catch {
      /* try next accessor */
    }
  }

  const tbaAddress = computeTbaAddress({
    registry: identity.erc6551.registry as Address,
    implementation: identity.erc6551.accountImplementation as Address,
    salt: identity.erc6551.salt,
    chainId: ctx.chains.chainId(identity.chain),
    tokenContract: registry,
    tokenId: id,
  });
  const code = await client.getCode({ address: tbaAddress });

  return {
    agentId,
    owner,
    agentURI,
    agentWallet,
    tba: { address: tbaAddress, deployed: code !== undefined && code !== "0x" },
  };
}
