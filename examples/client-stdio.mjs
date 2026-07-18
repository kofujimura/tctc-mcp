#!/usr/bin/env node
/**
 * Minimal official example: using tctc-mcp from your own app (a web
 * backend, a script, an agent host) via the MCP SDK.
 *
 * The ONLY supported entry point is the `tctc-mcp` bin — never reference
 * the package's dist/ files directly (they are internal and unversioned;
 * the package's `exports` field refuses deep imports).
 *
 *   npm install tctc-mcp @modelcontextprotocol/sdk
 *   node examples/client-stdio.mjs
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

const transport = new StdioClientTransport({
  // "--no-install" = use the locally installed package, resolved to its bin.
  // (Inside this repository, `node dist/index.js` works too after `npm run build`.)
  command: "npx",
  args: ["--no-install", "tctc-mcp", "--config", join(HERE, "config.sepolia.agent.json")],
});

const client = new Client({ name: "example-client", version: "1.0.0" });
await client.connect(transport);

const tools = await client.listTools();
console.log("tools:", tools.tools.map((t) => t.name).join(", "));

const roles = await client.callTool({ name: "list_roles", arguments: {} });
console.log(roles.content?.[0]?.text);

await client.close();
