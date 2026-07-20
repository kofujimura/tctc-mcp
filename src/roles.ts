import { parseAbi, type Address } from "viem";
import type { Context } from "./context.js";
import type { ControlToken, RoleConfig } from "./config.js";
import { discoverBindings, hasRoleOnTarget, roleHash } from "./discovery.js";
import { ToolError, unwrapToolError } from "./errors.js";

const erc721Abi = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
]);
const erc1155Abi = parseAbi([
  "function balanceOf(address account, uint256 id) view returns (uint256)",
]);
const expiryAbi = parseAbi([
  "function expiresAt(address account, uint256 id) view returns (uint64)",
]);

export interface Evidence {
  chain: string;
  controlToken: Address;
  standard: "erc721" | "erc1155";
  typeId: string | null;
  balance: string;
  /**
   * Expiring control tokens only: unix seconds at which this grant expires
   * (or expired — balance already reads 0 then). Absent for tokens without
   * an expiresAt(account, id) view.
   */
  expiresAt?: string;
}

export interface CheckResult {
  role: string;
  subject: Address;
  hasRole: boolean;
  evidence: Evidence[];
  /** Where the control-token bindings came from. */
  bindingSource: "config" | "ierc7303";
  /** Discovery only: the introspected target contract and role hash. */
  target?: Address;
  roleHash?: `0x${string}`;
  note?: string;
}

export function getRole(ctx: Context, roleName: string): RoleConfig {
  const role = ctx.config.roles[roleName];
  if (!role) {
    throw new ToolError(
      "ROLE_NOT_CONFIGURED",
      `role "${roleName}" is not configured; configured roles: ${
        Object.keys(ctx.config.roles).join(", ") || "(none)"
      }`,
    );
  }
  return role;
}

export interface ResolvedBindings {
  tokens: ControlToken[];
  source: "config" | "ierc7303";
  /** Discovery only. */
  chain?: string;
  target?: Address;
  roleHash?: `0x${string}`;
}

/**
 * A role's control tokens come either from the config (static) or from the
 * target contract itself via the IERC7303 getters (discovery).
 */
export async function resolveBindings(
  ctx: Context,
  roleName: string,
  role: RoleConfig,
): Promise<ResolvedBindings> {
  if (role.controlTokens) {
    return { tokens: role.controlTokens, source: "config" };
  }
  const target = role.target!;
  const chain = target.chain ?? ctx.config.defaultChain;
  const hash = roleHash(target.role ?? roleName);
  const bindings = await discoverBindings(ctx, chain, target.address as Address, hash);
  return {
    tokens: [
      ...bindings.erc721.map((address) => ({
        chain,
        standard: "erc721" as const,
        address,
        typeId: null,
      })),
      ...bindings.erc1155.map(({ address, typeId }) => ({
        chain,
        standard: "erc1155" as const,
        address,
        typeId,
      })),
    ],
    source: "ierc7303",
    chain,
    target: target.address as Address,
    roleHash: hash,
  };
}

async function readBalance(
  ctx: Context,
  token: ControlToken,
  subject: Address,
): Promise<bigint> {
  const cacheKey = `${token.chain}:${token.address}:${token.typeId ?? ""}:${subject}`;
  const cached = ctx.cache.get(cacheKey);
  if (cached !== undefined) return cached;

  const client = ctx.chains.public(token.chain);
  let balance: bigint;
  try {
    balance =
      token.standard === "erc721"
        ? await client.readContract({
            address: token.address as Address,
            abi: erc721Abi,
            functionName: "balanceOf",
            args: [subject],
          })
        : await client.readContract({
            address: token.address as Address,
            abi: erc1155Abi,
            functionName: "balanceOf",
            args: [subject, token.typeId!],
          });
  } catch (e) {
    const gate = unwrapToolError(e);
    if (gate) throw gate;
    throw new ToolError(
      "CHAIN_UNAVAILABLE",
      `balanceOf(${subject}) on ${token.address} (${token.chain}) failed: ${
        (e as Error).message
      }`,
    );
  }
  ctx.cache.set(cacheKey, balance);
  return balance;
}

/**
 * Probe for the expiring-control-token view expiresAt(account, id).
 * Most control tokens don't implement it; any failure means "not expiring"
 * and is deliberately silent — expiry only ever adds information, the
 * authoritative check remains balanceOf (time-aware on expiring tokens).
 */
async function readExpiresAt(
  ctx: Context,
  token: ControlToken,
  subject: Address,
): Promise<bigint> {
  if (token.standard !== "erc1155") return 0n;
  const cacheKey = `expiry:${token.chain}:${token.address}:${token.typeId}:${subject}`;
  const cached = ctx.cache.get(cacheKey);
  if (cached !== undefined) return cached;

  let value = 0n;
  try {
    value = BigInt(
      await ctx.chains.public(token.chain).readContract({
        address: token.address as Address,
        abi: expiryAbi,
        functionName: "expiresAt",
        args: [subject, token.typeId!],
      }),
    );
  } catch {
    // no expiresAt() on this control token — not an expiring grant
  }
  ctx.cache.set(cacheKey, value);
  return value;
}

/** OR semantics across a role's control tokens, matching ERC-7303. */
export async function checkRole(
  ctx: Context,
  roleName: string,
  subject: Address,
): Promise<CheckResult> {
  const role = getRole(ctx, roleName);
  const resolved = await resolveBindings(ctx, roleName, role);
  const evidence: Evidence[] = [];
  for (const token of resolved.tokens) {
    const balance = await readBalance(ctx, token, subject);
    const expiresAt = await readExpiresAt(ctx, token, subject);
    evidence.push({
      chain: token.chain,
      controlToken: token.address as Address,
      standard: token.standard,
      typeId: token.typeId === null ? null : token.typeId.toString(),
      balance: balance.toString(),
      ...(expiresAt > 0n ? { expiresAt: expiresAt.toString() } : {}),
    });
  }
  const fromBalances = evidence.some((e) => BigInt(e.balance) > 0n);
  const result: CheckResult = {
    role: roleName,
    subject,
    hasRole: fromBalances,
    evidence,
    bindingSource: resolved.source,
  };
  if (resolved.source === "ierc7303") {
    // The target's own hasRole is authoritative — it is the same logic its
    // modifier enforces, including anything beyond the enumerable bindings.
    const onTarget = await hasRoleOnTarget(
      ctx,
      resolved.chain!,
      resolved.target!,
      resolved.roleHash!,
      subject,
    );
    result.hasRole = onTarget;
    result.target = resolved.target;
    result.roleHash = resolved.roleHash;
    if (onTarget !== fromBalances) {
      result.note =
        "target.hasRole() disagrees with the balance evidence; " +
        "the target's answer is authoritative (custom logic on the target?)";
    }
  }
  return result;
}

export async function checkAllRoles(
  ctx: Context,
  subject: Address,
): Promise<{ subject: Address; roles: CheckResult[] }> {
  const roles = await Promise.all(
    Object.keys(ctx.config.roles).map((name) => checkRole(ctx, name, subject)),
  );
  return { subject, roles };
}
