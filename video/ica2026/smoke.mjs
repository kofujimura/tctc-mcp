#!/usr/bin/env node
/**
 * Six seconds of the dashboard's story mode, to check the recorder.
 *
 *   node video/ica2026/smoke.mjs   →  video/out/ica2026/smoke.mp4
 *
 * Needs the dashboard dev server on http://localhost:5173.
 */
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openStage, sleep, startRecording } from "./recorder.mjs";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "out", "ica2026");
mkdirSync(OUT, { recursive: true });

const { browser, page } = await openStage();
await page.goto("http://localhost:5173/?story=ica2026&theme=dark&scene=2");
await sleep(1.5);
const recording = await startRecording(page, join(OUT, "smoke.mp4"));
await sleep(2);
await page.keyboard.press("ArrowRight"); // scene 3: a second card arrives
await sleep(4);
console.log(await recording.stop());
await browser.close();
