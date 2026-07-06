import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Context } from "../context.js";
import { checkRole, checkAllRoles } from "../roles.js";
import { resolveSubject } from "../subject.js";
import { resolveAgent } from "../identity.js";
import { jsonResult, handled } from "./util.js";

const subjectShape = z
  .object({
    address: z.string().describe("EVM address to check").optional(),
    agentId: z
      .number()
      .int()
      .nonnegative()
      .describe("ERC-8004 agentId; resolved to its ERC-6551 TBA")
      .optional(),
  })
  .describe(
    "Whose permissions to check. Give address OR agentId; omit entirely to use the config's own identity (self).",
  );

export function registerQueryTools(server: McpServer, ctx: Context): void {
  server.registerTool(
    "list_roles",
    {
      title: "List configured ERC-7303 roles",
      description:
        "List the roles this server knows about and the on-chain control tokens " +
        "that grant them. Holding (balanceOf > 0) ANY control token of a role " +
        "grants that role (ERC-7303 OR semantics).",
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    handled(async () =>
      jsonResult({
        mode: ctx.adminMode ? "admin" : "read-only",
        roles: Object.entries(ctx.config.roles).map(([name, role]) => ({
          name,
          description: role.description ?? null,
          controlTokens: role.controlTokens.map((t) => ({
            chain: t.chain,
            standard: t.standard,
            address: t.address,
            typeId: t.typeId === null ? null : t.typeId.toString(),
          })),
          adminActions: {
            grant: Boolean(role.admin?.grant),
            revoke: Boolean(role.admin?.revoke),
          },
        })),
      }),
    ),
  );

  server.registerTool(
    "check_role",
    {
      title: "Check an ERC-7303 role",
      description:
        "Check whether an account currently holds a role, by reading balanceOf " +
        "on each of the role's control tokens. Advisory only: the enforcing check " +
        "is the ERC-7303 modifier on-chain, so a transaction sent without the role " +
        "reverts regardless of this result.",
      inputSchema: {
        role: z.string().describe("Role name, e.g. MINTER_ROLE"),
        subject: subjectShape.optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    handled(async ({ role, subject }) => {
      const resolved = await resolveSubject(ctx, subject);
      const result = await checkRole(ctx, role, resolved.address);
      return jsonResult({ ...result, subjectResolvedVia: resolved.via });
    }),
  );

  server.registerTool(
    "check_all_roles",
    {
      title: "Check all configured roles",
      description:
        "Check every configured role for one account in a single call — an " +
        "agent's session-start self-assessment ('what am I allowed to do right now?').",
      inputSchema: {
        subject: subjectShape.optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    handled(async ({ subject }) => {
      const resolved = await resolveSubject(ctx, subject);
      const result = await checkAllRoles(ctx, resolved.address);
      return jsonResult({ ...result, subjectResolvedVia: resolved.via });
    }),
  );

  if (ctx.config.identity) {
    server.registerTool(
      "resolve_agent",
      {
        title: "Resolve an ERC-8004 agent",
        description:
          "Resolve an ERC-8004 agentId to its current control structure: NFT owner, " +
          "agentURI, agentWallet, and the ERC-6551 Token Bound Account (computed " +
          "deterministically; valid even before deployment). The TBA is the " +
          "recommended target for granting control tokens.",
        inputSchema: {
          agentId: z.number().int().nonnegative(),
        },
        annotations: { readOnlyHint: true, openWorldHint: true },
      },
      handled(async ({ agentId }) => jsonResult(await resolveAgent(ctx, agentId))),
    );
  }
}
