import type { Address } from "viem";
import type { Context } from "./context.js";
import { assertAddress } from "./chain.js";
import { agentTba } from "./identity.js";
import { ToolError } from "./errors.js";

export interface SubjectInput {
  address?: string;
  agentId?: number;
}

export interface ResolvedSubject {
  address: Address;
  via: "explicit-address" | "agentId-tba" | "config-self";
}

/** Resolution order per spec §4: explicit address → agentId → config self. */
export async function resolveSubject(
  ctx: Context,
  subject?: SubjectInput,
): Promise<ResolvedSubject> {
  if (subject?.address !== undefined && subject?.agentId !== undefined) {
    throw new ToolError(
      "INVALID_INPUT",
      "subject must have either address or agentId, not both",
    );
  }
  if (subject?.address !== undefined) {
    return { address: assertAddress(subject.address, "subject.address"), via: "explicit-address" };
  }
  if (subject?.agentId !== undefined) {
    return { address: await agentTba(ctx, subject.agentId), via: "agentId-tba" };
  }
  const self = ctx.config.self;
  if (self) {
    if ("address" in self) {
      return { address: self.address as Address, via: "config-self" };
    }
    return { address: await agentTba(ctx, self.agentId), via: "config-self" };
  }
  throw new ToolError(
    "SUBJECT_UNRESOLVED",
    "no subject given and no self section in the config",
  );
}
