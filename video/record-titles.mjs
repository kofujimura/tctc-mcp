/** Render the HTML title cards to video via Playwright's recorder. */
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "out");

const cards = [
  { file: "web/title.html", save: "01-title.webm", ms: 8000 },
  { file: "web/closing.html", save: "06-closing.webm", ms: 8000 },
];

const browser = await chromium.launch();
for (const card of cards) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    recordVideo: { dir: out, size: { width: 1280, height: 720 } },
  });
  const page = await context.newPage();
  await page.goto("file://" + join(here, card.file));
  await page.waitForTimeout(card.ms);
  const video = page.video();
  await context.close();
  await video.saveAs(join(out, card.save));
  console.log("rendered", card.save);
}
await browser.close();
