/**
 * `tctc-mcp agent …` — helpers for the agent-is-an-EOA setup.
 *
 *   tctc-mcp agent init [--name <name>]       create .env.local with a fresh agent key
 *   tctc-mcp agent link [--config <file>]     print the signed dashboard link
 *
 * Both run in the agent's folder (the folder the MCP client starts the
 * server from) and never print the private key.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { generatePrivateKey } from "viem/accounts";
import {
  AGENT_ENV_FILE,
  AGENT_KEY_VAR,
  AGENT_NAME_VAR,
  buildDashboardLink,
  loadAgentIdentity,
  parseDotenv,
  sanitizeAgentName,
  type AgentIdentity,
} from "./agent.js";
import { loadConfig } from "./config.js";

const SEPOLIA_CHAIN_ID = 11155111;

const USAGE = `Usage:
  tctc-mcp agent init [--name <name>] [--config <file>]
      Create ${AGENT_ENV_FILE} in the current folder with a fresh agent key
      (${AGENT_KEY_VAR}); idempotent — an existing key is kept.
  tctc-mcp agent link [--config <file>] [--chain-id <id>]
      Print this agent's address and its signed dashboard link.

The chain id of the link is --chain-id, else the config's defaultChain,
else Sepolia (${SEPOLIA_CHAIN_ID}).`;

interface AgentArgs {
  sub?: string;
  name?: string;
  configPath?: string;
  chainId?: number;
}

function parseAgentArgs(argv: string[]): AgentArgs {
  const out: AgentArgs = { sub: argv[0] };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--name") out.name = argv[++i];
    else if (a === "--config") out.configPath = argv[++i];
    else if (a === "--chain-id") out.chainId = Number(argv[++i]);
    else throw new Error(`unknown argument: ${a}`);
  }
  if (out.chainId !== undefined && !Number.isSafeInteger(out.chainId)) {
    throw new Error("--chain-id must be an integer");
  }
  return out;
}

function linkChainId(args: AgentArgs): number {
  if (args.chainId !== undefined) return args.chainId;
  const path = args.configPath ?? process.env.TCTC_CONFIG;
  if (path) {
    const config = loadConfig(path);
    return config.chains[config.defaultChain].chainId;
  }
  return SEPOLIA_CHAIN_ID;
}

async function printIdentity(identity: AgentIdentity, chainId: number): Promise<void> {
  const link = await buildDashboardLink(identity, chainId);
  console.log(`agent address : ${identity.address}`);
  if (identity.name) console.log(`agent name    : ${identity.name}`);
  console.log(`key source    : ${identity.source}`);
  console.log(`dashboard link (signed by the agent key, chain ${chainId}):`);
  console.log(`  ${link.url}`);
}

function gitignoreCovers(dir: string): boolean {
  const path = join(dir, ".gitignore");
  if (!existsSync(path)) return false;
  const lines = readFileSync(path, "utf8").split(/\r?\n/).map((l) => l.trim());
  return lines.some((l) => [".env.local", ".env*", ".env.*", "*.local", "/.env.local"].includes(l));
}

async function init(args: AgentArgs, cwd: string): Promise<number> {
  const envPath = join(cwd, AGENT_ENV_FILE);
  const existing = existsSync(envPath) ? readFileSync(envPath, "utf8") : undefined;
  if (existing !== undefined && parseDotenv(existing)[AGENT_KEY_VAR]) {
    console.log(`${envPath} already holds ${AGENT_KEY_VAR} — keeping it.`);
  } else {
    const name = sanitizeAgentName(args.name);
    const lines = [
      `# tctc-mcp agent identity (created ${new Date().toISOString()}).`,
      `# This key IS the agent: keep this file private and out of version control.`,
      `${AGENT_KEY_VAR}=${generatePrivateKey()}`,
      ...(name ? [`${AGENT_NAME_VAR}="${name.replace(/"/g, "'")}"`] : []),
    ];
    const prefix = existing !== undefined && existing !== "" && !existing.endsWith("\n") ? "\n" : "";
    // mode applies on creation only; an existing file keeps its permissions.
    writeFileSync(envPath, `${prefix}${lines.join("\n")}\n`, { flag: "a", mode: 0o600 });
    console.log(`wrote a new agent key to ${envPath}`);
  }
  if (!gitignoreCovers(cwd)) {
    console.log(`note: add "${AGENT_ENV_FILE}" to .gitignore so the agent key is never committed.`);
  }
  const identity = loadAgentIdentity(cwd, {});
  if (!identity) throw new Error(`${envPath} has no ${AGENT_KEY_VAR}`);
  await printIdentity(identity, linkChainId(args));
  return 0;
}

async function link(args: AgentArgs, cwd: string): Promise<number> {
  const identity = loadAgentIdentity(cwd, process.env);
  if (!identity) {
    console.error(
      `no agent key: set ${AGENT_KEY_VAR} or create ${AGENT_ENV_FILE} with \`tctc-mcp agent init\``,
    );
    return 1;
  }
  await printIdentity(identity, linkChainId(args));
  return 0;
}

export async function runAgentCommand(argv: string[], cwd = process.cwd()): Promise<number> {
  let args: AgentArgs;
  try {
    args = parseAgentArgs(argv);
  } catch (e) {
    console.error(`${(e as Error).message}\n\n${USAGE}`);
    return 1;
  }
  if (args.sub === "init") return init(args, cwd);
  if (args.sub === "link") return link(args, cwd);
  console.error(USAGE);
  return args.sub === undefined || args.sub === "--help" ? 0 : 1;
}
