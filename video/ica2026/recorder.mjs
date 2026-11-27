/**
 * Record a browser page to an mp4.
 *
 * Playwright's own recorder encodes VP8 at a low bitrate, which smears
 * small text. Here the page's screencast frames (JPEG, from the DevTools
 * protocol) are piped straight into ffmpeg, stamped with the time they
 * arrive, and encoded as H.264 at 1920×1080 and a constant frame rate.
 *
 * The page is laid out at 1280×720 CSS pixels with a device scale of 1.5,
 * so text is drawn 1.5 times larger and the frames are natively 1920×1080.
 */
import { spawn } from "node:child_process";
import { chromium } from "playwright";

export const STAGE = { width: 1280, height: 720, scale: 1.5 };

export async function openStage() {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: STAGE.width, height: STAGE.height },
    deviceScaleFactor: STAGE.scale,
    colorScheme: "dark",
  });
  const page = await context.newPage();
  return { browser, context, page };
}

/**
 * Start recording `page` into `file`. Returns `seconds()`, the time since
 * the first frame (use it to log when things happen), and `stop()`.
 */
export async function startRecording(page, file, { fps = 30, quality = 92 } = {}) {
  const cdp = await page.context().newCDPSession(page);
  const ffmpeg = spawn(
    "ffmpeg",
    [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "image2pipe", "-use_wallclock_as_timestamps", "1", "-c:v", "mjpeg", "-i", "-",
      "-vf", `fps=${fps},scale=${STAGE.width * STAGE.scale}:${STAGE.height * STAGE.scale}:flags=lanczos,format=yuv420p`,
      "-c:v", "libx264", "-preset", "medium", "-crf", "16", "-movflags", "+faststart",
      file,
    ],
    { stdio: ["pipe", "inherit", "inherit"] },
  );
  const closed = new Promise((resolve, reject) => {
    ffmpeg.on("error", reject);
    ffmpeg.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited with ${code}`))));
  });

  let last;
  let first;
  let frames = 0;
  cdp.on("Page.screencastFrame", (frame) => {
    last = Buffer.from(frame.data, "base64");
    first ??= Date.now();
    frames++;
    ffmpeg.stdin.write(last);
    cdp.send("Page.screencastFrameAck", { sessionId: frame.sessionId }).catch(() => {});
  });
  await cdp.send("Page.startScreencast", {
    format: "jpeg",
    quality,
    maxWidth: STAGE.width * STAGE.scale,
    maxHeight: STAGE.height * STAGE.scale,
    everyNthFrame: 1,
  });
  // The screencast sends a frame only when the page changes. Repeating the
  // last one keeps the clock moving through a still picture.
  const heartbeat = setInterval(() => last && ffmpeg.stdin.write(last), 200);
  // wait for the first frame, so seconds() is measured from the start of the file
  while (!first) await new Promise((done) => setTimeout(done, 20));

  return {
    seconds: () => (Date.now() - first) / 1000,
    async stop() {
      clearInterval(heartbeat);
      await cdp.send("Page.stopScreencast").catch(() => {});
      if (last) ffmpeg.stdin.write(last);
      const seconds = (Date.now() - first) / 1000;
      ffmpeg.stdin.end();
      await closed;
      return { frames, seconds };
    },
  };
}

export const sleep = (seconds) => new Promise((done) => setTimeout(done, seconds * 1000));
