#!/usr/bin/env node
/**
 * Record the dashboard clips of the concept video, live on Sepolia.
 *
 *   node video/ica2026/record.mjs            every clip, in story order (resets the chain state first and last)
 *   node video/ica2026/record.mjs grant …    only these clips; the chain must already be in the state they start from
 *
 * Clips: dashboard, grant, pass, expiry, burn (live, ?story=ica2026&live) and
 * issuers (?story=ica2026-wide, sample data). Each is written to
 * video/out/ica2026/clips/<name>.mp4 with <name>.events.json beside it:
 * where the beat starts in the raw recording (cutIn) and which stretches
 * are waits for Sepolia that the composer speeds up.
 *
 * Grant and Revoke are real clicks. The page gets a stub window.ethereum
 * that answers as Mika's wallet; the signing happens here in Node with
 * ICA2026_MIKA_PRIVATE_KEY (demo/ica2026/.env.local), so the key never
 * enters the page. The employer's pass is issued by demo/ica2026/demo.mjs.
 *
 * A fake cursor and a camera (a CSS transform on #root) are injected for
 * the recording only. Needs the dashboard dev server on localhost:5173.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { OUT, beatCues, loadPlan } from "./cues.mjs";
import { openStage, sleep, startRecording } from "./recorder.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const DEMO = join(ROOT, "demo", "ica2026");
const CLIPS = join(OUT, "clips");
const RPC = "https://ethereum-sepolia-rpc.publicnode.com";
const DASHBOARD = "http://localhost:5173/";
/** Where the camera rests between moves: the You band's lower half and Kit's card. */
const HOME = [1, 640, 470];
/** The story scene each live clip starts from (1-based, as in ?scene=). */
const START_SCENE = { dashboard: 1, grant: 1, pass: 2, expiry: 3, burn: 4 };
const ORDER = ["dashboard", "grant", "pass", "expiry", "burn", "issuers"];

mkdirSync(CLIPS, { recursive: true });
const plan = loadPlan();
const deployment = JSON.parse(readFileSync(join(DEMO, "deployment.sepolia.json"), "utf8"));
const abi = (name) => JSON.parse(readFileSync(join(DEMO, "artifacts", `${name}.json`), "utf8")).abi;
const chain = createPublicClient({ chain: sepolia, transport: http(RPC) });

function mikaKey() {
  const file = join(DEMO, ".env.local");
  const key = existsSync(file) && readFileSync(file, "utf8").match(/^ICA2026_MIKA_PRIVATE_KEY=(\S+)/m)?.[1];
  if (!key) throw new Error("ICA2026_MIKA_PRIVATE_KEY is not in demo/ica2026/.env.local (run demo.mjs setup)");
  return key;
}
const mika = createWalletClient({ account: privateKeyToAccount(mikaKey()), chain: sepolia, transport: http(RPC) });

/** Run one demo.mjs command (the employer's side, or a reset) and wait for it. */
function demo(...args) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [join(DEMO, "demo.mjs"), ...args], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(`demo.mjs ${args.join(" ")} failed: ${out.trim()}`))));
  });
}

const kitHolds = async () => ({
  release: await chain.readContract({ address: deployment.collections.mine, abi: abi("DelegationTokens"), functionName: "balanceOf", args: [deployment.parties.kit, 1n] }),
  passExpiry: Number(await chain.readContract({ address: deployment.collections.ops, abi: abi("ExpiringControlTokens"), functionName: "expiresAt", args: [deployment.parties.kit, 1n] })),
});

// ─── the page: wallet stub, cursor, camera ──────────────────────────────────

/** Answer the page's wallet requests as Mika. Only eth_sendTransaction signs anything. */
async function wallet(method, params) {
  try {
    if (method === "eth_requestAccounts" || method === "eth_accounts") return { value: [mika.account.address] };
    if (method === "wallet_requestPermissions") return { value: [{ parentCapability: "eth_accounts" }] };
    if (method === "eth_chainId") return { value: `0x${sepolia.id.toString(16)}` };
    if (method === "net_version") return { value: String(sepolia.id) };
    if (method === "wallet_switchEthereumChain" || method === "wallet_addEthereumChain") return { value: null };
    if (method === "eth_sendTransaction") {
      const [tx] = params;
      const hash = await mika.sendTransaction({ to: tx.to, data: tx.data, value: tx.value ? BigInt(tx.value) : 0n });
      console.log(`    wallet: sent ${hash}`);
      return { value: hash };
    }
    const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
    const j = await r.json();
    return j.error ? { error: j.error } : { value: j.result };
  } catch (e) {
    return { error: { code: -32000, message: e.shortMessage ?? e.message } };
  }
}

const PAGE_SETUP = `
  window.ethereum = {
    async request({ method, params }) {
      const r = await window.__wallet(method, params ?? []);
      if (r.error) throw Object.assign(new Error(r.error.message), { code: r.error.code });
      return r.value;
    },
    on() {},
    removeListener() {},
  };
  window.__camState = { s: 1, x: 0, y: 0 };
  // point the camera at document point (cx, cy), magnified s times
  window.__cam = (s, cx, cy, ms) => {
    const root = document.getElementById("root");
    const x = 640 - s * cx, y = 360 - s * cy;
    root.style.transition = "transform " + ms + "ms cubic-bezier(0.45, 0, 0.2, 1)";
    root.style.transform = "translate(" + x + "px, " + y + "px) scale(" + s + ")";
    window.__camState = { s, x, y };
  };
  // an element's box in document coordinates, whatever the camera is doing
  window.__box = (selector, nth) => {
    const el = document.querySelectorAll(selector)[nth ?? 0];
    if (!el) return null;
    const r = el.getBoundingClientRect(), c = window.__camState;
    return { x: (r.left - c.x) / c.s, y: (r.top - c.y) / c.s, w: r.width / c.s, h: r.height / c.s };
  };
  window.addEventListener("DOMContentLoaded", () => {
    const style = document.createElement("style");
    style.textContent =
      "html, body { overflow: hidden !important; } #root { transform-origin: 0 0; }" +
      "#root .tx-log { visibility: hidden; }" +
      "#__toast { position: fixed; top: 22px; left: 50%; transform: translateX(-50%); z-index: 50; display: grid; gap: 6px; width: max-content; max-width: 760px; font-size: 15px; }" +
      "#__toast { transition: opacity 0.6s; } #__toast .tx { font-size: 15px; padding: 10px 16px; }" +
      "#__cursor { transition: opacity 0.3s; } #__cursor.parked { opacity: 0; }" +
      "#__cursor { position: fixed; left: 0; top: 0; z-index: 99; pointer-events: none; transform: translate(-100px, -100px); }" +
      "#__cursor i { position: absolute; left: -16px; top: -16px; width: 32px; height: 32px; border-radius: 50%; background: rgba(79, 143, 247, 0.6); opacity: 0; }" +
      "@keyframes __ripple { from { transform: scale(0.3); opacity: 0.9; } to { transform: scale(1.7); opacity: 0; } }";
    document.head.append(style);
    const cursor = document.createElement("div");
    cursor.id = "__cursor";
    cursor.innerHTML = '<i></i><svg width="26" height="26" viewBox="0 0 24 24"><path d="M5 3l13 9.5-6 1.2 3.4 6.6-2.6 1.3-3.4-6.6L5 19z" fill="#fff" stroke="#0b0e14" stroke-width="1.4" stroke-linejoin="round"/></svg>';
    const toast = document.createElement("div");
    toast.id = "__toast";
    document.body.append(toast, cursor);
    document.addEventListener("mousemove", (e) => (cursor.style.transform = "translate(" + e.clientX + "px, " + e.clientY + "px)"), true);
    document.addEventListener("mousedown", () => {
      const ring = cursor.querySelector("i");
      ring.style.animation = "none";
      void ring.offsetWidth; // restart the ripple
      ring.style.animation = "__ripple 0.45s ease-out";
    }, true);
    // the page's transaction log is fixed to the viewport, which a transformed #root breaks: mirror it outside
    new MutationObserver(() => {
      const log = document.querySelector("#root .tx-log");
      const html = log ? log.innerHTML : "";
      if (toast.innerHTML === html) return;
      toast.innerHTML = html;
      toast.style.opacity = 1;
      clearTimeout(window.__toastTimer);
      // a confirmed or failed entry leaves after a few seconds; a pending one stays
      if (!html.includes("tx-pending")) window.__toastTimer = setTimeout(() => (toast.style.opacity = 0), 5000);
    }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  });
`;

const cam = (page, s, cx, cy, ms = 1100) => page.evaluate(([a, b, c, d]) => window.__cam(a, b, c, d), [s, cx, cy, ms]);
async function focus(page, selector, s, { nth = 0, dx = 0, dy = 0, ms = 1100 } = {}) {
  const box = await page.evaluate(([sel, n]) => window.__box(sel, n), [selector, nth]);
  if (!box) throw new Error(`nothing matches ${selector}`);
  await cam(page, s, box.x + box.w / 2 + dx, box.y + box.h / 2 + dy, ms);
}
async function park(page) {
  await page.mouse.move(1278, 716, { steps: 14 });
  await page.evaluate(() => document.getElementById("__cursor").classList.add("parked"));
}
async function moveTo(page, selector, nth = 0) {
  await page.evaluate(() => document.getElementById("__cursor").classList.remove("parked"));
  const box = await page.locator(selector).nth(nth).boundingBox();
  if (!box) throw new Error(`nothing matches ${selector}`);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 30 });
}
async function click(page, selector, nth = 0) {
  await moveTo(page, selector, nth);
  await sleep(0.3);
  await page.mouse.down();
  await sleep(0.08);
  await page.mouse.up();
}

async function openDashboard(page, scene) {
  await page.goto(`${DASHBOARD}?story=ica2026&live&theme=dark&ghost=60&scene=${scene}`);
  await page.waitForSelector(".zone-you .permit", { timeout: 60000 });
  await page.keyboard.press("h"); // the caption bar: the video has its own subtitles
  await page.getByRole("button", { name: "Connect wallet" }).first().click();
  await page.waitForFunction(() => /0x[0-9a-fA-F]{4}…/.test(document.querySelector(".header-controls")?.textContent ?? ""));
  await park(page);
  await sleep(1);
}

/**
 * Edit time: seconds on the beat's own timeline. It equals raw recording
 * time until something is cut or sped up; mark() says "this instant is t".
 */
function editClock(recording) {
  let skew = 0;
  const raw = () => recording.seconds();
  return {
    raw,
    mark: (t) => (skew = raw() - t),
    cutIn: () => skew,
    async until(t) {
      const wait = t - (raw() - skew);
      if (wait > 0) await sleep(wait);
    },
  };
}

/** Wait for `ready`, and record the wait so the composer can fit it into [editStart, editEnd]. */
async function awaited(clock, waits, name, editStart, editEnd, ready) {
  const rawStart = clock.raw();
  await ready();
  const rawEnd = clock.raw();
  if (rawEnd - rawStart > editEnd - editStart) {
    waits.push({ name, rawStart, rawEnd, editStart, editEnd });
    clock.mark(editEnd);
  }
  console.log(`    ${name}: waited ${(rawEnd - rawStart).toFixed(1)} s, shown in ${(editEnd - editStart).toFixed(1)} s`);
}

async function record(page, name, direct) {
  const { cues, duration } = beatCues(plan, name);
  const recording = await startRecording(page, join(CLIPS, `${name}.mp4`));
  const clock = editClock(recording);
  const waits = [];
  await direct({ cues, duration, clock, waits });
  await clock.until(duration + 0.6);
  const { seconds } = await recording.stop();
  const events = { clip: name, duration, cutIn: clock.cutIn0 ?? 0, waits, raw: seconds };
  writeFileSync(join(CLIPS, `${name}.events.json`), `${JSON.stringify(events, null, 2)}\n`);
  console.log(`  ${name}.mp4  raw ${seconds.toFixed(1)} s, beat ${duration.toFixed(1)} s, cut in at ${events.cutIn.toFixed(1)} s, ${waits.length} wait(s)`);
}

// ─── the clips ──────────────────────────────────────────────────────────────

const clips = {
  /** Beat 4: this is the dashboard; Mika's own token; how to read a card; Kit holds nothing. */
  async dashboard(page) {
    await cam(page, 1, 640, 360, 0);
    await sleep(0.5);
    await record(page, "dashboard", async ({ cues, duration, clock }) => {
      await clock.until(cues["4b"] - 0.4);
      await focus(page, ".zone-you", 1.3, { ms: 1400 });
      await clock.until(cues["4d"] - 0.3);
      await focus(page, ".zone-you .permit", 2.0, { ms: 1300 });
      await clock.until(cues["4c"] - 0.4);
      await focus(page, ".holder-agent", 1.08, { ms: 1400 });
      await clock.until(duration - 1.3);
      await cam(page, ...HOME, 1100);
    });
  },

  /** Beat 5: Mika grants once; four applications open. */
  async grant(page) {
    await cam(page, ...HOME, 0);
    await sleep(0.5);
    await record(page, "grant", async ({ cues, duration, clock, waits }) => {
      await clock.until(cues["5a.2"] - 1.8);
      await click(page, ".permit-add");
      await clock.until(cues.grantWait - 1.0);
      await click(page, ".grant-form .btn.grant");
      await clock.until(cues.grantWait);
      await awaited(clock, waits, "grantWait", cues.grantWait, cues.grantWait + 4.0, () =>
        page.waitForSelector(".holder-agent .permit-live", { timeout: 180000 }),
      );
      await page.keyboard.press("ArrowRight"); // scene 2: Kit starts working through the applications
      await park(page);
      await clock.until(cues["5b.1"] - 0.3);
      await focus(page, ".holder-agent .permit-live", 1.85, { ms: 1300 });
      await clock.until(cues["5c"] - 0.2);
      await focus(page, ".holder-agent", 1.08, { ms: 1500 });
      await clock.until(duration - 1.3);
      await cam(page, ...HOME, 1100);
    });
  },

  /** Beat 6: the employer adds a timed pass. The card arrives as the narration says so. */
  async pass(page) {
    await cam(page, ...HOME, 0);
    await sleep(0.5);
    await record(page, "pass", async ({ cues, duration, clock }) => {
      const appearsAt = cues["6a.2"] + 0.5;
      await sleep(Math.max(0, appearsAt - 6)); // the transaction takes at least a block: keep enough picture before it
      const issued = demo("pass", "1800");
      await page.waitForFunction(() => document.querySelectorAll(".holder-agent .permit-live").length >= 2, null, { timeout: 180000 });
      clock.mark(appearsAt);
      clock.cutIn0 = clock.cutIn();
      await page.keyboard.press("ArrowRight"); // scene 3
      await issued;
      await clock.until(cues["6b"] - 0.3);
      await focus(page, ".holder-agent .permit-live", 1.5, { nth: 1, dx: -150, ms: 1400 });
      await clock.until(duration - 1.3);
      await cam(page, ...HOME, 1100);
    });
  },

  /** Beat 7: the pass runs out on its own. The clip is cut so the countdown reaches zero mid-sentence. */
  async expiry(page) {
    console.log("    shortening the pass to 80 s…");
    await demo("expire", "80");
    const { passExpiry } = await kitHolds();
    const { cues, duration } = beatCues(plan, "expiry");
    const zeroAt = cues["6c.1"] + 0.2;
    const flipBy = Math.max(cues["6c.2"] - 0.3, zeroAt + 1.0);
    await focus(page, ".holder-agent .permit-live", 1.7, { nth: 1, ms: 0 });
    // start recording four seconds before the beat begins
    const startIn = passExpiry - Date.now() / 1000 - zeroAt - 4;
    if (startIn < 0) throw new Error(`the pass expires too soon to record (${startIn.toFixed(1)} s short); run the clip again`);
    await sleep(startIn);
    await record(page, "expiry", async ({ clock, waits }) => {
      clock.mark(-(passExpiry - Date.now() / 1000 - zeroAt));
      clock.cutIn0 = clock.cutIn();
      await clock.until(0);
      await page.keyboard.press("ArrowRight"); // scene 4
      await clock.until(zeroAt + 0.6);
      await awaited(clock, waits, "lapse", zeroAt + 0.6, flipBy, () => page.waitForSelector(".permit-lapsed", { timeout: 120000 }));
      await sleep(2.2);
      await focus(page, ".holder-agent", 1.08, { ms: 1400 });
      await clock.until(duration - 1.3);
      await cam(page, ...HOME, 1100);
    });
  },

  /** Beat 8: Kit drifts; Mika burns her token; every application closes. */
  async burn(page) {
    await cam(page, ...HOME, 0);
    await sleep(0.5);
    await record(page, "burn", async ({ cues, duration, clock, waits }) => {
      await clock.until(cues["7a"] - 0.3);
      await page.keyboard.press("ArrowRight"); // scene 5: off task
      await focus(page, ".holder-agent .activity", 1.7, { dx: -120, ms: 1300 });
      await clock.until(cues["7b"] - 0.2);
      await focus(page, ".holder-agent", 1.08, { ms: 1300 });
      await clock.until(cues["7b.2"] - 0.4);
      await moveTo(page, ".holder-agent .permit-live .btn.revoke");
      await clock.until(cues.burnWait - 0.5);
      await click(page, ".holder-agent .permit-live .btn.revoke");
      await clock.until(cues.burnWait);
      await awaited(clock, waits, "burnWait", cues.burnWait, cues.burnWait + 4.0, () =>
        page.waitForSelector(".permit-ghost", { timeout: 180000 }),
      );
      await page.keyboard.press("ArrowRight"); // scene 6: denied at every door
      await park(page);
      await clock.until(cues["7c"] + 0.3);
      await focus(page, ".holder-agent .permit-ghost", 1.75, { ms: 1300 });
      await clock.until(cues["7d"] - 0.2);
      await focus(page, ".holder-agent", 1.08, { ms: 1500 });
      await clock.until(duration - 1.3);
      await cam(page, ...HOME, 1100);
    });
  },

  /** Beat 9: many issuers at once (sample data, and the header says so). */
  async issuers(page) {
    await page.goto(`${DASHBOARD}?story=ica2026-wide&theme=dark&scene=4`);
    await page.waitForSelector(".holder-agent .permit");
    await page.keyboard.press("h");
    await cam(page, 1, 640, 360, 0);
    await sleep(1);
    const height = await page.evaluate(() => document.getElementById("root").scrollHeight);
    await record(page, "issuers", async ({ cues, clock }) => {
      await clock.until(cues["8a.1"]);
      await cam(page, 1, 640, 600, 5500);
      await clock.until(cues["8a.3"]);
      await cam(page, 1, 640, Math.max(600, height - 330), 6500);
      await clock.until(cues["8b"]);
      await cam(page, 0.62, 640, height / 2, 3000);
    });
  },
};

// ─── run ────────────────────────────────────────────────────────────────────

const wanted = process.argv.slice(2);
const all = wanted.length === 0;
const names = all ? ORDER : wanted;
for (const n of names) if (!clips[n]) throw new Error(`no clip "${n}" (clips: ${ORDER.join(", ")})`);

if (all) {
  console.log("resetting the chain state (Kit holds nothing)…");
  await demo("reset");
}
const { browser, context, page } = await openStage();
await context.exposeFunction("__wallet", wallet);
await context.addInitScript(PAGE_SETUP);
let opened = false;
try {
  for (const name of names) {
    console.log(`clip ${name}`);
    if (name !== "issuers" && !opened) {
      await openDashboard(page, START_SCENE[name]);
      opened = true;
    }
    await clips[name](page);
  }
} finally {
  await browser.close();
}
if (all) {
  console.log("resetting the chain state…");
  await demo("reset");
}
