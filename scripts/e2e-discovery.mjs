/**
 * Live E2E of IERC7303 discovery against Sepolia through a real MCP client.
 * Read-only throughout (public RPC, no keys):
 *
 *   1. list_roles shows discovery-configured roles (no controlTokens)
 *   2. check_role resolves bindings from the target via IERC7303 and
 *      reports the target's own hasRole() as the verdict
 *   3. discover_roles enumerates bindings for an arbitrary address
 *   4. discover_roles on a pre-IERC7303 contract → supportsIERC7303: false
 *
 *   node scripts/e2e-discovery.mjs
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const SERVER = ["dist/src/index.js", "--config", "examples/config.sepolia.discovery.json", "--no-cache"];
const TARGET = "0x4C0a78803D47154B9C6F42EC4AEbab2D1C94c97D"; // IERC7303-compliant
const LEGACY = "0xa52fe39D0de852e88488faa34e723E861D0b09BD"; // pre-IERC7303
const CT = "0x12342A7F0190B3AF3F4b47546D34006EDA54eE0B";

const cleanEnv = { ...process.env };
delete cleanEnv.TCTC_ADMIN_PRIVATE_KEY;

const transport = new StdioClientTransport({
  command: process.execPath,
  args: SERVER,
  env: cleanEnv,
  stderr: "inherit",
});
const client = new Client({ name: "tctc-e2e-discovery", version: "0.0.0" });
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

function assert(cond, label) {
  if (!cond) {
    console.error(`✗ ${label}`);
    process.exit(1);
  }
  console.log(`✓ ${label}`);
}

// 1. list_roles
const roles = await call("list_roles", {});
const minter = roles.roles.find((r) => r.name === "MINTER_ROLE");
assert(minter?.controlTokens === null, "list_roles: MINTER_ROLE has no static controlTokens");
assert(minter?.discovery?.target === TARGET, "list_roles: MINTER_ROLE discovers from the target");

// 2. check_role (self = skill wallet; holds no certs)
const check = await call("check_role", { role: "MINTER_ROLE" });
assert(check.bindingSource === "ierc7303", "check_role: bindings came from IERC7303");
assert(check.target === TARGET, "check_role: reports the introspected target");
assert(
  check.evidence.length === 1 &&
    check.evidence[0].controlToken === CT &&
    check.evidence[0].typeId === "1",
  "check_role: discovered binding is AgentControlTokens typeId 1",
);
assert(check.hasRole === false, "check_role: subject without cert is denied");

// 3. discover_roles on the compliant target
const disc = await call("discover_roles", {
  target: TARGET,
  roles: ["MINTER_ROLE", "BURNER_ROLE"],
  subject: {},
});
assert(disc.supportsIERC7303 === true, "discover_roles: target supports IERC7303");
const dm = disc.roles.find((r) => r.role === "MINTER_ROLE");
const db = disc.roles.find((r) => r.role === "BURNER_ROLE");
assert(
  dm.erc1155ControlTokens.length === 1 && dm.erc1155ControlTokens[0].typeId === "1",
  "discover_roles: MINTER_ROLE → typeId 1",
);
assert(
  db.erc1155ControlTokens.length === 1 && db.erc1155ControlTokens[0].typeId === "2",
  "discover_roles: BURNER_ROLE → typeId 2",
);
assert(dm.hasRole === false, "discover_roles: hasRole reported for the subject");

// 4. discover_roles on the pre-IERC7303 deployment
const legacy = await call("discover_roles", { target: LEGACY, roles: ["MINTER_ROLE"] });
assert(legacy.supportsIERC7303 === false, "discover_roles: legacy target reports no IERC7303");
assert(legacy.roles.length === 0, "discover_roles: no bindings claimed for legacy target");

console.log("\nAll discovery E2E checks passed.");
await client.close();
