#!/usr/bin/env node
/**
 * Pack-then-install verification (runs in prepublishOnly): guarantees the
 * published artifact's ONLY public entry — the `tctc-mcp` bin — actually
 * starts and serves MCP, exactly as a consumer will run it.
 *
 *   npm pack → install the tarball into a scratch app → spawn
 *   node_modules/.bin/tctc-mcp --config … → initialize → tools/list →
 *   call list_roles.
 *
 * This catches bin-path/layout regressions (e.g. dist/index.js moving)
 * that unit tests and in-repo E2Es cannot see.
 */
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const work = mkdtempSync(join(tmpdir(), "tctc-mcp-pack-"));

function fail(msg) {
  console.error(`✗ verify-pack: ${msg}`);
  rmSync(work, { recursive: true, force: true });
  process.exit(1);
}

try {
  console.log("· npm pack …");
  execFileSync("npm", ["pack", "--pack-destination", work], { cwd: ROOT, stdio: "pipe" });
  const tarball = readdirSync(work).find((f) => f.endsWith(".tgz"));
  if (!tarball) fail("npm pack produced no tarball");

  console.log(`· installing ${tarball} into a scratch app …`);
  const app = join(work, "app");
  execFileSync("npm", ["install", "--prefix", app, join(work, tarball)], { stdio: "pipe" });

  const bin = join(app, "node_modules", ".bin", "tctc-mcp");
  const config = join(ROOT, "examples", "config.sepolia.agent.json");
  console.log("· spawning node_modules/.bin/tctc-mcp …");
  const server = spawn(bin, ["--config", config], { stdio: ["pipe", "pipe", "inherit"] });

  let nextId = 0;
  const pending = new Map();
  let buf = "";
  server.stdout.on("data", (c) => {
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
  server.on("exit", (code) => {
    if (pending.size > 0) fail(`server exited early (code ${code}) — the bin does not start`);
  });

  const rpc = (method, params) => {
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      pending.set(id, resolve);
      server.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error(`timeout waiting for ${method}`));
        }
      }, 30_000);
    });
  };

  const init = await rpc("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "verify-pack", version: "0" },
  });
  if (!init.result?.serverInfo?.name) fail("initialize returned no serverInfo");
  console.log(`✓ initialize: ${init.result.serverInfo.name} ${init.result.serverInfo.version ?? ""}`);
  server.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

  const tools = await rpc("tools/list", {});
  const names = (tools.result?.tools ?? []).map((t) => t.name);
  if (!names.includes("list_roles")) fail(`tools/list has no list_roles (got: ${names.join(", ")})`);
  console.log(`✓ tools/list: ${names.join(", ")}`);

  const roles = await rpc("tools/call", { name: "list_roles", arguments: {} });
  const text = roles.result?.content?.[0]?.text ?? "";
  if (roles.result?.isError) fail(`list_roles errored: ${text.slice(0, 200)}`);
  if (!text.includes("MINTER_ROLE")) fail(`list_roles output lacks MINTER_ROLE: ${text.slice(0, 200)}`);
  console.log("✓ list_roles answered with the demo roles");

  server.kill();
  rmSync(work, { recursive: true, force: true });
  console.log("\nverify-pack PASSED — the packed bin serves MCP end to end");
  process.exit(0);
} catch (e) {
  fail(e instanceof Error ? e.message : String(e));
}
