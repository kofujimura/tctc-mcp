#!/usr/bin/env node
/**
 * tctc-gate — token-gate an existing MCP server with ERC-7303 roles.
 *
 *   tctc-gate --config gate.json
 *   tctc-gate --config gate.json -- <command> [args…]   (server override)
 *
 * See docs/GATE_SPEC.md in the tctc-mcp repository.
 */
import { spawn } from "node:child_process";
import { buildChildEnv, loadGateConfig, ConfigError } from "./config.js";
import { Policy } from "./policy.js";
import { AdmissionController } from "./admission.js";
import { GateProxy } from "./proxy.js";

function fail(message: string): never {
  process.stderr.write(`tctc-gate: ${message}\n`);
  process.exit(1);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const dashdash = argv.indexOf("--");
  const own = dashdash >= 0 ? argv.slice(0, dashdash) : argv;
  const override = dashdash >= 0 ? argv.slice(dashdash + 1) : undefined;

  const configIdx = own.indexOf("--config");
  if (configIdx < 0 || !own[configIdx + 1]) fail("usage: tctc-gate --config <gate.json> [-- <command> …]");
  let config;
  try {
    config = loadGateConfig(own[configIdx + 1]);
  } catch (e) {
    fail(e instanceof ConfigError ? e.message : String(e));
  }
  if (override && override.length > 0) {
    config = { ...config, server: { ...config.server, command: override[0], args: override.slice(1) } };
  }

  const policy = new Policy(config);
  const admission = new AdmissionController(config);
  try {
    await admission.verifyChainId();
  } catch (e) {
    fail((e as Error).message); // fail closed before serving anything
  }

  let childEnv: Record<string, string>;
  try {
    childEnv = buildChildEnv(config, process.env);
  } catch (e) {
    fail((e as Error).message);
  }

  const child = spawn(config.server.command, config.server.args, {
    env: childEnv,
    stdio: ["pipe", "pipe", "inherit"],
  });
  child.on("error", (e) => fail(`wrapped server failed to start: ${e.message}`));
  child.on("exit", (code, signal) => {
    process.exit(code ?? (signal ? 1 : 0));
  });
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, () => child.kill(sig));
  }

  new GateProxy({
    config,
    policy,
    admission,
    clientIn: process.stdin,
    clientOut: process.stdout,
    serverIn: child.stdin!,
    serverOut: child.stdout!,
    log: (line) => process.stderr.write(line + "\n"),
  }).start();
}

void main();
