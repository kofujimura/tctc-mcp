#!/usr/bin/env node
/**
 * Lay the video out on a timeline, from the narration's measured lengths.
 *
 *   node video/ica2026/plan.mjs   →  video/out/ica2026/plan.json, captions.srt
 *
 * Each beat is a row of items: a narration chunk, a gap (silence between
 * chunks), or a hold (picture with no narration: the title card, the wait
 * for a transaction). Laying them end to end gives every chunk, caption
 * and hold a start time, which the scenes, the recorder and the final mix
 * all read from plan.json.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BEATS } from "./narration.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "out", "ica2026");
const timing = JSON.parse(readFileSync(join(OUT, "timing.json"), "utf8"));

/** Silence between two chunks of the same beat. */
const G = 0.75;
const gap = (seconds) => ({ gap: seconds });
const hold = (name, seconds) => ({ hold: name, seconds });

/** The picture each beat uses, and what happens in it besides the narration. */
const LAYOUT = {
  intro: { picture: "scene:intro", items: [gap(0.7), "0a", gap(1.2), "1a", gap(G), "1b", gap(G), "1c", gap(1.8)] },
  today: { picture: "scene:today", items: [gap(0.8), "2a", gap(G), "2b", gap(G), "2c", gap(2.0)] },
  idea: { picture: "scene:idea", items: [gap(0.8), "3a", gap(G), "3b", gap(G), "3c", gap(G), "3d", gap(2.0)] },
  dashboard: { picture: "dashboard", items: [hold("establish", 2.5), "4a", gap(G), "4b", gap(G), "4d", gap(G), "4c", gap(1.4)] },
  // the wait holds stand for the seconds it takes Sepolia to include a transaction, shown sped up
  grant: { picture: "dashboard", items: [gap(1.0), "5a", hold("grantWait", 4.0), gap(1.2), "5b", gap(G), "5c", gap(G), "5d", gap(2.5)] },
  pass: { picture: "dashboard", items: [gap(0.8), "6a", gap(G), "6b", gap(2.5)] },
  later: { picture: "scene:later", items: [hold("later", 2.8)] },
  expiry: { picture: "dashboard", items: [gap(3.0), "6c", gap(G), "6d", gap(3.0)] },
  burn: { picture: "dashboard", items: [gap(0.8), "7a", gap(G), "7b", hold("burnWait", 4.0), gap(1.2), "7c", gap(G), "7d", gap(G), "7e", gap(3.0)] },
  issuers: { picture: "dashboard:wide", items: [gap(1.5), "8a", gap(G), "8b", gap(G), "8c", gap(2.5)] },
  recap: { picture: "scene:recap", items: [gap(0.8), "9a", gap(G), "9b", gap(0.9), "9c", hold("endcard", 8.0)] },
};

const round = (n) => Math.round(n * 1000) / 1000;
const plan = { beats: [], chunks: {}, captions: [], holds: {} };
let t = 0;

for (const b of BEATS) if (!LAYOUT[b.id]) throw new Error(`no layout for beat "${b.id}"`);

for (const [beatId, layout] of Object.entries(LAYOUT)) {
  // a beat with no narration (the "later" card) is picture only
  const beat = BEATS.find((b) => b.id === beatId) ?? { id: beatId, chunks: [] };
  const ids = new Set(beat.chunks.map((c) => c.id));
  const start = t;
  for (const item of layout.items) {
    if (typeof item !== "string") {
      if (item.hold) plan.holds[item.hold] = { beat: beat.id, start: round(t), end: round(t + item.seconds) };
      t += item.gap ?? item.seconds;
      continue;
    }
    const chunk = beat.chunks.find((c) => c.id === item);
    const audio = timing.chunks[item];
    if (!chunk || !audio) throw new Error(`beat "${beat.id}": chunk "${item}" is not in the narration or has no audio`);
    ids.delete(item);
    const speech = audio.speechEnd - audio.speechStart;
    // the clip is placed so that its first spoken sound lands at `t`
    plan.chunks[item] = { beat: beat.id, file: audio.file, start: round(t), end: round(t + speech), audioAt: round(t - audio.speechStart) };
    // captions share the chunk's span in proportion to their length
    const total = chunk.captions.reduce((sum, c) => sum + c.length, 0);
    let at = t;
    for (const text of chunk.captions) {
      const length = (speech * text.length) / total;
      plan.captions.push({ chunk: item, text, start: round(at), end: round(at + length) });
      at += length;
    }
    t += speech;
  }
  if (ids.size) throw new Error(`beat "${beat.id}": chunks not placed: ${[...ids].join(", ")}`);
  plan.beats.push({ id: beat.id, picture: layout.picture, start: round(start), end: round(t) });
}
plan.duration = round(t);

const stamp = (s) => {
  const ms = Math.round(s * 1000);
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
};
const srt = plan.captions.map((c, i) => `${i + 1}\n${stamp(c.start)} --> ${stamp(c.end)}\n${c.text}\n`).join("\n");

writeFileSync(join(OUT, "plan.json"), `${JSON.stringify(plan, null, 2)}\n`);
writeFileSync(join(OUT, "captions.srt"), srt);

const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
for (const b of plan.beats) console.log(`${mmss(b.start).padStart(5)}–${mmss(b.end)}  ${b.id.padEnd(10)} ${b.picture}`);
console.log(`\ntotal ${mmss(plan.duration)} (${plan.duration} s), ${plan.captions.length} captions, ${Object.keys(plan.chunks).length} chunks`);
