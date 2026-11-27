#!/usr/bin/env node
/**
 * Screenshot every slide, to look at the deck without clicking through it.
 *
 *   node docs/ica2026-talk/shots.mjs [out-dir]   →  slide-01.png … (1280×720 each)
 *
 * Also reports any slide whose content runs past the 16:9 stage.
 */
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";

const HERE = dirname(fileURLToPath(import.meta.url));
const out = process.argv[2] ?? join(HERE, "shots");
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const problems = [];
page.on("pageerror", (e) => problems.push(`page error: ${e.message}`));
await page.goto(pathToFileURL(join(HERE, "index.html")).href);
const count = await page.evaluate(() => document.querySelectorAll(".slide").length);
for (let n = 1; n <= count; n++) {
  await page.goto(`${pathToFileURL(join(HERE, "index.html")).href}#${n}`);
  await page.reload();
  await page.waitForTimeout(250);
  // content that spills past the stage, or an image that did not load
  const spill = await page.evaluate(() => {
    const slide = document.querySelector(".slide.active");
    const bad = [];
    for (const el of slide.querySelectorAll("*")) {
      const r = el.getBoundingClientRect();
      if (r.width && (r.right > 1281 || r.bottom > 721)) bad.push(`${el.tagName.toLowerCase()}.${el.className} → ${Math.round(r.right)}×${Math.round(r.bottom)}`);
    }
    for (const img of slide.querySelectorAll("img")) if (!img.naturalWidth) bad.push(`image not loaded: ${img.getAttribute("src")}`);
    return bad.slice(0, 3);
  });
  if (spill.length) problems.push(`slide ${n}: ${spill.join("; ")}`);
  await page.screenshot({ path: join(out, `slide-${String(n).padStart(2, "0")}.png`) });
}
await browser.close();
console.log(`${count} slides → ${out}`);
for (const p of problems) console.log(`PROBLEM  ${p}`);
