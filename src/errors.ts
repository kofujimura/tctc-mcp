/** Stable error codes returned to MCP clients (spec §4). */
export type ToolErrorCode =
  | "ROLE_NOT_CONFIGURED"
  | "CHAIN_UNAVAILABLE"
  | "SUBJECT_UNRESOLVED"
  | "NOT_ADMIN_MODE"
  | "ADMIN_ACTION_NOT_CONFIGURED"
  | "TX_REVERTED"
  | "INVALID_INPUT";

export class ToolError extends Error {
  constructor(
    public readonly code: ToolErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ToolError";
  }
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}
