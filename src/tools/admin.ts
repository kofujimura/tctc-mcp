import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Context } from "../context.js";
import { executeAdminAction } from "../admin.js";
import { resolveSubject } from "../subject.js";
import { jsonResult, handled } from "./util.js";

const subjectShape = z
  .object({
    address: z.string().describe("EVM address").optional(),
    agentId: z
      .number()
      .int()
      .nonnegative()
      .describe(
        "ERC-8004 agentId; resolved to its ERC-6551 TBA — the recommended binding target",
      )
      .optional(),
  })
  .describe("Who receives (grant) or loses (revoke) the control token.");

const inputSchema = {
  role: z.string().describe("Role name, e.g. MINTER_ROLE"),
  subject: subjectShape,
  controlTokenIndex: z
    .number()
    .int()
    .nonnegative()
    .describe("Index into the role's controlTokens; optional if the role has one")
    .optional(),
};

/** Only called in admin mode; read-only servers never register these. */
export function registerAdminTools(server: McpServer, ctx: Context): void {
  server.registerTool(
    "grant_role",
    {
      title: "Grant a role (mint control token)",
      description:
        "Mint the role's control token to a subject, granting the role on-chain. " +
        "Sends a transaction from the admin signer and waits for inclusion.",
      inputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    handled(async ({ role, subject, controlTokenIndex }) => {
      const resolved = await resolveSubject(ctx, subject);
      const result = await executeAdminAction(
        ctx,
        role,
        "grant",
        resolved.address,
        controlTokenIndex,
      );
      return jsonResult({ ...result, subjectResolvedVia: resolved.via });
    }),
  );

  server.registerTool(
    "revoke_role",
    {
      title: "Revoke a role (burn control token)",
      description:
        "Burn the subject's control token — the on-chain kill switch. The subject " +
        "loses the role at the next transaction. Sends a transaction from the admin " +
        "signer and waits for inclusion.",
      inputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    handled(async ({ role, subject, controlTokenIndex }) => {
      const resolved = await resolveSubject(ctx, subject);
      const result = await executeAdminAction(
        ctx,
        role,
        "revoke",
        resolved.address,
        controlTokenIndex,
      );
      return jsonResult({ ...result, subjectResolvedVia: resolved.via });
    }),
  );
}
