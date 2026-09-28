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

# 1. Demo: no API keys, silent voice by default, renders jobs/<id>/video.mp4
python -m fyt demo                  # 16:9
python -m fyt --format short demo   # 9:16 Short
python -m fyt --format short demo --voice kokoro   # with the free local Kokoro voice (~350 MB model, downloaded once)
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

## Daily uploads with GitHub Actions

`.github/workflows/daily-short.yml` (**Daily videos**) keeps two Shorts a day (14:00 and 22:00 UTC) and one ~8 minute
video every Saturday (16:00 UTC) scheduled on the channel, using `channel.yaml`: a niche Wikipedia article (from Wikipedia's
[Unusual articles](https://en.wikipedia.org/wiki/Wikipedia:Unusual_articles) list by default)
is rewritten by Claude into an original script, voiced with Kokoro, rendered and uploaded.
Each video's description credits the article (Wikipedia text is CC BY-SA 4.0).

Visuals follow the story: the article's own photos (from Wikimedia Commons) are offered to the
scriptwriter as a numbered list, and it picks the one that matches each scene's narration. Scenes
with no fitting photo get Pexels stock footage for a search written for that moment (needs the
`PEXELS_API_KEY` secret); charts and numbers stay on the plain background. Photo credits are
added to the description automatically.

**Manual upload (the default):** with `require_review: true` in `channel.yaml`, the job only
makes the video. Add the `GROQ_API_KEY` secret (free key from
[console.groq.com/keys](https://console.groq.com/keys); scripts are written by an open model on
Groq, see `llm` in `channel.yaml`; for Claude set `provider: anthropic` and add
`ANTHROPIC_API_KEY` instead), run **Actions → Daily videos → Run
workflow** (task `short` or `long`, choose how many videos), and download the run's **Artifact**. Each job folder has
`video.mp4`, `thumbnail.png`, `captions.srt` and `youtube.txt` with the title, description
(including the Wikipedia credit) and tags to paste into YouTube Studio.

**Automatic upload:** set `require_review: false` and do this one-time setup:

1. Do the YouTube steps above on your own computer (`python -m fyt auth`), so
   `secrets/token.json` exists. In Google Cloud, set the OAuth consent screen's
   publishing status to **In production**; in *Testing* the token expires after 7 days
   and the daily upload starts failing.
2. In the GitHub repo, **Settings → Secrets and variables → Actions**, add:
   - `GROQ_API_KEY` (or `ANTHROPIC_API_KEY` if `llm.provider` is `anthropic`)
   - `YOUTUBE_TOKEN_JSON`: the full contents of `secrets/token.json`
   - `PEXELS_API_KEY` (optional, for stock footage)
3. **Actions → Daily videos → Run workflow** to test it once. The rendered video is kept
   as a run artifact for a week.

**Reliable schedule:** every run (four a day) calls `python -m fyt fill`, which keeps the next two
days of publish slots (`schedule` in `channel.yaml`) filled. Each video is uploaded ahead of time with
YouTube's scheduled publishing and goes public at a random minute up to `youtube.publish_jitter_minutes`
after its slot. A failed video, a Groq or Pexels outage, or a run GitHub skips only shrinks that
two-day buffer; the next run refills it. Other safeguards:
- Groq calls retry on errors and fall back to `llm.fallback_models`; Pexels calls retry, and a scene
  without stock footage uses the plain background instead of failing the video.
- A video whose upload fails is kept (`jobs/pending`, cached between runs) and uploaded by the next run.
- Uploads stay within the API quota (`schedule.max_uploads_per_day`).
- If a slot in the next 24 hours is still empty after a run, the run fails and opens an issue titled
  "Upload schedule needs attention", which GitHub emails to you. It closes itself once the schedule is full.
Each run's summary shows the coming slots and their videos. `python -m fyt buffer` shows the same locally.

Long videos pick an article with at least `wikipedia.long_min_chars` of text. On Groq's free tier the
script is planned first and then written one chapter at a time, each from its own part of the article,
because a whole 8 minute script doesn't fit in one request. The chapters become timestamps in the
description. A long video takes about an hour to render on the free runner.

Change the times in the workflow's `cron` lines, and the niche in `channel.yaml`
(`wikipedia.list_pages`, `categories` or `articles`). Try one article locally with
`python -m fyt make "wiki:Boston Molasses Disaster"`, or queue some with
`python -m fyt topics wiki -n 5`.

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
