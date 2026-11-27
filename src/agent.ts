/**
 * Agent identity: an AI agent IS an EOA.
 *
 * The agent's private key lives in the folder the agent is started from
 * (`.env.local`, or the TCTC_AGENT_PRIVATE_KEY environment variable). The
 * server derives the agent's address from it, uses that address as the
 * default subject of every check ("what am I allowed to do?"), and signs a
 * dashboard link with it so a human can bind the agent to the TCTC
 * dashboard with proof of key possession. Restart the agent in the same
 * folder and it is the same account — its control tokens, and therefore its
 * permissions, are already on-chain and immediately visible.
 *
 * The key is used for exactly two things: deriving the address and signing
 * the link message (EIP-191). It never signs transactions here, is never
 * logged, and is never returned by a tool.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { ConfigError } from "./errors.js";

export const AGENT_KEY_VAR = "TCTC_AGENT_PRIVATE_KEY";
export const AGENT_NAME_VAR = "TCTC_AGENT_NAME";
export const DASHBOARD_URL_VAR = "TCTC_DASHBOARD_URL";
export const AGENT_ENV_FILE = ".env.local";
export const DEFAULT_DASHBOARD_URL = "https://tctc-mcp.vercel.app/";

/**
 * The only keys ever taken from .env.local. Everything else in the file —
 * notably TCTC_ADMIN_PRIVATE_KEY — is ignored: admin mode stays an explicit
 * choice made in the MCP client's environment, never a side effect of the
 * folder the agent happens to start in.
 */
const DOTENV_KEYS: ReadonlySet<string> = new Set([
  AGENT_KEY_VAR,
  AGENT_NAME_VAR,
  DASHBOARD_URL_VAR,
]);

const NAME_MAX = 64;

/** Minimal dotenv parser: KEY=VALUE, optional `export`, quotes, # comments. */
export function parseDotenv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let value = m[2];
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.indexOf(quote, 1) > 0) {
      value = value.slice(1, value.indexOf(quote, 1));
    } else {
      value = value.replace(/\s+#.*$/, "").trim();
    }
    out[m[1]] = value;
  }
  return out;
}

/** Display name: no control characters (the name is part of a signed message), ≤ 64 chars. */
export function sanitizeAgentName(name: string | undefined): string | undefined {
  if (name === undefined) return undefined;
  const clean = name.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, NAME_MAX).trim();
  return clean === "" ? undefined : clean;
}

export function normalizePrivateKey(value: string): Hex | undefined {
  const v = value.trim();
  if (/^0x[0-9a-fA-F]{64}$/.test(v)) return v as Hex;
  if (/^[0-9a-fA-F]{64}$/.test(v)) return `0x${v}` as Hex;
  return undefined;
}

export interface AgentIdentity {
  /** Holds the key in memory for signing; never serialize this object. */
  account: PrivateKeyAccount;
  address: Address;
  name?: string;
  /** Where the key came from, e.g. "environment" or "/path/.env.local". */
  source: string;
  dashboardUrl: string;
}

/**
 * Resolve the agent identity for a server started in `cwd`. The process
 * environment wins over `.env.local` key by key. Returns undefined when no
 * agent key is configured (the server then falls back to the config's
 * `self`, if any).
 */
export function loadAgentIdentity(
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
  readFile: (path: string) => string = (p) => readFileSync(p, "utf8"),
): AgentIdentity | undefined {
  const envPath = join(cwd, AGENT_ENV_FILE);
  let fileVars: Record<string, string> = {};
  try {
    fileVars = Object.fromEntries(
      Object.entries(parseDotenv(readFile(envPath))).filter(([k]) => DOTENV_KEYS.has(k)),
    );
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code !== "ENOENT") {
      throw new ConfigError(`cannot read ${envPath}: ${(e as Error).message}`);
    }
  }

  const pick = (key: string): { value: string; from: string } | undefined => {
    if (env[key] !== undefined && env[key] !== "") return { value: env[key]!, from: "environment" };
    if (fileVars[key] !== undefined && fileVars[key] !== "") {
      return { value: fileVars[key], from: envPath };
    }
    return undefined;
  };

  const key = pick(AGENT_KEY_VAR);
  if (!key) return undefined;
  const pk = normalizePrivateKey(key.value);
  if (!pk) {
    // Never echo the value: a malformed key is still (part of) a secret.
    throw new ConfigError(
      `${AGENT_KEY_VAR} (from ${key.from}) is not a 32-byte hex private key`,
    );
  }
  const account = privateKeyToAccount(pk);
  const dashboardUrl = pick(DASHBOARD_URL_VAR)?.value ?? DEFAULT_DASHBOARD_URL;
  try {
    new URL(dashboardUrl);
  } catch {
    throw new ConfigError(`${DASHBOARD_URL_VAR} is not a valid URL: ${dashboardUrl}`);
  }
  return {
    account,
    address: account.address,
    name: sanitizeAgentName(pick(AGENT_NAME_VAR)?.value),
    source: key.from,
    dashboardUrl,
  };
}

export interface AgentLinkFields {
  agent: Address;
  name: string;
  chainId: number;
  issuedAt: string;
}

/**
 * The EIP-191 message an agent signs to bind itself to a dashboard.
 * dashboard/src/lib/agent-link.ts builds the identical string to verify it
 * (cross-checked by test/agent-link.test.ts).
 */
export function agentLinkMessage(f: AgentLinkFields): string {
  return [
    "TCTC agent link v1",
    "This agent controls the account below and asks to be shown on a TCTC dashboard.",
    `agent: ${getAddress(f.agent)}`,
    `name: ${f.name}`,
    `chainId: ${f.chainId}`,
    `issuedAt: ${f.issuedAt}`,
  ].join("\n");
}

export interface AgentLink {
  url: string;
  issuedAt: string;
  signature: Hex;
}

/**
 * Dashboard URL that registers this agent: ?agent=…&name=…&chainId=…&ts=…&sig=…
 * Opening it adds the agent to the dashboard's agent list; the signature
 * proves the link was produced by the holder of the agent's key.
 */
export async function buildDashboardLink(
  identity: AgentIdentity,
  chainId: number,
  now: Date = new Date(),
): Promise<AgentLink> {
  const issuedAt = now.toISOString();
  const name = identity.name ?? "";
  const signature = await identity.account.signMessage({
    message: agentLinkMessage({ agent: identity.address, name, chainId, issuedAt }),
  });
  const url = new URL(identity.dashboardUrl);
  url.searchParams.set("chainId", String(chainId));
  url.searchParams.set("agent", identity.address);
  if (name !== "") url.searchParams.set("name", name);
  url.searchParams.set("ts", issuedAt);
  url.searchParams.set("sig", signature);
  return { url: url.toString(), issuedAt, signature };
}
