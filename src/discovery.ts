/**
 * IERC7303 discovery — thin adapter over the shared authorization core
 * (core/src). tctc-mcp and tctc-gate consume the same implementation
 * (GATE_SPEC §8); this module only adds the Context plumbing (chain
 * registry, discovery cache) and maps CoreError to ToolError.
 */
import type { Address } from "viem";
import type { Context } from "./context.js";
import { ToolError } from "./errors.js";
import {
  CoreError,
  IERC7303_INTERFACE_ID,
  roleHash,
  supportsIERC7303 as coreSupportsIERC7303,
  discoverBindings as coreDiscoverBindings,
  hasRole as coreHasRole,
  type DiscoveredBindings,
} from "../core/src/index.js";

export { IERC7303_INTERFACE_ID, roleHash };
export type { DiscoveredBindings };

function rethrow(e: unknown): never {
  if (e instanceof CoreError) throw new ToolError(e.code, e.message);
  throw e;
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
  try {
    return await coreSupportsIERC7303(ctx.chains.public(chain), target);
  } catch (e) {
    rethrow(e);
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
  try {
    const bindings = await coreDiscoverBindings(ctx.chains.public(chain), target, hash);
    ctx.discovery.set(cacheKey, bindings);
    return bindings;
  } catch (e) {
    rethrow(e);
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
  try {
    return await coreHasRole(ctx.chains.public(chain), target, hash, subject);
  } catch (e) {
    rethrow(e);
  }
}
