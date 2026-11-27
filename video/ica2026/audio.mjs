#!/usr/bin/env node
/**
 * Build the narration track: every clip at its planned time, on silence.
 *
 *   node video/ica2026/audio.mjs   →  video/out/ica2026/narration.wav (for the final mix)
 *                                     video/out/ica2026/narration-preview.m4a (to listen to)
 *
 * Needs plan.json (plan.mjs) and ffmpeg.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "out", "ica2026");
const plan = JSON.parse(readFileSync(join(OUT, "plan.json"), "utf8"));
const chunks = Object.values(plan.chunks);

// each clip is delayed to its start; amix keeps levels as they are, loudnorm sets the overall loudness
const delayed = chunks.map((c, i) => `[${i}:a]adelay=${Math.round(c.audioAt * 1000)}:all=1[a${i}]`);
const mix =
  `${chunks.map((_, i) => `[a${i}]`).join("")}amix=inputs=${chunks.length}:normalize=0:dropout_transition=0,` +
  `apad=whole_dur=${plan.duration},loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[out]`;

const wav = join(OUT, "narration.wav");
execFileSync(
  "ffmpeg",
  [
    "-hide_banner", "-loglevel", "error", "-y",
    ...chunks.flatMap((c) => ["-i", c.file]),
    "-filter_complex", [...delayed, mix].join(";"),
    "-map", "[out]", "-ac", "2", "-t", String(plan.duration), wav,
  ],
  { stdio: "inherit" },
);
const preview = join(OUT, "narration-preview.m4a");
execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", wav, "-c:a", "aac", "-b:a", "160k", preview], {
  stdio: "inherit",
});
console.log(`wrote ${wav}\nwrote ${preview}`);
