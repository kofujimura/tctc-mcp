/**
 * Live E2E of timed roles (v0.3) against Sepolia through a real MCP client.
 * Exercises the full "grant for N seconds → gasless auto-expiry" cycle on
 * TIMED_MINTER_ROLE: an UNMODIFIED TCTCDemoToken bound to
 * ExpiringControlTokens, whose balanceOf() returns 0 after expiry.
 *
 *   1. list_roles marks TIMED_MINTER_ROLE as timedGrant
 *   2. grant_role without an expiry is rejected with a helpful error
 *   3. grant_role with expiresInSeconds succeeds and reports expiresAt
 *   4. check_role: hasRole true, evidence carries the same expiresAt
 *   5. after the expiry passes: hasRole false — with NO further transaction
 *   6. revoke_role still works (burns the expired token, cleaning up)
 *
 * Needs ALCHEMY_API_KEY, TCTC_ADMIN_PRIVATE_KEY and E2E_SUBJECT in the env:
 *
 *   node scripts/e2e-expiry.mjs
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const SERVER = ["dist/src/index.js", "--config", "examples/config.sepolia.json", "--no-cache"];
const ECT = "0xb5abB6c060ed287e8B25aD121c8B46eE404fF09b";
const EXPIRES_IN = 75; // seconds — long enough for inclusion, short enough to watch expire

const SUBJECT = process.env.E2E_SUBJECT;
if (!SUBJECT || !process.env.TCTC_ADMIN_PRIVATE_KEY) {
  console.error("Set E2E_SUBJECT and TCTC_ADMIN_PRIVATE_KEY (and ALCHEMY_API_KEY)");
  process.exit(1);
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: SERVER,
  env: process.env,
  stderr: "inherit",
});
const client = new Client({ name: "tctc-e2e-expiry", version: "0.0.0" });
await client.connect(transport);

function parse(result) {
  const text = result.content?.find((c) => c.type === "text")?.text ?? "{}";
  return { data: JSON.parse(text), isError: result.isError === true };
}

async function call(name, args) {
  const { data, isError } = parse(await client.callTool({ name, arguments: args }));
  if (isError) throw new Error(`${name} failed: ${JSON.stringify(data)}`);
  return data;
}

async function callExpectingError(name, args) {
  const { data, isError } = parse(await client.callTool({ name, arguments: args }));
  if (!isError) throw new Error(`${name} unexpectedly succeeded: ${JSON.stringify(data)}`);
  return data;
}

function assert(cond, label) {
  if (!cond) {
    console.error(`✗ ${label}`);
    process.exit(1);
  }
  console.log(`✓ ${label}`);
}

// 1. list_roles
const roles = await call("list_roles", {});
const timed = roles.roles.find((r) => r.name === "TIMED_MINTER_ROLE");
assert(timed?.adminActions.timedGrant === true, "list_roles: TIMED_MINTER_ROLE is a timed grant");
assert(timed?.discovery !== null, "list_roles: bindings come from the target via IERC7303");

// 2. grant without expiry → helpful error
const err = await callExpectingError("grant_role", {
  role: "TIMED_MINTER_ROLE",
  subject: { address: SUBJECT },
});
assert(/expiresInSeconds/.test(err.message ?? ""), "grant_role without expiry is rejected");

// 3. timed grant
const grant = await call("grant_role", {
  role: "TIMED_MINTER_ROLE",
  subject: { address: SUBJECT },
  expiresInSeconds: EXPIRES_IN,
});
assert(grant.status === "success", `grant_role succeeded (tx ${grant.txHash})`);
assert(grant.controlToken === ECT, "grant minted on ExpiringControlTokens");
const expiresAt = Number(grant.expiresAt);
assert(Number.isFinite(expiresAt) && expiresAt > Date.now() / 1000, "grant reports expiresAt");

// 4. while valid
const before = await call("check_role", { role: "TIMED_MINTER_ROLE", subject: { address: SUBJECT } });
assert(before.hasRole === true, "check_role: role held while valid");
assert(before.evidence[0].expiresAt === grant.expiresAt, "check_role: evidence carries expiresAt");

// 5. wait out the expiry — no transaction is sent from here on
process.stdout.write(`waiting for expiry (${EXPIRES_IN}s + block lag)`);
let after;
for (;;) {
  await new Promise((r) => setTimeout(r, 15000));
  process.stdout.write(".");
  after = await call("check_role", { role: "TIMED_MINTER_ROLE", subject: { address: SUBJECT } });
  if (after.hasRole === false) break;
  if (Date.now() / 1000 > expiresAt + 120) {
    console.error("\n✗ role still held long after expiry");
    process.exit(1);
  }
}
console.log("");
assert(after.hasRole === false, "check_role: role auto-revoked after expiry — no tx sent");
assert(after.evidence[0].balance === "0", "check_role: time-aware balanceOf reads 0");
assert(after.evidence[0].expiresAt === grant.expiresAt, "check_role: past expiresAt still reported");

// 6. cleanup: revoke burns the expired token (raw balance still 1 until swept)
const revoke = await call("revoke_role", {
  role: "TIMED_MINTER_ROLE",
  subject: { address: SUBJECT },
});
assert(revoke.status === "success", `revoke_role cleans up (tx ${revoke.txHash})`);
const final = await call("check_role", { role: "TIMED_MINTER_ROLE", subject: { address: SUBJECT } });
assert(final.hasRole === false && final.evidence[0].expiresAt === undefined,
  "check_role: expiry cleared after revoke");

console.log("\nAll expiry E2E checks passed.");
await client.close();
