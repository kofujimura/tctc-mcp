/**
 * Cue times for one beat, read from plan.json: seconds from the beat's
 * start to each narration chunk ("1b"), to each of its caption lines
 * ("1b.0", "1b.1", …) and to each hold ("grantWait"). The scenes and the
 * dashboard clips are both timed from these.
 *
 *   node video/ica2026/cues.mjs   checks that every cue scenes.html uses exists
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const OUT = join(HERE, "..", "out", "ica2026");
export const SCENES_URL = pathToFileURL(join(HERE, "scenes.html")).href;

export function loadPlan() {
  return JSON.parse(readFileSync(join(OUT, "plan.json"), "utf8"));
}

export function beatCues(plan, beatId) {
  const beat = plan.beats.find((b) => b.id === beatId);
  if (!beat) throw new Error(`no beat "${beatId}" in the plan`);
  const cues = {};
  const round = (n) => Math.round((n - beat.start) * 1000) / 1000;
  for (const [id, chunk] of Object.entries(plan.chunks)) if (chunk.beat === beatId) cues[id] = round(chunk.start);
  const seen = {};
  for (const caption of plan.captions) {
    if (plan.chunks[caption.chunk].beat !== beatId) continue;
    const index = (seen[caption.chunk] = (seen[caption.chunk] ?? -1) + 1);
    cues[`${caption.chunk}.${index}`] = round(caption.start);
  }
  for (const [name, hold] of Object.entries(plan.holds)) if (hold.beat === beatId) cues[name] = round(hold.start);
  return { cues, duration: Math.round((beat.end - beat.start) * 1000) / 1000 };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { chromium } = await import("playwright");
  const plan = loadPlan();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const problems = [];
  page.on("pageerror", (e) => problems.push(`page error: ${e.message}`));
  for (const scene of ["intro", "today", "idea", "later", "recap"]) {
    await page.goto(`${SCENES_URL}?scene=${scene}`);
    const { cues, duration } = beatCues(plan, scene);
    const used = await page.evaluate(() => window.cueNames());
    const missing = used.filter((name) => cues[name] === undefined);
    await page.evaluate(([c, t]) => window.seek(c, t), [cues, duration]);
    // after the last cue, how many cued elements are showing and how many spill past the frame
    const state = await page.evaluate(() => {
      const els = [...document.querySelectorAll("section.active [data-cue]")];
      const visible = els.filter((el) => el.classList.contains("on") && !el.classList.contains("off"));
      const spill = visible.filter((el) => {
        const r = el.getBoundingClientRect();
        return r.right > 1281 || r.bottom > 721 || r.left < -1 || r.top < -1;
      });
      return { cued: els.length, visible: visible.length, spill: spill.length };
    });
    console.log(
      `${scene.padEnd(6)} ${duration.toFixed(1).padStart(5)} s  cues used ${used.length}, missing ${missing.length ? missing.join(",") : "none"};` +
        ` at the end ${state.visible}/${state.cued} cued elements showing, ${state.spill} outside the frame`,
    );
    if (missing.length) problems.push(`${scene}: missing cues ${missing.join(", ")}`);
  }
  await browser.close();
  for (const p of problems) console.log(`PROBLEM  ${p}`);
  process.exitCode = problems.length ? 1 : 0;
}
