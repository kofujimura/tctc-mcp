/** Stable error codes returned to MCP clients (spec §4). */
export type ToolErrorCode =
  | "ROLE_NOT_CONFIGURED"
  | "CHAIN_UNAVAILABLE"
  | "CHAIN_MISMATCH"
  | "SUBJECT_UNRESOLVED"
  | "NOT_ADMIN_MODE"
  | "ADMIN_ACTION_NOT_CONFIGURED"
  | "TX_REVERTED"
  | "INVALID_INPUT"
  | "NOT_IERC7303";

export class ToolError extends Error {
  constructor(
    public readonly code: ToolErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ToolError";
  }
}

/**
 * Recover a ToolError buried in a wrapped error's cause chain (viem wraps
 * transport-level throws — e.g. the chain-id gate — into contract errors).
 */
export function unwrapToolError(e: unknown): ToolError | undefined {
  let current: unknown = e;
  for (let depth = 0; current instanceof Error && depth < 10; depth++) {
    if (current instanceof ToolError) return current;
    current = current.cause;
  }
  return undefined;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}
