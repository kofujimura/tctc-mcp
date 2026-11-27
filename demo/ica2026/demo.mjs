#!/usr/bin/env node
/**
 * The ICA 2026 talk's story on a real chain.
 *
 * The dashboard's story mode (?story=ica2026) replays a script. This file
 * puts the same world on Sepolia, so the dashboard can show it from chain
 * state instead (?story=ica2026&live): Acme Corp issues Mika an employee
 * ID; Mika issues her agent Kit one delegation token that four
 * applications accept; Acme issues Kit a timed pass; Mika burns her token
 * and every application closes.
 *
 *   node demo/ica2026/demo.mjs setup         deploy what is missing, fund Mika, issue her Employee ID
 *   node demo/ica2026/demo.mjs status        who holds what right now
 *   node demo/ica2026/demo.mjs reset         scene 1: Kit holds nothing
 *   node demo/ica2026/demo.mjs grant         scene 2: Mika mints "Release assistant" to Kit
 *   node demo/ica2026/demo.mjs pass [secs]   scene 3: Acme mints "Production access" to Kit (default 1800 s)
 *   node demo/ica2026/demo.mjs expire [secs] scene 4: Acme moves that pass's expiry to secs from now (default 45)
 *   node demo/ica2026/demo.mjs burn          scene 6: Mika burns "Release assistant"
 *
 * Keys are read, never printed:
 *   Acme (issuer, pays for setup)  ICA2026_ACME_PRIVATE_KEY, else WALLET_PRIVATE_KEY
 *   Mika                           ICA2026_MIKA_PRIVATE_KEY (setup creates it in demo/ica2026/.env.local)
 *   Kit                            only its address: ICA2026_KIT_ADDRESS, else derived from
 *                                  demo/ica2026/kit/.env.local (`tctc-mcp agent init --name Kit` there)
 * from the environment, then demo/ica2026/.env.local, then the file named
 * by ICA2026_ISSUER_ENV (default ~/.claude/skills/nft-developer-skill/.env.local).
 * The RPC is ICA2026_RPC, else Alchemy Sepolia when ALCHEMY_API_KEY is
 * set, else a public Sepolia endpoint.
 */
import { appendFileSync, chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  formatEther,
  http,
  keccak256,
  parseEther,
  stringToHex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const HERE = dirname(fileURLToPath(import.meta.url));
const LOCAL_ENV = join(HERE, ".env.local");
const KIT_ENV = join(HERE, "kit", ".env.local");
const DASHBOARD_MODULE = join(HERE, "..", "..", "dashboard", "src", "lib", "deployment.ica2026.ts");
const SEPOLIA = 11155111;

/** Every token in the story is type 1 of its collection. */
const TYPE_ID = 1n;
/** What setup sends Mika when she has less than half of it: enough for her few transactions. */
const MIKA_FUNDS = parseEther("0.02");

const role = (name) => keccak256(stringToHex(name));
const AGENT_ROLE = role("AGENT_ROLE");
const MEMBER_ROLE = role("MEMBER_ROLE");
const OPERATOR_ROLE = role("OPERATOR_ROLE");

/** The applications, in the order the dashboard lists them. */
const DOORS = [
  ["files", "Project files", AGENT_ROLE],
  ["memory", "Agent memory", AGENT_ROLE],
  ["summary", "Summary API", AGENT_ROLE],
  ["registry", "Release registry", AGENT_ROLE],
  ["deploy", "Deploy pipeline", OPERATOR_ROLE],
];

// ─── environment ────────────────────────────────────────────────────────────

function parseEnv(path) {
  const out = {};
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^(["'])(.*)\1$/, "$2");
  }
  return out;
}

const ISSUER_ENV =
  process.env.ICA2026_ISSUER_ENV ?? join(homedir(), ".claude", "skills", "nft-developer-skill", ".env.local");
const env = { ...parseEnv(ISSUER_ENV), ...parseEnv(LOCAL_ENV), ...process.env };

function asKey(value, what) {
  const key = value?.startsWith("0x") ? value : `0x${value ?? ""}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error(`${what} is missing or is not a 32-byte hex key`);
  return key;
}

function rpcUrl() {
  if (env.ICA2026_RPC) return env.ICA2026_RPC;
  if (env.ALCHEMY_API_KEY) return `https://eth-sepolia.g.alchemy.com/v2/${env.ALCHEMY_API_KEY}`;
  return "https://ethereum-sepolia-rpc.publicnode.com";
}

function kitAddress() {
  if (env.ICA2026_KIT_ADDRESS) return env.ICA2026_KIT_ADDRESS;
  const key = parseEnv(KIT_ENV).TCTC_AGENT_PRIVATE_KEY;
  if (!key) {
    throw new Error(
      "Kit has no account yet. In demo/ica2026/kit run: node ../../../dist/index.js agent init --name Kit",
    );
  }
  return privateKeyToAccount(asKey(key, "Kit's key")).address;
}

// ─── chain ──────────────────────────────────────────────────────────────────

const url = rpcUrl();
const chainId = await createPublicClient({ transport: http(url) }).getChainId();
const chain = defineChain({
  id: chainId,
  name: chainId === SEPOLIA ? "Sepolia" : `chain ${chainId}`,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [url] } },
});
const pub = createPublicClient({ chain, transport: http(url) });
const signer = (key) => createWalletClient({ account: privateKeyToAccount(key), chain, transport: http(url) });
const txUrl = (hash) => (chainId === SEPOLIA ? `https://sepolia.etherscan.io/tx/${hash}` : hash);

const artifacts = new Map();
function art(name) {
  if (!artifacts.has(name)) {
    artifacts.set(name, JSON.parse(readFileSync(join(HERE, "artifacts", `${name}.json`), "utf8")));
  }
  return artifacts.get(name);
}

async function confirmed(hash, label) {
  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${label}: the transaction reverted (${txUrl(hash)})`);
  console.log(`  done  ${label}\n        ${txUrl(hash)}`);
  return receipt;
}

async function deploy(wallet, contract, args, label) {
  const { abi, bytecode } = art(contract);
  const hash = await wallet.deployContract({ abi, bytecode, args });
  const receipt = await confirmed(hash, `deploy ${label}`);
  return receipt.contractAddress;
}

async function write(wallet, address, contract, functionName, args, label) {
  const hash = await wallet.writeContract({ address, abi: art(contract).abi, functionName, args });
  await confirmed(hash, label);
}

const read = (address, contract, functionName, args = []) =>
  pub.readContract({ address, abi: art(contract).abi, functionName, args });

// ─── deployment record: public addresses only ───────────────────────────────

const deploymentPath = join(HERE, `deployment.${chainId === SEPOLIA ? "sepolia" : chainId}.json`);

function loadDeployment() {
  if (!existsSync(deploymentPath)) return { chainId, parties: {}, collections: {}, doors: {} };
  return JSON.parse(readFileSync(deploymentPath, "utf8"));
}

function saveDeployment(d) {
  writeFileSync(deploymentPath, `${JSON.stringify(d, null, 2)}\n`);
  if (chainId !== SEPOLIA) return;
  // the dashboard reads the same addresses for ?story=ica2026&live
  writeFileSync(
    DASHBOARD_MODULE,
    [
      "// Written by demo/ica2026/demo.mjs — do not edit by hand.",
      "// The Sepolia deployment the live story reads (?story=ica2026&live): public addresses only.",
      'import type { StoryDeployment } from "./story";',
      "",
      `export const ICA2026_SEPOLIA: StoryDeployment = ${JSON.stringify(d, null, 2)};`,
      "",
    ].join("\n"),
  );
}

function requireDeployment() {
  const d = loadDeployment();
  const missing = [
    ...["mika", "acme", "kit"].filter((k) => !d.parties[k]).map((k) => `party ${k}`),
    ...["staff", "mine", "ops"].filter((k) => !d.collections[k]).map((k) => `collection ${k}`),
    ...DOORS.filter(([k]) => !d.doors[k]).map(([k]) => `application ${k}`),
  ];
  if (missing.length) throw new Error(`Not deployed on this chain yet (${missing.join(", ")}). Run: setup`);
  return d;
}

// ─── who signs ──────────────────────────────────────────────────────────────

const acme = () =>
  signer(asKey(env.ICA2026_ACME_PRIVATE_KEY ?? env.WALLET_PRIVATE_KEY, "Acme's key (ICA2026_ACME_PRIVATE_KEY or WALLET_PRIVATE_KEY)"));

const mika = () => signer(asKey(env.ICA2026_MIKA_PRIVATE_KEY, "Mika's key (ICA2026_MIKA_PRIVATE_KEY; setup creates it)"));

function createMikaIfMissing() {
  if (env.ICA2026_MIKA_PRIVATE_KEY) return;
  const key = generatePrivateKey();
  appendFileSync(
    LOCAL_ENV,
    [
      `# Mika, the person in the ICA 2026 demo (created ${new Date().toISOString()}).`,
      "# She owns the delegation collection: this key is what can grant to and revoke from her agent.",
      `ICA2026_MIKA_PRIVATE_KEY=${key}`,
      "",
    ].join("\n"),
    { mode: 0o600 },
  );
  chmodSync(LOCAL_ENV, 0o600);
  env.ICA2026_MIKA_PRIVATE_KEY = key;
  console.log("  done  created Mika's account (key in demo/ica2026/.env.local)");
}

function sameAccounts(d, parties) {
  for (const [who, address] of Object.entries(parties)) {
    const recorded = d.parties[who];
    if (recorded && recorded.toLowerCase() !== address.toLowerCase()) {
      throw new Error(
        `${deploymentPath} was made with a different account for ${who} (${recorded}), not ${address}. ` +
          "Use the original key, or move that file aside to deploy afresh.",
      );
    }
  }
}

// ─── commands ───────────────────────────────────────────────────────────────

async function setup() {
  const d = loadDeployment();
  createMikaIfMissing();
  const acmeW = acme();
  const mikaW = mika();
  const parties = { mika: mikaW.account.address, acme: acmeW.account.address, kit: kitAddress() };
  sameAccounts(d, parties);
  d.parties = parties;
  saveDeployment(d);

  if ((await pub.getBalance({ address: parties.mika })) < MIKA_FUNDS / 2n) {
    const hash = await acmeW.sendTransaction({ to: parties.mika, value: MIKA_FUNDS });
    await confirmed(hash, `Acme sends Mika ${formatEther(MIKA_FUNDS)} ETH for gas`);
  }

  const once = async (group, key, make) => {
    if (d[group][key]) return d[group][key];
    d[group][key] = await make();
    saveDeployment(d);
    return d[group][key];
  };

  // the employer's credential, and Mika's Employee ID (her delegation collection requires it)
  const staff = await once("collections", "staff", () =>
    deploy(acmeW, "AgentControlTokens", ["Acme Staff Credentials"], "Acme Staff Credentials (issuer: Acme)"),
  );
  if ((await read(staff, "AgentControlTokens", "balanceOf", [parties.mika, TYPE_ID])) === 0n) {
    await write(acmeW, staff, "AgentControlTokens", "mint", [parties.mika, TYPE_ID, 1n], "Acme issues Mika her Employee ID");
  }

  // Mika's own collection: only an Employee ID holder can mint from it
  const mine = await once("collections", "mine", () =>
    deploy(mikaW, "DelegationTokens", ["Mika's Delegations", staff, TYPE_ID], "Mika's Delegations (issuer: Mika)"),
  );
  const ops = await once("collections", "ops", () =>
    deploy(acmeW, "ExpiringControlTokens", ["Acme Production Passes"], "Acme Production Passes (issuer: Acme, timed)"),
  );

  // the applications: each declares which token opens it, and nothing else
  const agentBinding = { role: AGENT_ROLE, controlToken: mine, typeId: TYPE_ID };
  await once("doors", "files", () => deploy(mikaW, "AppTarget", ["Project files", [agentBinding]], "Project files (MCP server)"));
  await once("doors", "memory", () => deploy(mikaW, "AppTarget", ["Agent memory", [agentBinding]], "Agent memory (MCP server)"));
  await once("doors", "summary", () =>
    deploy(
      acmeW,
      "AppTarget",
      ["Summary API", [agentBinding, { role: MEMBER_ROLE, controlToken: staff, typeId: TYPE_ID }]],
      "Summary API (web API)",
    ),
  );
  await once("doors", "registry", () => deploy(acmeW, "ReleaseRegistry", [mine, TYPE_ID], "Release registry (contract)"));
  await once("doors", "deploy", () =>
    deploy(
      acmeW,
      "AppTarget",
      ["Deploy pipeline", [{ role: OPERATOR_ROLE, controlToken: ops, typeId: TYPE_ID }]],
      "Deploy pipeline (web API)",
    ),
  );
  // the delegation collection is itself a target: ISSUER_ROLE is bound to the Employee ID
  d.doors.delegations = mine;
  saveDeployment(d);

  console.log(`\nDeployment recorded in ${deploymentPath}\n`);
  await status();
}

function ago(seconds) {
  const s = Math.abs(Math.round(seconds));
  return s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m` : s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
}

async function status() {
  const d = requireDeployment();
  const { mika: mikaA, kit } = d.parties;
  const { staff, mine, ops } = d.collections;
  const block = await pub.getBlock();
  const [balance, employee, release, pass, expiresAt] = await Promise.all([
    pub.getBalance({ address: mikaA }),
    read(staff, "AgentControlTokens", "balanceOf", [mikaA, TYPE_ID]),
    read(mine, "DelegationTokens", "balanceOf", [kit, TYPE_ID]),
    read(ops, "ExpiringControlTokens", "balanceOf", [kit, TYPE_ID]),
    read(ops, "ExpiringControlTokens", "expiresAt", [kit, TYPE_ID]),
  ]);
  const left = Number(expiresAt) - Number(block.timestamp);
  const opens = await Promise.all(
    DOORS.map(([key, , r]) => read(d.doors[key], "AppTarget", "hasRole", [r, kit])),
  );
  console.log(`${chain.name}, block ${block.number}`);
  console.log(`  Mika ${mikaA}  ${formatEther(balance)} ETH`);
  console.log(`    Employee ID (Acme Staff Credentials #1): ${employee > 0n ? "held" : "NOT held"}`);
  console.log(`  Kit  ${kit}`);
  console.log(`    Release assistant (Mika's Delegations #1): ${release > 0n ? "held" : "not held"}`);
  console.log(
    `    Production access (Acme Production Passes #1): ${
      pass > 0n ? `held, expires in ${ago(left)}` : expiresAt > 0n ? `expired ${ago(left)} ago` : "not held"
    }`,
  );
  console.log("  Applications that admit Kit:");
  DOORS.forEach(([, label], i) => console.log(`    ${opens[i] ? "open  " : "closed"}  ${label}`));
}

async function reset() {
  const d = requireDeployment();
  const { kit } = d.parties;
  const { mine, ops } = d.collections;
  let changed = false;
  if ((await read(mine, "DelegationTokens", "balanceOf", [kit, TYPE_ID])) > 0n) {
    await write(mika(), mine, "DelegationTokens", "burnByIssuer", [kit, TYPE_ID, 1n], "Mika burns Kit's Release assistant");
    changed = true;
  }
  // an expired pass still exists until it is burned: clear it so the card disappears
  if ((await read(ops, "ExpiringControlTokens", "expiresAt", [kit, TYPE_ID])) > 0n) {
    await write(acme(), ops, "ExpiringControlTokens", "burnByIssuer", [kit, TYPE_ID], "Acme burns Kit's Production access");
    changed = true;
  }
  if (!changed) console.log("  Kit already holds nothing.");
}

async function grant() {
  const d = requireDeployment();
  const { kit } = d.parties;
  if ((await read(d.collections.mine, "DelegationTokens", "balanceOf", [kit, TYPE_ID])) > 0n) {
    console.log("  Kit already holds Release assistant.");
    return;
  }
  await write(mika(), d.collections.mine, "DelegationTokens", "mint", [kit, TYPE_ID, 1n], "Mika mints Release assistant to Kit");
}

/** Grant the timed pass, or move its expiry: the contract treats both as the same call. */
async function pass(seconds, label) {
  const d = requireDeployment();
  const block = await pub.getBlock();
  const now = Math.max(Number(block.timestamp), Math.floor(Date.now() / 1000));
  await write(
    acme(),
    d.collections.ops,
    "ExpiringControlTokens",
    "mint",
    [d.parties.kit, TYPE_ID, BigInt(now + seconds)],
    `${label} (expires in ${ago(seconds)})`,
  );
}

async function burn() {
  const d = requireDeployment();
  const { kit } = d.parties;
  if ((await read(d.collections.mine, "DelegationTokens", "balanceOf", [kit, TYPE_ID])) === 0n) {
    console.log("  Kit does not hold Release assistant.");
    return;
  }
  await write(mika(), d.collections.mine, "DelegationTokens", "burnByIssuer", [kit, TYPE_ID, 1n], "Mika burns Kit's Release assistant");
}

function seconds(value, fallback) {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`"${value}" is not a whole number of seconds`);
  return n;
}

const USAGE = `Usage: node demo/ica2026/demo.mjs <command>
  setup          deploy what is missing, fund Mika, issue her Employee ID
  status         who holds what right now
  reset          scene 1: Kit holds nothing
  grant          scene 2: Mika mints "Release assistant" to Kit
  pass [secs]    scene 3: Acme mints "Production access" to Kit (default 1800)
  expire [secs]  scene 4: Acme moves that pass's expiry to secs from now (default 45)
  burn           scene 6: Mika burns "Release assistant"`;

const [command, arg] = process.argv.slice(2);
try {
  if (command === "setup") await setup();
  else if (command === "status") await status();
  else if (command === "reset") await reset();
  else if (command === "grant") await grant();
  else if (command === "pass") await pass(seconds(arg, 1800), "Acme mints Production access to Kit");
  else if (command === "expire") await pass(seconds(arg, 45), "Acme shortens Kit's Production access");
  else if (command === "burn") await burn();
  else {
    console.log(USAGE);
    process.exitCode = command === undefined || command === "--help" ? 0 : 1;
  }
} catch (e) {
  // viem errors carry the request, which includes the RPC URL: print the first line only
  console.error(`error: ${(e instanceof Error ? e.shortMessage ?? e.message : String(e)).split("\n")[0]}`);
  process.exitCode = 1;
}
