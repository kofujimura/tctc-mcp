#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { Chains } from "./chain.js";
import { BalanceCache, TtlCache, type Context } from "./context.js";
import { registerQueryTools } from "./tools/query.js";
import { registerAdminTools } from "./tools/admin.js";
import { ConfigError } from "./errors.js";
import { AGENT_ENV_FILE, AGENT_KEY_VAR, buildDashboardLink, loadAgentIdentity } from "./agent.js";
import { runAgentCommand } from "./agent-cli.js";

const VERSION = "0.3.3";
const DEFAULT_CACHE_TTL_MS = 10_000;
const DISCOVERY_CACHE_TTL_MS = 60_000;

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
       tctc-mcp agent init|link …   (agent identity helpers; see tctc-mcp agent)

  --config <file>   Config JSON (or set TCTC_CONFIG)
  --no-cache        Disable the balance (10s) and IERC7303 discovery (60s) caches

Environment:
  TCTC_CONFIG              Config path (alternative to --config)
  TCTC_ADMIN_PRIVATE_KEY   Enables admin mode (grant_role / revoke_role)
  TCTC_AGENT_PRIVATE_KEY   The agent's own EOA key (also read from ./.env.local):
                           its address becomes the default subject, and a
                           signed dashboard link is offered via whoami
  TCTC_AGENT_NAME          Display name for the dashboard (optional)
  TCTC_DASHBOARD_URL       Dashboard base URL (default https://tctc-mcp.vercel.app/)`,
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
  if (process.argv[2] === "agent") {
    process.exit(await runAgentCommand(process.argv.slice(3)));
  }
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

  // The agent's own EOA, from the environment or ./.env.local of the folder
  // the MCP client starts us in. Only TCTC_AGENT_* keys are read from that
  // file — never the admin key.
  const agent = loadAgentIdentity(process.cwd(), process.env);

  const chains = new Chains(config, adminKey as `0x${string}` | undefined);
  const ctx: Context = {
    config,
    chains,
    cache: new BalanceCache(opts.cache ? DEFAULT_CACHE_TTL_MS : 0),
    discovery: new TtlCache(opts.cache ? DISCOVERY_CACHE_TTL_MS : 0),
    adminMode: adminKey !== undefined,
    agent,
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
  if (agent) {
    const chainId = config.chains[config.defaultChain].chainId;
    const link = await buildDashboardLink(agent, chainId);
    console.error(
      `tctc-mcp: agent ${agent.address}${agent.name ? ` "${agent.name}"` : ""} ` +
        `(key from ${agent.source}) is the default subject` +
        (config.self ? "; it takes precedence over the config's self" : ""),
    );
    console.error(`tctc-mcp: dashboard (signed agent link): ${link.url}`);
  } else {
    console.error(
      `tctc-mcp: no agent key (${AGENT_KEY_VAR} or ./${AGENT_ENV_FILE}); ` +
        (config.self ? "default subject is the config's self" : "no default subject"),
    );
  }

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
