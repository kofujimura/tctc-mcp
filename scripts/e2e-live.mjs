/**
 * Live E2E against Sepolia through a real MCP client (stdio).
 *
 * 1. read-only server: admin tools must not be registered
 * 2. admin server: check_role → grant_role → check_role → revoke_role → check_role
 *
 * Env: ALCHEMY_API_KEY (RPC), TCTC_ADMIN_PRIVATE_KEY (admin phase),
 *      E2E_SUBJECT (address to grant/revoke; defaults to the signer).
 *
 *   node scripts/e2e-live.mjs
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const SERVER = ["dist/src/index.js", "--config", "examples/config.sepolia.json", "--no-cache"];

async function connect(env) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: SERVER,
    env: { ...process.env, ...env },
    stderr: "inherit",
  });
  const client = new Client({ name: "tctc-e2e", version: "0.0.0" });
  await client.connect(transport);
  return client;
}

function parse(result) {
  const text = result.content?.find((c) => c.type === "text")?.text ?? "{}";
  return { data: JSON.parse(text), isError: result.isError === true };
}

async function call(client, name, args) {
  const { data, isError } = parse(await client.callTool({ name, arguments: args }));
  if (isError) throw new Error(`${name} failed: ${JSON.stringify(data)}`);
  return data;
}

function assert(cond, label) {
  if (!cond) {
    console.error(`✗ ${label}`);
    process.exit(1);
  }
  console.log(`✓ ${label}`);
}

// ---- Phase 1: read-only ----------------------------------------------------
{
  const cleanEnv = { ...process.env };
  delete cleanEnv.TCTC_ADMIN_PRIVATE_KEY;
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: SERVER,
    env: cleanEnv,
    stderr: "inherit",
  });
  const client = new Client({ name: "tctc-e2e", version: "0.0.0" });
  await client.connect(transport);

  const tools = (await client.listTools()).tools.map((t) => t.name).sort();
  assert(
    tools.includes("list_roles") && tools.includes("check_role") && tools.includes("check_all_roles"),
    `read-only: query tools registered (${tools.join(", ")})`,
  );
  assert(
    !tools.includes("grant_role") && !tools.includes("revoke_role"),
    "read-only: admin tools NOT registered",
  );

  const roles = await call(client, "list_roles", {});
  assert(roles.mode === "read-only", "read-only: list_roles reports mode");
  assert(
    roles.roles.some((r) => r.name === "MINTER_ROLE"),
    "read-only: MINTER_ROLE configured",
  );
  await client.close();
}

// ---- Phase 2: admin --------------------------------------------------------
if (!process.env.TCTC_ADMIN_PRIVATE_KEY) {
  console.log("TCTC_ADMIN_PRIVATE_KEY not set — skipping admin phase");
  process.exit(0);
}

const client = await connect({});
const tools = (await client.listTools()).tools.map((t) => t.name).sort();
assert(
  tools.includes("grant_role") && tools.includes("revoke_role"),
  `admin: all tools registered (${tools.join(", ")})`,
);

const subject = process.env.E2E_SUBJECT;
if (!subject) {
  console.error("set E2E_SUBJECT to the address to grant/revoke");
  process.exit(1);
}

const before = await call(client, "check_role", { role: "MINTER_ROLE", subject: { address: subject } });
assert(before.hasRole === false, `admin: subject starts without MINTER_ROLE`);

const granted = await call(client, "grant_role", { role: "MINTER_ROLE", subject: { address: subject } });
assert(granted.status === "success", `admin: grant_role tx ${granted.txHash}`);

const during = await call(client, "check_role", { role: "MINTER_ROLE", subject: { address: subject } });
assert(during.hasRole === true, "admin: check_role now true (evidence balance " +
  during.evidence[0].balance + ")");

const revoked = await call(client, "revoke_role", { role: "MINTER_ROLE", subject: { address: subject } });
assert(revoked.status === "success", `admin: revoke_role tx ${revoked.txHash}`);

const after = await call(client, "check_role", { role: "MINTER_ROLE", subject: { address: subject } });
assert(after.hasRole === false, "admin: check_role false after revoke — kill switch verified");

await client.close();
console.log("\nE2E PASSED");
