#!/usr/bin/env node
/**
 * Packs tctc-gate, installs the tarball into a scratch project, and drives
 * the PACKED bin end to end: initialize → tools/list (gate tool injected,
 * upstream tools present) → unmapped tools/call → TCTC_TOOL_UNMAPPED deny.
 *
 * The chain is a local mock RPC that answers only eth_chainId, so the run is
 * offline-deterministic — it verifies packaging (bin resolution, the bundled
 * core, the startup chain pin), not on-chain behavior, which the live E2E
 * (scripts/e2e-gate.mjs at the repo root) covers.
 */
import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:http";
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const gateDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const META_NS = "io.github.kofujimura/tctc-gate";
let tarballPath;
let workDir;
let gate;
let rpc;

function cleanup() {
  gate?.kill("SIGKILL");
  rpc?.close();
  if (workDir) rmSync(workDir, { recursive: true, force: true });
  if (tarballPath) rmSync(tarballPath, { force: true });
}

function fail(message) {
  cleanup();
  console.error(`verify-pack FAILED — ${message}`);
  process.exit(1);
}

// 1. A local RPC that answers only eth_chainId (the gate's startup pin).
rpc = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    let payload;
    try {
      payload = JSON.parse(body);
    } catch {
      payload = {};
    }
    const answer = (m) =>
      m?.method === "eth_chainId"
        ? { jsonrpc: "2.0", id: m.id ?? null, result: "0xaa36a7" }
        : { jsonrpc: "2.0", id: m?.id ?? null, error: { code: -32601, message: "mock RPC: only eth_chainId" } };
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(Array.isArray(payload) ? payload.map(answer) : answer(payload)));
  });
});
await new Promise((r) => rpc.listen(0, "127.0.0.1", r));
const rpcUrl = `http://127.0.0.1:${rpc.address().port}`;

// 2. Pack the real artifact.
const packOutput = execFileSync("npm", ["pack", "--silent"], { cwd: gateDir, encoding: "utf8" });
const tarball = packOutput.trim().split("\n").pop();
tarballPath = join(gateDir, tarball);

// 3. Install it into a scratch consumer, exactly as a user would.
workDir = mkdtempSync(join(tmpdir(), "tctc-gate-verify-"));
writeFileSync(
  join(workDir, "package.json"),
  JSON.stringify({ name: "verify-consumer", private: true, type: "module" }),
);
execFileSync("npm", ["install", "--no-audit", "--no-fund", tarballPath], {
  cwd: workDir,
  stdio: "pipe",
});
copyFileSync(join(gateDir, "test", "fixtures", "mini-server.mjs"), join(workDir, "mini-server.mjs"));
writeFileSync(
  join(workDir, "gate.json"),
  JSON.stringify({
    chain: { key: "sepolia", chainId: 11155111, rpcUrl },
    target: "0x873f0bf314A1e0B566015CEf9dA37783A729Fd02",
    subject: { mode: "configured", address: "0x31F8FDf2BA077c0f39852b6daAE028a5A7475d03" },
    gate: { tools: { echo: ["MINTER_ROLE"] } },
    server: { command: process.execPath, args: [join(workDir, "mini-server.mjs")] },
  }),
);

// 4. Drive the packed bin over stdio.
gate = spawn(join(workDir, "node_modules", ".bin", "tctc-gate"), ["--config", join(workDir, "gate.json")], {
  cwd: workDir,
  stdio: ["pipe", "pipe", "inherit"],
});
gate.on("error", (e) => fail(`packed bin failed to start: ${e.message}`));

const pending = new Map();
let buffer = "";
gate.stdout.on("data", (chunk) => {
  buffer += chunk.toString("utf8");
  let i;
  while ((i = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, i).trim();
    buffer = buffer.slice(i + 1);
    if (!line) continue;
    const msg = JSON.parse(line);
    if (msg.id !== undefined && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  }
});

function request(id, method, params) {
  return new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => reject(new Error(`${method} timed out`)), 30_000);
    pending.set(id, (msg) => {
      clearTimeout(timer);
      resolvePromise(msg);
    });
    gate.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}

try {
  const init = await request(1, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "verify-pack", version: "0.0.0" },
  });
  if (!init.result?.serverInfo?.name) fail("initialize returned no serverInfo");
  console.log("✓ packed bin initialized (chain pin against mock RPC passed)");
  gate.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

  const list = await request(2, "tools/list", {});
  const names = (list.result?.tools ?? []).map((t) => t.name);
  if (!names.includes("echo")) fail(`upstream tool missing from tools/list: ${names.join(", ")}`);
  if (!names.includes("tctc_gate_status")) fail("injected tctc_gate_status missing from tools/list");
  console.log("✓ tools/list forwards upstream tools and injects tctc_gate_status");

  const deny = await request(3, "tools/call", { name: "definitely_unmapped", arguments: {} });
  const meta = deny.result?._meta?.[META_NS];
  if (deny.result?.isError !== true || meta?.code !== "TCTC_TOOL_UNMAPPED") {
    fail(`unmapped call was not denied as expected: ${JSON.stringify(deny).slice(0, 300)}`);
  }
  console.log("✓ unmapped tool denied with TCTC_TOOL_UNMAPPED in namespaced _meta");
} catch (e) {
  fail(e instanceof Error ? e.message : String(e));
}

cleanup();
console.log("verify-pack PASSED — the packed tctc-gate bin proxies MCP end to end");
