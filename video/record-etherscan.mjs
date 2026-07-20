/**
 * Record the Etherscan view of the revoke (burn) transaction.
 * Uses the last revoke_role tx from video/out/txlog.txt; falls back to
 * the AgentControlTokens address page. Warns if Cloudflare blocks us.
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "out");
const CT = "0x12342A7F0190B3AF3F4b47546D34006EDA54eE0B";

let url = `https://sepolia.etherscan.io/address/${CT}`;
try {
  const log = readFileSync(join(out, "txlog.txt"), "utf8").trim().split("\n");
  const lastRevoke = log.reverse().find((l) => l.startsWith("revoke_role"));
  if (lastRevoke) url = `https://sepolia.etherscan.io/tx/${lastRevoke.split(" ")[1]}`;
} catch {
  /* no txlog yet — use the address page */
}

async function record(headless) {
  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    recordVideo: { dir: out, size: { width: 1280, height: 720 } },
  });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(4000);
  const title = await page.title();
  const blocked = /just a moment|attention required/i.test(title);
  if (!blocked) {
    for (let i = 0; i < 5; i++) {
      await page.mouse.wheel(0, 120);
      await page.waitForTimeout(900);
    }
    await page.waitForTimeout(1500);
  }
  const video = page.video();
  await context.close(); // finalizes the recording
  if (!blocked) await video.saveAs(join(out, "04-etherscan.webm"));
  await browser.close();
  return blocked ? null : true;
}

console.log("recording", url);
if (!(await record(true))) {
  console.log("headless blocked by challenge — retrying headed");
  if (!(await record(false))) {
    console.error("Etherscan blocked in both modes; capture this scene manually");
    process.exit(2);
  }
}
console.log("rendered 04-etherscan.webm");
