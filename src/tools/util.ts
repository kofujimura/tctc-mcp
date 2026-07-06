import { ToolError } from "../errors.js";

export interface ToolResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
  [key: string]: unknown;
}

export function jsonResult(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

/** Wrap a handler so ToolErrors become stable-coded MCP tool errors (spec §4). */
export function handled<A extends unknown[]>(
  fn: (...args: A) => Promise<ToolResult>,
): (...args: A) => Promise<ToolResult> {
  return async (...args: A) => {
    try {
      return await fn(...args);
    } catch (e) {
      const payload =
        e instanceof ToolError
          ? { error: e.code, message: e.message }
          : { error: "INTERNAL", message: (e as Error).message };
      return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
        isError: true,
      };
    }
  };
}
