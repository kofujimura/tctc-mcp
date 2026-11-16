# ICA 2026 concept video

A 5:45 video for the IEEE ICA 2026 talk: 1920×1080 at 30 fps, English
narration (Gemini text-to-speech) and burned-in English subtitles. The
story and its scenes are described in `docs/ICA2026_TALK_SCENARIO.md`.

Output: `video/out/ica2026/tctc-ica2026-concept.mp4`, with
`captions.srt` beside it. `video/out/` is not in git.

## Rebuilding it

Run from the repository root, in this order. Each step reads what the one
before it wrote.

| Step | Command | What it does |
|---|---|---|
| 1 | `node video/ica2026/tts.mjs --verify` | Speaks `narration.mjs`, one request per chunk, and checks each clip against the script by transcribing it |
| 2 | `node video/ica2026/plan.mjs` | Lays chunks, gaps and holds on a timeline: `plan.json`, `captions.srt` |
| 3 | `node video/ica2026/audio.mjs` | Places every clip at its time: `narration.wav` |
| 4 | `node video/ica2026/record-scenes.mjs` | Records the animated scenes (`scenes.html`) to the length of their beats |
| 5 | `node video/ica2026/record.mjs` | Records the dashboard live on Sepolia; sends real transactions and resets the state before and after |
| 6 | `node video/ica2026/compose.mjs` | Cuts clips to beats, overlays subtitles, adds the narration |

Steps 1 and 5 need things outside the repository: a Gemini API key
(`GEMINI_API_KEY`, or the file named by `GEMINI_ENV`), the dashboard dev
server on `http://localhost:5173`, and the Sepolia demo of
`demo/ica2026` with its keys. Steps 4 and 5 record in real time.

Changing a line of narration means running everything again from step 1,
because every picture is timed from the narration. `node
video/ica2026/cues.mjs` checks that the scenes still find their cues, and
`node video/ica2026/sheet.mjs <clip> <out.png> <t…>` makes a contact sheet
to look at a clip without playing it. `node video/ica2026/smoke.mjs` records
six seconds of the dashboard to check the recorder itself.

## How the pictures are made

- **Animated scenes** (intro, today, idea, later, recap) are one HTML page.
  Elements appear at cues: the start of a narration chunk or of one of its
  subtitle lines.
- **Dashboard clips** are the real dashboard at
  `?story=ica2026&live`: tokens, issuers, expiry and bindings are read from
  Sepolia, and the header says "Live on Sepolia · status lines scripted".
  Grant and Revoke are real clicks. The page is given a stub wallet that
  answers as Mika; signing happens in Node, so her key never enters the
  page. The employer's pass is issued by `demo/ica2026/demo.mjs`.
- **Waits for Sepolia** are sped up to a few seconds, and a note in the
  top right corner says so while they play.
- **The "many issuers" beat** is `?story=ica2026-wide`, which is sample
  data; its header says "Story mode · sample data".
- A cursor and a camera (a CSS transform) are injected for the recording
  only.

## Things worth knowing

- `gemini-3.8-flash-tts` reads its text verbatim. A direction such as "Say
  warmly: …" is spoken aloud. Style goes in the part's
  `speech_metadata.style`; a pause is a `<short pause>` tag.
- The voice (Sulafat) says "Mika" as "Micah", so the spoken text spells it
  "Meeka". It also said "Kit" like "Git" at the start of one sentence,
  which was reworded.
- Transcripts differ between runs in spelling only (read/red, two/to);
  the check ignores those.
- This ffmpeg build has no libass and no drawtext, so subtitles are PNGs
  with alpha, drawn by the browser and overlaid by time.
- Playwright's own recorder smears small text. `recorder.mjs` pipes the
  page's screencast frames into ffmpeg instead.
