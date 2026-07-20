#!/usr/bin/env node
/**
 * One-shot MCP client for tctc-mcp with camera-friendly output.
 * Used by the VHS tapes in video/tapes/ (and handy for manual testing).
 *
 *   node scripts/tctc-call.mjs list_roles
 *   node scripts/tctc-call.mjs check_role MINTER_ROLE [0xSubject]
 *   node scripts/tctc-call.mjs check_all_roles [0xSubject]
 *   node scripts/tctc-call.mjs grant_role  MINTER_ROLE 0xSubject   (admin env)
 *   node scripts/tctc-call.mjs revoke_role MINTER_ROLE 0xSubject   (admin env)
 *
 * Query tools default to the secret-free agent config; admin tools to
 * examples/config.sepolia.json (needs ALCHEMY_API_KEY and
 * TCTC_ADMIN_PRIVATE_KEY in the environment). Override with TCTC_CONFIG.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { appendFileSync, mkdirSync } from "node:fs";

const G = "\x1b[32m", R = "\x1b[31m", Y = "\x1b[33m", C = "\x1b[36m";
const B = "\x1b[1m", D = "\x1b[2m", X = "\x1b[0m";

const ADMIN_TOOLS = new Set(["grant_role", "revoke_role"]);
const [tool, a1, a2] = process.argv.slice(2);

if (!tool) {
  console.error("usage: tctc-call.mjs <tool> [role] [subject]");
  process.exit(1);
}

const config =
  process.env.TCTC_CONFIG ??
  (ADMIN_TOOLS.has(tool)
    ? "examples/config.sepolia.json"
    : "examples/config.sepolia.agent.json");

const args = {};
if (tool === "check_role") {
  args.role = a1;
  if (a2) args.subject = { address: a2 };
} else if (tool === "check_all_roles") {
  if (a1) args.subject = { address: a1 };
} else if (ADMIN_TOOLS.has(tool)) {
  args.role = a1;
  args.subject = { address: a2 };
}

const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["dist/index.js", "--config", config, "--no-cache"],
  env: process.env,
  stderr: "ignore",
});
const client = new Client({ name: "tctc-call", version: "0.1.0" });
await client.connect(transport);

if (tool === "grant_role") console.log(`${Y}⛏  minting control token on Sepolia…${X}`);
if (tool === "revoke_role") console.log(`${Y}🔥 burning control token on Sepolia…${X}`);

const res = await client.callTool({ name: tool, arguments: args });
const data = JSON.parse(res.content.find((c) => c.type === "text").text);
await client.close();

if (res.isError) {
  console.error(`${R}✘ ${data.error}${X} ${data.message}`);
  process.exit(1);
}

function printCheck(check) {
  const mark = check.hasRole ? `${G}✔ held${X}   ` : `${R}✘ not held${X}`;
  console.log(`${B}${check.role}${X}  ${mark}  ${D}subject${X} ${short(check.subject)}`);
  for (const e of check.evidence) {
    const t = e.typeId === null ? "" : ` typeId ${e.typeId}`;
    console.log(`  ${D}└ ${short(e.controlToken)}${t} → balance${X} ${B}${e.balance}${X}`);
  }
}

switch (tool) {
  case "list_roles":
    console.log(`${B}mode:${X} ${data.mode}`);
    for (const role of data.roles) {
      console.log(`${B}${role.name}${X}  ${D}${role.description ?? ""}${X}`);
    }
    break;
  case "check_role":
    printCheck(data);
    break;
  case "check_all_roles":
    console.log(`${D}on-chain permissions of${X} ${B}${short(data.subject)}${X}`);
    data.roles.forEach(printCheck);
    break;
  case "grant_role":
  case "revoke_role": {
    const verb = tool === "grant_role" ? "granted" : "revoked";
    console.log(`${tool === "grant_role" ? G : R}${B}✔ ${verb} ${data.role}${X} ${
      tool === "grant_role" ? "→" : "from"
    } ${short(data.subject)}`);
    console.log(`  ${C}https://sepolia.etherscan.io/tx/${data.txHash}${X}`);
    mkdirSync("video/out", { recursive: true });
    appendFileSync("video/out/txlog.txt", `${tool} ${data.txHash}\n`);
    break;
  }
  default:
    console.log(JSON.stringify(data, null, 2));
}
