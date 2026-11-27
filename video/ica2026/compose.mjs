#!/usr/bin/env node
/**
 * Put the video together: clips cut to their beats, subtitles, narration.
 *
 *   node video/ica2026/compose.mjs   →  video/out/ica2026/tctc-ica2026-concept.mp4
 *
 * Needs plan.json, narration.wav, and the clips from record-scenes.mjs and
 * record.mjs.
 *
 * 1. Each beat is cut from its clip to exactly its length on the plan. A
 *    dashboard clip starts at its cutIn, and each wait for Sepolia is sped
 *    up to the hold the plan gave it.
 * 2. Subtitles are drawn by the browser as PNGs with alpha and laid over
 *    the picture by time, because this ffmpeg has no libass or drawtext.
 *    A small note marks the stretches that are sped up.
 * 3. The narration track is added and the file is encoded once.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { OUT, loadPlan } from "./cues.mjs";

const FPS = 30;
const CLIPS = join(OUT, "clips");
const BEATS = join(OUT, "beats");
const OVERLAYS = join(OUT, "overlays");
const FINAL = join(OUT, "tctc-ica2026-concept.mp4");
for (const dir of [BEATS, OVERLAYS]) mkdirSync(dir, { recursive: true });

const plan = loadPlan();
const ffmpeg = (args) => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: "inherit" });
const frame = (seconds) => Math.round(seconds * FPS);

// ─── 1. beats ───────────────────────────────────────────────────────────────

function sourceOf(beat) {
  if (beat.picture.startsWith("scene:")) return { clip: join(CLIPS, `scene-${beat.picture.slice(6)}.mp4`), cutIn: 0, waits: [] };
  const name = beat.picture === "dashboard:wide" ? "issuers" : beat.id;
  const events = JSON.parse(readFileSync(join(CLIPS, `${name}.events.json`), "utf8"));
  return { clip: join(CLIPS, `${name}.mp4`), cutIn: events.cutIn, waits: events.waits };
}

const notes = []; // sped-up stretches, on the video's timeline
const beatFiles = [];
plan.beats.forEach((beat, i) => {
  const { clip, cutIn, waits } = sourceOf(beat);
  if (!existsSync(clip)) throw new Error(`missing clip ${clip}`);
  const length = beat.end - beat.start;
  // pieces of the raw clip and how long each lasts on the beat's timeline
  const pieces = [];
  let raw = cutIn;
  let edit = 0;
  for (const w of waits) {
    pieces.push({ from: raw, to: w.rawStart, lasts: w.editStart - edit });
    pieces.push({ from: w.rawStart, to: w.rawEnd, lasts: w.editEnd - w.editStart });
    notes.push({ start: beat.start + w.editStart, end: beat.start + w.editEnd, text: `▸▸ sped up: ${Math.round(w.rawEnd - w.rawStart)} s waiting for Sepolia` });
    raw = w.rawEnd;
    edit = w.editEnd;
  }
  pieces.push({ from: raw, to: raw + (length - edit), lasts: length - edit });

  const cut = pieces
    .filter((p) => p.lasts > 0.01 && p.to - p.from > 0.01)
    .map((p, n) => `[0:v]trim=start=${p.from.toFixed(3)}:end=${p.to.toFixed(3)},setpts=(PTS-STARTPTS)*${(p.lasts / (p.to - p.from)).toFixed(6)},fps=${FPS}[p${n}]`);
  const joined = `${cut.map((_, n) => `[p${n}]`).join("")}concat=n=${cut.length}:v=1:a=0,tpad=stop_mode=clone:stop_duration=2,format=yuv420p[out]`;
  const file = join(BEATS, `${String(i).padStart(2, "0")}-${beat.id}.mp4`);
  ffmpeg([
    "-i", clip, "-filter_complex", [...cut, joined].join(";"), "-map", "[out]",
    "-frames:v", String(frame(beat.end) - frame(beat.start)), "-r", String(FPS),
    "-c:v", "libx264", "-preset", "fast", "-crf", "15", "-an", file,
  ]);
  beatFiles.push(file);
  console.log(`beat ${beat.id.padEnd(10)} ${length.toFixed(2)} s${waits.length ? `  (${waits.length} wait sped up)` : ""}`);
});
const beatList = join(OUT, "beats.txt");
writeFileSync(beatList, beatFiles.map((f) => `file '${f}'\n`).join(""));

// ─── 2. subtitles and notes, as PNG strips with alpha ───────────────────────

const browser = await chromium.launch();

/** Draw each text into a transparent strip and return a concat list that shows them at their times. */
async function strip(name, items, { width, height, css }) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}body{width:${width}px;height:${height}px;display:flex;${css.place}}` +
      `div{font-family:-apple-system,"Helvetica Neue",Arial,sans-serif;${css.box}}</style><div id="t"></div>`,
  );
  const blank = join(OVERLAYS, `${name}-blank.png`);
  await page.evaluate(() => (document.getElementById("t").style.visibility = "hidden"));
  await page.screenshot({ path: blank, omitBackground: true });
  await page.evaluate(() => (document.getElementById("t").style.visibility = "visible"));
  const lines = [];
  let t = 0;
  const show = (file, seconds) => seconds > 0.001 && lines.push(`file '${file}'\nduration ${seconds.toFixed(3)}\n`);
  for (const [n, item] of items.entries()) {
    const file = join(OVERLAYS, `${name}-${String(n).padStart(3, "0")}.png`);
    await page.evaluate((text) => (document.getElementById("t").textContent = text), item.text);
    await page.screenshot({ path: file, omitBackground: true });
    show(blank, item.start - t);
    show(file, item.end - Math.max(item.start, t));
    t = Math.max(t, item.end);
  }
  show(blank, plan.duration - t + 1);
  lines.push(`file '${blank}'\n`); // the concat demuxer needs the last file named once more
  await page.close();
  const list = join(OUT, `${name}.txt`);
  writeFileSync(list, lines.join(""));
  return list;
}

const captionList = await strip("caption", plan.captions, {
  width: 1920,
  height: 190,
  css: {
    place: "align-items:flex-end;justify-content:center",
    box: "max-width:1560px;padding:12px 30px 14px;border-radius:16px;background:rgba(6,9,16,0.80);color:#fff;font-size:41px;font-weight:600;line-height:1.24;text-align:center",
  },
});
const noteList = await strip("note", notes, {
  width: 900,
  height: 70,
  css: {
    place: "align-items:center;justify-content:flex-end",
    box: "padding:8px 18px;border-radius:999px;background:rgba(240,180,41,0.16);border:2px solid rgba(240,180,41,0.75);color:#f0b429;font-size:25px;font-weight:700",
  },
});
await browser.close();

// ─── 3. one encode: picture, overlays, narration ────────────────────────────

ffmpeg([
  "-f", "concat", "-safe", "0", "-i", beatList,
  "-f", "concat", "-safe", "0", "-i", captionList,
  "-f", "concat", "-safe", "0", "-i", noteList,
  "-i", join(OUT, "narration.wav"),
  "-filter_complex",
  `[1:v]fps=${FPS},format=rgba[cap];[2:v]fps=${FPS},format=rgba[note];` +
    "[0:v][cap]overlay=0:H-h-30:format=auto:eof_action=pass[a];" +
    "[a][note]overlay=W-w-40:36:format=auto:eof_action=pass,format=yuv420p[v]",
  "-map", "[v]", "-map", "3:a",
  "-t", String(plan.duration),
  "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-r", String(FPS),
  "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart",
  FINAL,
]);

const seconds = Number(
  execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", FINAL]).toString().trim(),
);
console.log(`\nwrote ${FINAL}\n${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, "0")} (${seconds.toFixed(1)} s), ${plan.captions.length} subtitles, ${notes.length} sped-up stretch(es)`);
