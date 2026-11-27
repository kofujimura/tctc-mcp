#!/usr/bin/env node
/**
 * Record the animated scenes, each for the length of its beat.
 *
 *   node video/ica2026/record-scenes.mjs [scene …]   →  video/out/ica2026/clips/scene-<id>.mp4
 *
 * With no arguments, records all five. Recording is in real time.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { OUT, SCENES_URL, beatCues, loadPlan } from "./cues.mjs";
import { openStage, sleep, startRecording } from "./recorder.mjs";

const CLIPS = join(OUT, "clips");
mkdirSync(CLIPS, { recursive: true });
const plan = loadPlan();
const wanted = process.argv.slice(2);
const scenes = wanted.length ? wanted : ["intro", "today", "idea", "later", "recap"];

const { browser, page } = await openStage();
for (const scene of scenes) {
  const { cues, duration } = beatCues(plan, scene);
  await page.goto(`${SCENES_URL}?scene=${scene}`);
  await sleep(0.3);
  const recording = await startRecording(page, join(CLIPS, `scene-${scene}.mp4`));
  await page.evaluate((c) => window.play(c), cues);
  // half a second more than the beat, so the composer always has a last frame to cut on
  await sleep(duration + 0.5);
  const { seconds } = await recording.stop();
  console.log(`scene-${scene}.mp4  ${seconds.toFixed(2)} s (beat ${duration.toFixed(2)} s)`);
}
await browser.close();
