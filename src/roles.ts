import { parseAbi, type Address } from "viem";
import type { Context } from "./context.js";
import type { RoleConfig } from "./config.js";
import { ToolError } from "./errors.js";

const erc721Abi = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
]);
const erc1155Abi = parseAbi([
  "function balanceOf(address account, uint256 id) view returns (uint256)",
]);

export interface Evidence {
  chain: string;
  controlToken: Address;
  standard: "erc721" | "erc1155";
  typeId: string | null;
  balance: string;
}

export interface CheckResult {
  role: string;
  subject: Address;
  hasRole: boolean;
  evidence: Evidence[];
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

async function readBalance(
  ctx: Context,
  token: RoleConfig["controlTokens"][number],
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

/** OR semantics across a role's control tokens, matching ERC-7303. */
export async function checkRole(
  ctx: Context,
  roleName: string,
  subject: Address,
): Promise<CheckResult> {
  const role = getRole(ctx, roleName);
  const evidence: Evidence[] = [];
  for (const token of role.controlTokens) {
    const balance = await readBalance(ctx, token, subject);
    evidence.push({
      chain: token.chain,
      controlToken: token.address as Address,
      standard: token.standard,
      typeId: token.typeId === null ? null : token.typeId.toString(),
      balance: balance.toString(),
    });
  }
  return {
    role: roleName,
    subject,
    hasRole: evidence.some((e) => BigInt(e.balance) > 0n),
    evidence,
  };
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
