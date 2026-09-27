# Faceless YouTube pipeline

Automated videos with no face and no recording:
**topic → research → script → voice → animated visuals → render → thumbnail → QA → YouTube upload**.

```
topics queue ─► Claude research (web search) ─► Claude script (structured JSON, scene by scene)
     ▲                                                     │
     │                                    TTS per scene with word timings (Edge / ElevenLabs)
     │                                                     │
 analytics ◄─ YouTube upload ◄─ QA + review ◄─ Remotion render (motion graphics, captions,
 (views)      (video, thumbnail,                 audio-reactive background, stock b-roll, music)
               captions, disclosure)
```

The visuals are **motion-graphics templates driven by the script**, not only stock footage:
animated titles, kinetic typography, count-up stats, bar charts, timelines, numbered lists,
comparisons, quotes, and stock b-roll with Ken Burns moves. Word-highlighted captions and
an audio-reactive background and visualizer sit on top. Every video looks different while
the channel keeps one consistent style, which matters for monetization (see below).

## Quick start

Requirements: Python 3.10+, Node.js 18+.

```bash
cd faceless-yt
python -m venv .venv && source .venv/bin/activate    # Windows: .venv\Scripts\Activate.ps1
pip install -r requirements.txt
(cd renderer && npm install)

# 1. Offline demo: no API keys, silent voice, renders jobs/<id>/video.mp4
python -m fyt demo                  # 16:9
python -m fyt --format short demo   # 9:16 Short
python -m fyt --format short demo --voice edge     # with a free neural voice (needs network)
python -m fyt --format short demo --voice espeak   # offline robotic voice (apt/brew install espeak-ng)

# 2. Real video
cp .env.example .env                # add ANTHROPIC_API_KEY (+ PEXELS_API_KEY for b-roll)
cp channel.example.yaml channel.yaml
python -m fyt make "How the Rule of 72 predicts when your money doubles"
```

Rendering uses Chromium through Remotion. It downloads its own copy on first run; set
`REMOTION_BROWSER_EXECUTABLE` to use an existing Chromium or headless shell instead.

## Uploading to YouTube

1. In Google Cloud Console, create a project, enable **YouTube Data API v3**, and create an
   **OAuth client ID** of type *Desktop app*. Save the JSON as `secrets/client_secret.json`.
2. `python -m fyt auth` opens a browser. Sign in with the channel's Google account.
3. Review, then upload:
   ```bash
   python -m fyt jobs                          # list jobs + status
   python -m fyt approve <job-id> --upload     # after watching video.mp4
   ```

Things to know:
- **Unaudited API projects can only upload private videos.** Until Google audits your
  project, everything uploaded through it is locked to private. Apply through the
  [YouTube API audit form](https://support.google.com/youtube/contact/yt_api_form) early.
- **Custom thumbnails need a verified channel** (youtube.com/verify). Until then the upload
  still works and the thumbnail step is skipped with a warning.
- **Quota:** the default 10,000 units a day allows about 6 uploads a day. That's plenty.
- `contains_synthetic_media: true` sets YouTube's AI-content disclosure. Keep it on while
  you use AI voices.

## Running it automatically

```bash
python -m fyt topics add "Your topic"     # or let Claude propose topics:
python -m fyt topics ideate -n 20         # uses your niche + what performed well
python -m fyt run --count 1               # next topic -> video (uploads if require_review: false)
python -m fyt stats                       # views/likes of uploaded videos
```

Schedule `run` with cron (Linux/macOS) or Task Scheduler (Windows), for example daily at 06:00:

```cron
0 6 * * * cd /path/to/faceless-yt && .venv/bin/python -m fyt run --count 1 >> jobs/cron.log 2>&1
```

With `require_review: true` (the default), scheduled runs produce videos that wait in
`jobs/` for approval. Setting it to `false` makes the pipeline fully hands-off. Only do
that once you trust the output: see the next section.

## Monetization: read this before going hands-off

- **YouTube Partner Program:** 1,000 subscribers plus 4,000 public watch hours in 12 months,
  or 10M Shorts views in 90 days.
- **The "inauthentic content" policy** (formerly "repetitious content") demonetizes channels
  whose videos are mass-produced and interchangeable. This pipeline is built to avoid that:
  - every script is researched and written fresh for its topic
  - data-driven visuals follow the actual content
  - the review gate keeps weak videos off the channel

  Keep those in place. Uploading many near-identical videos a day is the fastest way to get
  rejected.
- Only state facts the research supports. The script prompt forbids invented numbers and
  quotes, and lists sources in the description.
- **Music:** only put tracks in `assets/music/` that you are licensed to use on YouTube.
- **Stock footage from Pexels** is free for commercial use.

## Project layout

```
fyt/                 Python pipeline
  cli.py             commands (python -m fyt --help)
  pipeline.py        orchestration: make_video, upload_job, run_queue
  llm.py             Claude: topic ideas, web research, structured script
  tts.py             voices (edge / elevenlabs / silent) + word timings
  media.py           Pexels b-roll/photos, background music
  timeline.py        script + audio -> renderer props, SRT captions
  render.py          calls renderer/render.mjs
  qa.py              automatic checks on script and render
  youtube.py         OAuth, upload (video, thumbnail, captions), stats
  store.py           topic queue (SQLite) + job folders
renderer/            Remotion (React) video templates
  src/scenes/        scene templates: title, statement, stat, bars, list, quote, timeline, comparison, broll
  src/components/    background, captions, audio visualizer
  render.mjs         CLI renderer (video, thumbnail, --frame preview)
fixtures/            demo scripts used by `fyt demo`
jobs/<id>/           per-video outputs: research.md, script.json, props.json, video.mp4, thumbnail.png, captions.srt
```

A job folder keeps every intermediate file. You can edit `script.json` and rebuild with
`python -m fyt make "<topic>" --script jobs/<id>/script.json`, or preview a single frame:
`node renderer/render.mjs --frame 300 --props jobs/<id>/props.json --public jobs/<id>/public --out preview.png`.

Design and tweak templates live with `cd renderer && npm run studio`.

## Adding a scene template

1. Add the type to `SceneType` in `fyt/models.py` and `renderer/src/types.ts`.
2. Write the component in `renderer/src/scenes/index.tsx` and add it to `registry`.
3. Describe it in `SCRIPT_GUIDE` in `fyt/llm.py` so Claude knows when to use it.

## Tests

```bash
python -m pytest -q tests
(cd renderer && npm run typecheck)
```
