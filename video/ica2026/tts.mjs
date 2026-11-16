#!/usr/bin/env node
/**
 * Generate the narration with Gemini text-to-speech, one request per chunk.
 *
 *   node video/ica2026/tts.mjs            generate what is missing, write timing.json
 *   node video/ica2026/tts.mjs --verify   also transcribe each clip and compare it with the script
 *   node video/ica2026/tts.mjs --redo 5b  regenerate one chunk
 *
 * Clips are cached in video/out/ica2026/audio by a hash of model, voice,
 * style and text, so changing one line regenerates only that line.
 *
 * gemini-3.8-flash-tts reads the text verbatim: a direction such as "Say
 * warmly: …" is spoken aloud. The style therefore goes in the part's
 * speech_metadata, which is not spoken. --verify exists because nobody
 * hears a wrong word in an automated pipeline.
 *
 * The API key is GEMINI_API_KEY from the environment, else from the file
 * named by GEMINI_ENV (default ~/.config/ai-free-research/gemini.env). It
 * is sent as a request header and never printed.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BASE_STYLE, BEATS, MODEL, VOICE } from "./narration.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "out", "ica2026");
const AUDIO = join(OUT, "audio");
const API = "https://generativelanguage.googleapis.com/v1beta";
const TRANSCRIBER = "gemini-3.8-flash";

function apiKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  const path = process.env.GEMINI_ENV ?? join(homedir(), ".config", "ai-free-research", "gemini.env");
  const key = existsSync(path) && readFileSync(path, "utf8").match(/GEMINI_API_KEY\s*=\s*["']?([^"'\s]+)/)?.[1];
  if (!key) throw new Error("No GEMINI_API_KEY in the environment or in the Gemini env file");
  return key;
}

const headers = { "x-goog-api-key": apiKey(), "content-type": "application/json" };

async function call(model, body) {
  for (let attempt = 1; ; attempt++) {
    const r = await fetch(`${API}/models/${model}:generateContent`, { method: "POST", headers, body: JSON.stringify(body) });
    if (r.ok) return r.json();
    const detail = (await r.text()).replace(/\s+/g, " ").slice(0, 300);
    if (attempt >= 4 || ![429, 500, 502, 503, 504].includes(r.status)) {
      throw new Error(`${model}: HTTP ${r.status} ${detail}`);
    }
    await new Promise((done) => setTimeout(done, 2000 * attempt));
  }
}

async function speak(chunk) {
  const j = await call(MODEL, {
    contents: [{ role: "user", parts: [{ text: chunk.say, speech_metadata: { style: `${BASE_STYLE}; ${chunk.style}` } }] }],
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE } } },
    },
  });
  const audio = j.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData;
  if (!audio) throw new Error(`${chunk.id}: the response has no audio (${JSON.stringify(j).slice(0, 200)})`);
  if (!/wav/.test(audio.mimeType)) throw new Error(`${chunk.id}: expected WAV, got ${audio.mimeType}`);
  return Buffer.from(audio.data, "base64");
}

/** PCM samples and rate of a 16-bit mono WAV, found by walking its chunks. */
function pcm(wav) {
  if (wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE") throw new Error("not a WAV file");
  let rate = 0;
  for (let at = 12; at + 8 <= wav.length; ) {
    const id = wav.toString("ascii", at, at + 4);
    const size = wav.readUInt32LE(at + 4);
    if (id === "fmt ") {
      if (wav.readUInt16LE(at + 10) !== 1 || wav.readUInt16LE(at + 22) !== 16) throw new Error("expected 16-bit mono PCM");
      rate = wav.readUInt32LE(at + 12);
    } else if (id === "data") {
      const end = Math.min(at + 8 + size, wav.length);
      return { rate, samples: new Int16Array(wav.buffer, wav.byteOffset + at + 8, Math.floor((end - at - 8) / 2)) };
    }
    at += 8 + size + (size % 2);
  }
  throw new Error("WAV has no data chunk");
}

/** Where speech starts and ends (seconds): the first and last 20 ms window louder than about -40 dBFS. */
function speechSpan({ rate, samples }) {
  const win = Math.round(rate * 0.02);
  const loud = [];
  for (let i = 0; i + win <= samples.length; i += win) {
    let sum = 0;
    for (let k = i; k < i + win; k++) sum += samples[k] * samples[k];
    loud.push(Math.sqrt(sum / win) > 330);
  }
  const first = loud.indexOf(true);
  const last = loud.lastIndexOf(true);
  return {
    duration: samples.length / rate,
    speechStart: first < 0 ? 0 : (first * win) / rate,
    speechEnd: last < 0 ? samples.length / rate : ((last + 1) * win) / rate,
  };
}

const words = (text) =>
  text
    .toLowerCase()
    .replace(/<[^>]*>/g, " ")
    .replace(/meeka|micah|mica\b/g, "mika")
    .replace(/2\.4/g, "two point four")
    .replace(/thirty/g, "30")
    // spellings a transcriber may choose for the same sound
    .replace(/\bblock chain\b/g, "blockchain")
    .replace(/\bred\b/g, "read")
    .replace(/\btwo\b/g, "to")
    .replace(/[^a-z0-9' ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);

async function transcript(wav) {
  const j = await call(TRANSCRIBER, {
    contents: [
      {
        parts: [
          { text: "Transcribe this audio verbatim. Output only the words spoken, nothing else." },
          { inlineData: { mimeType: "audio/wav", data: wav.toString("base64") } },
        ],
      },
    ],
    generationConfig: { temperature: 0 },
  });
  return (j.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("").trim();
}

const args = process.argv.slice(2);
const verify = args.includes("--verify");
const redo = new Set(args.flatMap((a, i) => (a === "--redo" ? [args[i + 1]] : [])));

mkdirSync(AUDIO, { recursive: true });
const timing = { model: MODEL, voice: VOICE, chunks: {} };
let mismatches = 0;

for (const beat of BEATS) {
  for (const chunk of beat.chunks) {
    const hash = createHash("sha1").update([MODEL, VOICE, BASE_STYLE, chunk.style, chunk.say].join("\n")).digest("hex").slice(0, 10);
    const file = join(AUDIO, `${chunk.id}-${hash}.wav`);
    let made = false;
    if (!existsSync(file) || redo.has(chunk.id)) {
      writeFileSync(file, await speak(chunk));
      made = true;
    }
    const wav = readFileSync(file);
    const span = speechSpan(pcm(wav));
    timing.chunks[chunk.id] = { beat: beat.id, file, ...span };
    let note = "";
    if (verify) {
      const heard = await transcript(wav);
      const want = words(chunk.say).join(" ");
      const got = words(heard).join(" ");
      if (want !== got) {
        mismatches++;
        note = `\n      MISMATCH  heard: ${heard}`;
      } else {
        note = "  transcript matches";
      }
    }
    console.log(
      `${chunk.id}  ${span.duration.toFixed(2)} s (speech ${span.speechStart.toFixed(2)}–${span.speechEnd.toFixed(2)})  ${made ? "generated" : "cached"}${note}`,
    );
  }
}

const total = Object.values(timing.chunks).reduce((sum, c) => sum + (c.speechEnd - c.speechStart), 0);
writeFileSync(join(OUT, "timing.json"), `${JSON.stringify(timing, null, 2)}\n`);
console.log(`\n${Object.keys(timing.chunks).length} chunks, ${total.toFixed(1)} s of speech → ${join(OUT, "timing.json")}`);
if (verify && mismatches) {
  console.log(`${mismatches} chunk(s) differ from the script; regenerate them with --redo <id>.`);
  process.exitCode = 1;
}
