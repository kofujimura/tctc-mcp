#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { Chains } from "./chain.js";
import { BalanceCache, type Context } from "./context.js";
import { registerQueryTools } from "./tools/query.js";
import { registerAdminTools } from "./tools/admin.js";
import { ConfigError } from "./errors.js";

const VERSION = "0.1.0";
const DEFAULT_CACHE_TTL_MS = 10_000;

interface CliOptions {
  configPath?: string;
  cache: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = { cache: true };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--config":
        opts.configPath = argv[++i];
        break;
      case "--no-cache":
        opts.cache = false;
        break;
      case "--version":
        console.log(VERSION);
        process.exit(0);
      case "--help":
        console.log(
          `tctc-mcp ${VERSION} — MCP server for ERC-7303 token-controlled roles

Usage: tctc-mcp --config <file> [--no-cache]

  --config <file>   Config JSON (or set TCTC_CONFIG)
  --no-cache        Disable the 10s balance read cache

Environment:
  TCTC_CONFIG              Config path (alternative to --config)
  TCTC_ADMIN_PRIVATE_KEY   Enables admin mode (grant_role / revoke_role)`,
        );
        process.exit(0);
      default:
        console.error(`unknown argument: ${arg}`);
        process.exit(1);
    }
  }
  return opts;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const configPath = opts.configPath ?? process.env.TCTC_CONFIG;
  if (!configPath) {
    console.error("no config: pass --config <file> or set TCTC_CONFIG");
    process.exit(1);
  }

  const config = loadConfig(configPath);

  const adminKey = process.env.TCTC_ADMIN_PRIVATE_KEY;
  if (adminKey !== undefined && !/^0x[0-9a-fA-F]{64}$/.test(adminKey)) {
    console.error("TCTC_ADMIN_PRIVATE_KEY is set but is not a 32-byte 0x hex string");
    process.exit(1);
  }

  const chains = new Chains(config, adminKey as `0x${string}` | undefined);
  const ctx: Context = {
    config,
    chains,
    cache: new BalanceCache(opts.cache ? DEFAULT_CACHE_TTL_MS : 0),
    adminMode: adminKey !== undefined,
  };

  const server = new McpServer({ name: "tctc-mcp", version: VERSION });
  registerQueryTools(server, ctx);
  if (ctx.adminMode) {
    registerAdminTools(server, ctx);
  }

  // stdout carries the MCP protocol; all logging goes to stderr.
  console.error(
    `tctc-mcp ${VERSION}: ${ctx.adminMode ? "ADMIN" : "read-only"} mode, ` +
      `${Object.keys(config.roles).length} role(s), ` +
      `chains: ${Object.keys(config.chains).join(", ")}` +
      (ctx.adminMode ? `, signer: ${chains.adminAccount!.address}` : ""),
  );

  await server.connect(new StdioServerTransport());
}

main().catch((e) => {
  if (e instanceof ConfigError) {
    console.error(`config error: ${e.message}`);
  } else {
    console.error(e);
  }
  process.exit(1);
});
