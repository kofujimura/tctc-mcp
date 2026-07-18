#!/usr/bin/env node
/**
 * Live E2E for tctc-gate (GATE_SPEC §9): the gate wraps an unmodified MCP
 * server; an on-chain grant makes a gated tool work, a burn makes the next
 * call deny. Requires E2E_ISSUER_PRIVATE_KEY (owner of the demo control
 * tokens) in the environment; Sepolia via public RPC.
 *
 *   E2E_ISSUER_PRIVATE_KEY=0x… node scripts/e2e-gate.mjs
 */
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, http, parseAbi } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RPC = process.env.E2E_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com";
const TARGET = "0x873f0bf314A1e0B566015CEf9dA37783A729Fd02"; // MyComplexToken
const CT = "0x12342A7F0190B3AF3F4b47546D34006EDA54eE0B"; // AgentControlTokens (typeId 1 = MinterCert)

const issuerKey = process.env.E2E_ISSUER_PRIVATE_KEY;
if (!issuerKey) {
  console.error("E2E_ISSUER_PRIVATE_KEY not set — skipping live gate E2E.");
  process.exit(0);
}

const subject = privateKeyToAccount(generatePrivateKey()).address;
console.log("subject (fresh):", subject);

const configPath = join(mkdtempSync(join(tmpdir(), "tctc-gate-e2e-")), "gate.json");
writeFileSync(
  configPath,
  JSON.stringify({
    chain: { key: "sepolia", chainId: 11155111, rpcUrl: RPC },
    target: TARGET,
    subject: { mode: "configured", address: subject },
    gate: { public: ["add"], tools: { echo: ["MINTER_ROLE"] } },
    server: { command: process.execPath, args: [join(ROOT, "gate/test/fixtures/mini-server.mjs")] },
  }),
);

const gate = spawn(process.execPath, [join(ROOT, "gate/dist/index.js"), "--config", configPath], {
  stdio: ["pipe", "pipe", "inherit"],
});

let nextId = 0;
const pending = new Map();
let buf = "";
gate.stdout.on("data", (c) => {
  buf += c.toString();
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    const msg = JSON.parse(line);
    if (msg.id !== undefined && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  }
});

function rpc(method, params) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    pending.set(id, resolve);
    gate.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`timeout waiting for ${method} (id ${id})`));
      }
    }, 60_000);
  });
}

const META = "io.github.kofujimura/tctc-gate";
let step = 0;
let failed = 0;
function check(name, ok, detail = "") {
  step++;
  console.log(`${ok ? "✅" : "❌"} ${String(step).padStart(2)} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed++;
}

// --- chain helpers (issuer side) ---
const abi = parseAbi([
  "function mint(address to, uint256 id, uint256 amount)",
  "function burnByIssuer(address account, uint256 id, uint256 amount)",
]);
const pub = createPublicClient({ chain: sepolia, transport: http(RPC) });
const issuer = createWalletClient({
  account: privateKeyToAccount(issuerKey.startsWith("0x") ? issuerKey : `0x${issuerKey}`),
  chain: sepolia,
  transport: http(RPC),
});
async function tx(fn, args) {
  const hash = await issuer.writeContract({ address: CT, abi, functionName: fn, args });
  await pub.waitForTransactionReceipt({ hash });
  return hash;
}

try {
  // 1. initialize
  const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "e2e", version: "0" } });
  check("initialize decorated", init.result.serverInfo.name === "mini-server (tctc-gated)", init.result.serverInfo.name);
  check("instructions appended", init.result.instructions.includes("tctc-gate"));

  // 2. tools/list, both pages
  const p1 = await rpc("tools/list", {});
  const p1names = p1.result.tools.map((t) => t.name);
  check("page 1 has gate tool once", p1names.filter((n) => n === "tctc_gate_status").length === 1, p1names.join(","));
  check("gated tool annotated", p1.result.tools.find((t) => t.name === "echo").description.includes("MINTER_ROLE"));
  const p2 = await rpc("tools/list", { cursor: p1.result.nextCursor });
  const p2names = p2.result.tools.map((t) => t.name);
  check("page 2: squatter shadowed, no duplicates", !p2names.includes("tctc_gate_fake") && !p2names.includes("tctc_gate_status"), p2names.join(","));

  // 3. public tool works without any role
  const add = await rpc("tools/call", { name: "add", arguments: { a: 20, b: 22 } });
  check("public tool forwarded", add.result.content?.[0]?.text === "42");

  // 4. gated tool denied before grant
  const deny1 = await rpc("tools/call", { name: "echo", arguments: { text: "hi" } });
  const meta1 = deny1.result?._meta?.[META];
  check("denied before grant", deny1.result?.isError === true && meta1?.code === "TCTC_ROLE_DENIED", meta1?.code);
  check("grantUrl carries roles", meta1?.grantUrl?.includes("roles=MINTER_ROLE"), meta1?.grantUrl);
  check("evidence shows balance 0", meta1?.missing?.[0]?.evidence?.some((e) => e.balanceOf === "0"));
  check("observedBlockNumber present", /^\d+$/.test(meta1?.observedBlockNumber ?? ""), meta1?.observedBlockNumber);

  // 5. status agrees
  const st1 = await rpc("tools/call", { name: "tctc_gate_status", arguments: {} });
  check("status shows missing", st1.result._meta[META].roles.find((r) => r.role === "MINTER_ROLE").held === false);

  // 6. grant on-chain → allowed
  console.log("   … minting MinterCert to subject");
  await tx("mint", [subject, 1n, 1n]);
  const ok1 = await rpc("tools/call", { name: "echo", arguments: { text: "gated hello" } });
  check("allowed after grant", ok1.result?.isError !== true && ok1.result.content?.[0]?.text === "gated hello");

  // 7. kill switch: burn → next call denied (allow cache is 0)
  console.log("   … burnByIssuer (kill switch)");
  await tx("burnByIssuer", [subject, 1n, 1n]);
  const deny2 = await rpc("tools/call", { name: "echo", arguments: { text: "still there?" } });
  check("denied after burn", deny2.result?.isError === true && deny2.result._meta[META].code === "TCTC_ROLE_DENIED");

  // 8. status flips back
  const st2 = await rpc("tools/call", { name: "tctc_gate_status", arguments: {} });
  check("status shows missing again", st2.result._meta[META].roles.find((r) => r.role === "MINTER_ROLE").held === false);

  console.log(failed === 0 ? `\nE2E PASSED (${step} checks)` : `\nE2E FAILED (${failed}/${step})`);
  process.exit(failed === 0 ? 0 : 1);
} catch (e) {
  console.error("E2E error:", e);
  process.exit(1);
} finally {
  gate.kill();
}
