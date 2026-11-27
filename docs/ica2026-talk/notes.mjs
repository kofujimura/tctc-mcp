#!/usr/bin/env node
/**
 * Copy the English script from docs/ICA2026_TALK_SCRIPT.md into the slides' speaker notes.
 *
 *   node docs/ica2026-talk/notes.mjs
 *
 * The script is the source: each "### スライド N" section's quoted lines (those starting
 * with ">") become the notes of slide N. Run this after editing the script.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const script = readFileSync(join(HERE, "..", "ICA2026_TALK_SCRIPT.md"), "utf8");
const deckPath = join(HERE, "index.html");
const deck = readFileSync(deckPath, "utf8");

const notes = [];
for (const section of script.split(/^### スライド /m).slice(1)) {
  const number = Number(section.match(/^(\d+)/)?.[1]);
  const paragraphs = [];
  let current = [];
  for (const line of section.split("\n")) {
    if (line.startsWith(">")) {
      const text = line.slice(1).trim();
      if (text) current.push(text);
      else if (current.length) paragraphs.push(current.join(" ")), (current = []);
    } else if (current.length) {
      paragraphs.push(current.join(" "));
      current = [];
    }
  }
  if (current.length) paragraphs.push(current.join(" "));
  notes[number - 1] = paragraphs.map((p) => p.replace(/&/g, "&amp;").replace(/</g, "&lt;"));
}

const slides = (deck.match(/<section class="slide/g) ?? []).length;
if (notes.length !== slides) console.warn(`the script has ${notes.length} slide sections, the deck has ${slides} slides`);
const marked = /\/\*NOTES-BEGIN\*\/[\s\S]*?\/\*NOTES-END\*\//;
if (!marked.test(deck)) throw new Error("index.html has no NOTES-BEGIN/NOTES-END markers");
writeFileSync(deckPath, deck.replace(marked, () => `/*NOTES-BEGIN*/${JSON.stringify(notes.map((n) => n ?? []))}/*NOTES-END*/`));
const words = notes.flat().join(" ").split(/\s+/).filter(Boolean).length;
console.log(`notes for ${notes.filter(Boolean).length} of ${slides} slides, ${words} words`);
