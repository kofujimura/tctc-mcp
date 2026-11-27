#!/usr/bin/env node
/**
 * A contact sheet of a clip: frames at chosen times, side by side, to look at a clip without playing it.
 *
 *   node video/ica2026/sheet.mjs <clip.mp4> <out.png> <t1> <t2> …   (times in seconds; up to three per row)
 */
import { execFileSync } from "node:child_process";

const [clip, out, ...times] = process.argv.slice(2);
if (!clip || !out || times.length === 0) {
  console.error("usage: sheet.mjs <clip.mp4> <out.png> <t1> <t2> …");
  process.exit(1);
}
const W = 640;
const H = 360;
const columns = Math.min(3, times.length);
const layout = times.map((_, i) => `${(i % columns) * W}_${Math.floor(i / columns) * H}`).join("|");
const scaled = times.map((_, i) => `[${i}:v]scale=${W}:${H}[v${i}]`).join(";");
const stack =
  times.length === 1 ? "[v0]copy[out]" : `${times.map((_, i) => `[v${i}]`).join("")}xstack=inputs=${times.length}:layout=${layout}:fill=black[out]`;
execFileSync(
  "ffmpeg",
  [
    "-hide_banner", "-loglevel", "error", "-y",
    ...times.flatMap((t) => ["-ss", t, "-i", clip]),
    "-filter_complex", `${scaled};${stack}`,
    "-map", "[out]", "-frames:v", "1", out,
  ],
  { stdio: "inherit" },
);
console.log(`wrote ${out}`);
