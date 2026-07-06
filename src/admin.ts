import {
  parseAbi,
  type Abi,
  type Address,
  type AbiFunction,
  BaseError,
  ContractFunctionRevertedError,
} from "viem";
import type { Context } from "./context.js";
import type { AdminAction, ControlToken, RoleConfig } from "./config.js";
import { getRole } from "./roles.js";
import { ToolError } from "./errors.js";

export function pickControlToken(
  roleName: string,
  role: RoleConfig,
  controlTokenIndex?: number,
): ControlToken {
  if (controlTokenIndex !== undefined) {
    const token = role.controlTokens[controlTokenIndex];
    if (!token) {
      throw new ToolError(
        "INVALID_INPUT",
        `role "${roleName}" has no controlTokens[${controlTokenIndex}] ` +
          `(${role.controlTokens.length} configured)`,
      );
    }
    return token;
  }
  if (role.controlTokens.length > 1) {
    throw new ToolError(
      "INVALID_INPUT",
      `role "${roleName}" has ${role.controlTokens.length} control tokens; ` +
        `specify controlTokenIndex`,
    );
  }
  return role.controlTokens[0];
}

/**
 * Map a config args template onto ABI-typed values.
 * "$subject" → subject address, "$typeId" → the control token's typeId;
 * anything else is a literal coerced to the ABI parameter type.
 */
export function buildArgs(
  action: AdminAction,
  abiFn: AbiFunction,
  bindings: { subject: Address; typeId: bigint | null },
): unknown[] {
  const inputs = abiFn.inputs;
  if (action.args.length !== inputs.length) {
    throw new ToolError(
      "INVALID_INPUT",
      `admin function ${action.function} takes ${inputs.length} argument(s) ` +
        `but the config template has ${action.args.length}`,
    );
  }
  return action.args.map((template, i) => {
    const type = inputs[i].type;
    let value: unknown = template;
    if (template === "$subject") value = bindings.subject;
    else if (template === "$typeId") {
      if (bindings.typeId === null) {
        throw new ToolError(
          "INVALID_INPUT",
          `args template uses $typeId but the control token has no typeId (erc721)`,
        );
      }
      value = bindings.typeId;
    }
    if (type.startsWith("uint") || type.startsWith("int")) {
      return typeof value === "bigint" ? value : BigInt(value as string | number);
    }
    if (type === "address") {
      if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
        throw new ToolError(
          "INVALID_INPUT",
          `argument ${i} of ${action.function} must be an address, got: ${String(value)}`,
        );
      }
      return value;
    }
    if (type === "bool") return Boolean(value);
    return value;
  });
}

export interface AdminResult {
  txHash: `0x${string}`;
  status: "success";
  role: string;
  action: "grant" | "revoke";
  subject: Address;
  controlToken: Address;
  chain: string;
}

export async function executeAdminAction(
  ctx: Context,
  roleName: string,
  actionName: "grant" | "revoke",
  subject: Address,
  controlTokenIndex?: number,
): Promise<AdminResult> {
  const role = getRole(ctx, roleName);
  const action = role.admin?.[actionName];
  if (!action) {
    throw new ToolError(
      "ADMIN_ACTION_NOT_CONFIGURED",
      `role "${roleName}" has no admin.${actionName} function configured`,
    );
  }
  const token = pickControlToken(roleName, role, controlTokenIndex);

  // parseAbi's type-level parser needs literal strings; the signature is
  // runtime config here, so fall back to the plain Abi type.
  const abi = (parseAbi as (sigs: readonly string[]) => Abi)([
    `function ${action.function}`,
  ]);
  const abiFn = abi[0] as AbiFunction;
  const args = buildArgs(action, abiFn, {
    subject,
    typeId: token.typeId,
  });

  const wallet = ctx.chains.wallet(token.chain);
  const publicClient = ctx.chains.public(token.chain);
  const account = ctx.chains.adminAccount!;

  let txHash: `0x${string}`;
  try {
    const { request } = await publicClient.simulateContract({
      address: token.address as Address,
      abi,
      functionName: abiFn.name,
      args,
      account,
    });
    txHash = await wallet.writeContract(request);
  } catch (e) {
    throw new ToolError("TX_REVERTED", revertMessage(e));
  }

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") {
    throw new ToolError("TX_REVERTED", `transaction ${txHash} reverted on-chain`);
  }

  return {
    txHash,
    status: "success",
    role: roleName,
    action: actionName,
    subject,
    controlToken: token.address as Address,
    chain: token.chain,
  };
}

function revertMessage(e: unknown): string {
  if (e instanceof BaseError) {
    const revert = e.walk((err) => err instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) {
      const reason = revert.reason ?? revert.data?.errorName;
      if (reason) return `reverted: ${reason}`;
    }
    return e.shortMessage;
  }
  return (e as Error).message;
}
