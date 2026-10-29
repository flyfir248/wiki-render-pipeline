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
comparisons, quotes, code-drawn explainer graphics (a line chart drawn by a glowing pen, a grid of 100
dots that lights up to show a share, circles where the camera pulls out from a speck to a giant to show
scale, and a loop of steps with a pulse running round it; any photo for the scene sits dim and soft
behind them), evidence boards (clue cards pinned and joined with red string as the narrator names them), animated maps (a globe that dives in, a plane, ship or army the camera follows over
a tilted map, empires that spread or shrink, a running year counter), cause-and-effect
diagrams, highlighted documents, typed-out transcripts, and photos moved by a virtual camera
(push in, pan, parallax) with varied transitions. Real photos get a Vox-style collage look: each one
becomes a duotone halftone print pinned over a dim copy of itself, and its main subject is cut out in
black and white and lifts off the print (`fyt/cutout.py`, free and local; turn off with `collage: {enabled: false}`). Word-highlighted captions and
an audio-reactive background and visualizer sit on top.

One motion system ties it together, in long videos and Shorts alike: the channel's signature cut is a
red thread (the evidence-board string) pulled across the frame to reveal the next scene, alternating
with whip pans that smear sideways; charts and lists tip up into place in 3D and sway gently; reveals
land with a small camera jolt; the spoken word in the captions lifts and gets a red-thread underline;
and a paper grain that changes every other frame gives the whole picture a printed, hand-made feel.
Statement words slam into place on the word the narrator says them; big reveals (a stat landing, the
largest circle of a scale, a share filling up) hit like an impact cut, with a punch-in, a flash and a
bass hit; collage photos drift in three layers (backdrop, print, cut-out) for 2.5D depth; and dust and an
occasional light beam drift over everything, so even a held frame is alive. Sound follows the picture:
a zip as the red thread is pulled, whooshes on whips, ticks as chart points land, a riser into each big
reveal and a hit as it lands (all synthesised in `fyt/sfx.py`).

Numbers land on the word: a stat's count-up, a proportion's fill and each point of a trend line arrive
as the narrator says that figure (`land_times` in `fyt/timeline.py`), not at a fixed point in the scene.

Every video also gets a visual plan (`fyt/visualplan.py`), made after its facts are checked and before
it is voiced: a visual director reads the whole script and picks the moments worth acting out as 3D
reconstructions, on top of the maps, charts, collages and statements the scriptwriter chose. One scene
type, `world`, draws them all (three.js inside Remotion, cel-shaded with ink outlines so it matches the
flat illustration style). A world scene names a subject, a variant and an action, and the engine builds
the rest: aircraft (take-off, climb, turn, dive, landing, ditching), ships (sailing, listing, sinking,
capsizing, hitting an iceberg, another ship or rocks), trains (travelling, braking, derailing, colliding,
a bridge collapsing under them), road vehicles (driving, skidding, crashing, a chase), rockets (on the
pad, launch, ascent, staging, breaking apart), space (orbits, fly-bys, an asteroid impact, a cutaway of
a planet's layers), cities (modern or historic: fire, earthquake, collapse, flood, explosion) and
landscapes (volcanic eruption, tsunami, wildfire, avalanche, or a fly-over), science (molecules, DNA
unzipping, atoms, crystals, built from measured geometry) and technology (a neural network computing or
training, a chip with data on its traces, always labelled illustrations). Any of them takes a weather
(rain, storm with lightning, fog, snow) and an effect (smoke, fire, explosion). There is no fixed share
of 3D: a story told moment by moment may be mostly reconstruction, one best told in maps and charts may
have none, and the only limit is a render budget (`visuals.world_seconds_short` / `_long`, 60 s and
180 s of 3D, set from measured render time on the free runner; the planner keeps the moments it ranks
highest). With no model available, a planner built from the catalog's keywords makes the plan instead.

The plan stays true to the script. A collision, fire, eruption or sinking is drawn only when that
scene's narration says it happened; otherwise the subject is shown doing something neutral (the ship
sailing on) and the scene is labelled ILLUSTRATION on screen, while a scene that shows what the
narration describes is labelled RECONSTRUCTION. Weather and effects need the script or the sources to
mention them. A subject that has had its disaster does not carry on as if nothing happened. The key
moment lands on the narrator's word for it (the `cue`, matched to the word timings), so the train leaves
the rails as the narrator says "derailed". Every video gets its own seed from its title, and each
recurring subject keeps its livery and layout across scenes, so the same ship looks the same in every
scene of a video and different from the ship in the next one. Old `aircraft` and `ship` scenes still
work; they are drawn as world scenes.

### Adding a 3D subject or action

Everything the planner, the scriptwriter, the fact guards and the renderer know about 3D comes from one
file, `renderer/src/scenes/world/catalog.json`: each subject's keywords, variants, settings, and actions
(which are events that need documenting, which is the neutral one, where the key moment falls, which
camera shot suits it). To add one:

1. Add the subject (or a new action or variant to an existing one) to `catalog.json`.
2. For a new subject, write its module in `renderer/src/scenes/world/` (the shared camera, sky, weather,
   smoke and debris are in `kit.tsx` and `../world3d.tsx`) and add it to `MODULES` in
   `renderer/src/scenes/world/index.tsx`. A new action of an existing subject only needs the module to
   draw it.

That is all: the scriptwriter's guide, the visual planner's menu, the allowed values in the script
schema and the keyword planner are built from the catalog, so every video made after the change can use
it. `tests/test_visualplan.py` fails if a catalog subject has no module.

### Models: the exact object where it is known, and a label that says how exact it is

`fyt/assets.py` works out which real object each world scene shows and draws the most faithful model
that is available, in this order:

1. **Library**: a glTF model in `renderer/public/models`, used only when the file is there and its
   licence and source are recorded in `renderer/src/scenes/world/assets.json`. It is copied into the
   job's own folder before rendering; a missing file falls back to the next step.
2. **Spec**: a named object's measured structure driving the procedural module (Titanic's four funnels,
   a 747's hump and four engines, Saturn V's three stages and escape tower, a molecule's bond lengths
   and angles from NIST data in `molecules.json`, B-DNA's 10.5 base pairs a turn). Sources are recorded
   with each spec; specs give the shape, not liveries.
3. **Generic**: the subject's own procedural model.

The on-screen label follows the model and the narration: RECONSTRUCTION for a named object the
narration describes, RECONSTRUCTION · SIMPLIFIED for a generic one, SCIENTIFIC MODEL for a model built
from measured data, ILLUSTRATION when the narration doesn't describe the action or the subject is a
concept. A generic model is never labelled as the real object. All scenes about one object share one
model, so it looks the same throughout. To add a named object, add a spec (or a library entry with its
`licence` and `sources`, and the file) to `assets.json` with the names that point to it; names written
`=word` match only the whole word.

### Story-driven 3D: the story decides, not the renderer

A renderer being available is never a reason for its subject to appear. Before any picture is chosen,
`fyt/manifest.py` reads the fact-checked script and lists what the viewer will see: each entity (the
bear, the smuggler's Cessna, a tardigrade), its look, the words a model library would file it under and
the scenes it appears in; the places; and the moments worth showing, each documented only when its words
are in the narration. Then:

- The catalog modules above are reusable assets, not content: a catalog scene is kept only when its
  subject is the kind of thing an entity in that scene is (the airliner module for an airliner, never for
  a Cessna or a bear). Entities no module can draw get a **stage** scene (`renderer/src/scenes/world/stage.tsx`):
  the entity's own glTF model, cel-shaded, playing its own animation clip when one fits the motion (a walk
  for "move"), in front of a painted plate of its place. The stage's actions are a motion grammar any model
  can perform (present, move, approach, depart, rise, fall, turn, shake), not a list of things.
- `fyt/assetlib.py` finds one model per entity for the whole video: the project library, the model cache,
  then Sketchfab's search (only CC0, CC BY and CC BY-SA models; downloaded from the Objaverse mirror on
  Hugging Face with no key, or from Sketchfab with `SKETCHFAB_TOKEN`), and Poly Pizza (`POLY_PIZZA_KEY`).
  Only when none of those has the thing is a new model generated (at most `visuals.max_generated` a video).
  A concept picture of it is drawn in the house style, checked by eye, and made 3D on a GPU, never on the
  Actions runner. The GPU is either a worker you host (TRELLIS.2, Hunyuan3D or any other) at the
  `IMAGE_TO_3D_URL` secret, or a Hugging Face Space named in the `IMAGE_TO_3D_SPACE` repository variable
  (e.g. `microsoft/TRELLIS.2`, run on free ZeroGPU minutes with `HF_TOKEN`). The worker's contract: it takes
  a POST with the picture as multipart field `image` and an optional `Authorization: Bearer
  $IMAGE_TO_3D_TOKEN`, and answers with the GLB itself or `{"glb_url": ...}`. A generated model is labelled
  illustrative, and it is cached like a found one, so it is generated once. A library candidate must name the entity's noun,
  pass a vision check of its preview, load, and hold real detail; it is then simplified to the shot's
  triangle budget (`renderer/prepare-model.mjs`) and stored with its source, author and licence. CC BY
  models are credited in the video's description. Found models are kept on the `asset-library` branch, so
  later videos reuse them. When nothing usable is found, the entity's scenes stay painted: a model of
  something else is never used in its place.
- `fyt/relevance.py` checks every 3D scene before the render: it must show an entity the manifest lists
  in that scene, and a frame rendered at its key moment must show that entity to a vision model. A scene
  that fails goes back to 2D and gets a painted picture.
- The manifest's looks seed the storyboard's cast sheet, so the painted bear and the 3D bear are drawn
  from the same description. The video's registry (entities, places, moments, the model for each, with its
  licence) is written to `assets.json` in the job.

All keys are optional and free; with none set, Sketchfab search plus the Objaverse mirror still work.

### Story worlds: a new 3D world for every video

Stage scenes are built by generators, not picked from a library (`visuals.story_worlds`, on by default).
`fyt/worldgen.py` designs, for each video, from the manifest and the narration:

- **the cast**: one build per entity, kept for the whole video. Living things are always generated: a
  rigged humanoid (body, age, outfit, hair, hat, held props), a quadruped (build, legs, neck, snout, ears,
  tail, horns, coat), a bird, fish, insect, serpent or cell, each with its own proportions and colours.
  Vehicles, objects, structures and plants are assembled from primitive parts (a twin-engine Cessna, a
  duffel bag, a red blood cell's disc). A found model from the library is used only for non-living things.
- **the sets**: one per place: a kind of terrain or interior (forest, river, airfield, hospital, inside a
  vessel...), time of day, colours, horizon (hills, mountains, a city) and up to four story-specific
  things scattered round it (loblolly pines, police cars).
- **the direction**: per scene, who is in it, what each one does (a verb from its body plan's grammar),
  where they stand and move, how the camera moves, and overlay marks and labels.
- **the style**: lowpoly, voxel, noir, diorama or clinical, one for the whole video; it changes materials,
  light and fog, never what is in the scene.

`renderer/src/scenes/world/storyworld/grammar.json` is the shared vocabulary: the Python schemas and
the renderer are both built from it, so a verb, set kind or style added there (and drawn in the
renderer) is open to every later video. Three model calls do the design (cast, sets, direction); when
one fails, rules build the same things from the manifest's words. Guards keep it honest: a dramatic
verb (crash, fall, eat) or a state (injured, burning) only when the narration says it and the moment is
documented, labels only in words the narration or the entity's name uses, and only entities the
manifest lists in that scene. The whole design and how each asset was made (model, rules, found) is
written to `world.json` in the job, and copied to `_runs/` with test renders.

What is procedural, and what isn't: every body, part, terrain, sky, light, mark and camera move is
generated at render time from the design; nothing is reused between videos except a found model of a
non-living thing (cached on the `asset-library` branch) and the GPU image-to-3D models the asset
library already made. The engine runs on the Actions runner with no GPU. Its limits: bodies are built
from primitives, so a species reads by proportion and colour rather than detail; people are figures by
role and clothing, never likenesses; there is no physics, cloth or facial animation; and a design is
only as specific as the manifest's looks.

Trying changes without spending Actions minutes: most of a test render's time is the free LLM's rate
limits while the script is written, not the 3D. Every job saves the script as written and checked
(`written.json`) next to its `manifest.json`, so a 3D change can be re-rendered from them:

```bash
python -m fyt --format short make "wiki:Sickle cell disease" --script written.json --manifest manifest.json --no-localize
```

This runs offline too: without an API key the story world is designed and directed by the rules. In
the workflow, a test render with `replay` set to an earlier test run's id does the same from that run's
saved files on the `asset-library` branch.

### The scene director: places, acting, camera and art style

On top of the story world, `fyt/director.py` directs every stage scene before it renders, from the
manifest and the narration alone (no extra model calls, no cost):

- **Casting put right.** A person is always built as a person (a "Templeton" is not a temple), a child
  is drawn as a child, and a garment the story names (Annie's blue dress) is worn by the person it
  belongs to, in its colour, instead of standing on the set as a box.
- **Environment recipes.** Each kind of place gets layers: foreground framing for each shot, clusters
  round the action, a horizon, mist, wind in the vegetation, particles and background life
  (`renderer/.../storyworld/layers.tsx`: instanced reeds and grass that sway in one draw call, pools and
  creeks that reflect the sky, fence lines, drifting mist banks, gulls). The marsh is its own place now.
- **Acting.** The narration's gestures become acts on the person's own clip (`actions.tsx`): raising a
  camera to the eye on the cue word, pointing, talking with the hands, waving, holding a prop, heads
  turning to whoever matters, a start when something is revealed, a shift of weight while standing.
  They work on any rigged library person, whatever its bones are called.
- **Camera choreography.** Each scene gets a shot list on its cue words: an establishing or aerial
  shot the first time a place is seen, a track alongside a walker, an insert on the hands at the
  gesture, a reveal, and a reaction shot on someone not yet framed.
- **Lighting rig.** Overcast, golden hour, hard sun, moonlight or interior, from the place's own words
  and the chosen atmosphere.

**Art styles.** One profile per video changes the whole scene, not a filter on the last frame: the
materials (smooth, three-band or two-band toon), the light ratios and shadow softness, the fog and mist,
how dense the set is, the lens and dutch angles, animation on twos for the print look, and a finishing
pass that reads the scene's depth.

| Profile | Look | Chosen for |
|---|---|---|
| `cinematic` (default) | soft physically lit, film grade | nature, travel, machines, disasters |
| `ink` | inked graphic novel: wobbling depth outlines, hatching, halftone, solid blacks | mysteries, crimes, hoaxes, the unexplained |
| `stencil` | four-ink stencil print, out of register, red accent | wars, revolutions, propaganda, protest |

Settings in `config.yaml` under `visuals`: `art_style` (`auto`, `cinematic`, `ink`, `stencil`),
`art_strength` (0-1, default 0.75), `environment_detail` (0-1, default 0.8) and `atmosphere` (`auto`,
`natural`, `dramatic`, `dreamlike`, `graphic`).

**Render inspection.** After every render, `fyt/inspect3d.py` scores each 3D scene twice, from the
video's own pixels: *environment richness* (detail and empty space in the frame) and *animation
quality* (what moves inside the picture once the camera's own move is taken out, cuts, and the longest
still run). Both go into `coverage.json` and `coverage.md`, and a bare place or a lifeless scene is a
quality warning in the log (warnings never hold a video).

### Art direction

Each video gets one look (`fyt/artdirect.py`), kept in every scene: archival for stories before 1950,
scientific, cosmic, natural, noir for dark or tense stories, a news look for stories told mostly in
numbers, and the channel's signature look otherwise. A profile sets the backgrounds, second accent and a
grade on the 3D scenes; the channel's accent colour and font stay the same in all of them. Turn it off
with `visuals.art_direction: false`.

### The storyboard and the quality gate

Once the narration is timed, `shotlist.json` records every scene: its timing and narration, what the
viewer must take from it (`purpose`), the technique (3D, 2.5D, 2D) and template, every asset with its
source and licence, the camera and transition, the sounds at its key moment, its status (documented,
reconstruction, scientific model, illustration) and what is uncertain about it.

A render is finished when it passes `fyt/qcheck.py`, not when the renderer exits. Before rendering it
checks that every asset exists, timings and key moments fall inside their scenes, on-screen text can be
read in the time it is shown, one object is drawn one way throughout, and every reconstruction is still
backed by its narration and every library model by a licence. After rendering it checks the video's
size, frame rate and sound, and samples frames from every scene: a black scene, or a 3D scene that does
not move, has failed to draw. A broken 3D scene is swapped back to the 2D scene it replaced and the video
renders once more; any other failure marks the job `qa_failed`, which holds it from upload. Results go
to `qc.json`, with `contact.png` (a contact sheet of the video) beside it. The checks catch technical and
some composition faults; they can't judge whether a scene looks good, so a held video is reviewed with
the contact sheet and the shot list.

Before a new script is voiced, `fyt/factcheck.py` checks every number, date, name and quote in it, said
or shown, against the passages of the source article that mention the same things. Wrong or unsupported
claims are rewritten from the source once; a script whose claims still fail (or that can't be checked)
is not made, so it can never upload. Turn it off with `fact_check: false`.

After each render the pipeline logs any stretch of 4 seconds or more where the picture barely changes
(`fyt/qa.py`), and `python -m fyt sheet video.mp4` prints them too. Every video looks different while
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

## Checking a render frame by frame

Every frame is a pure function of time (React/SVG drawn in headless Chromium, stitched by ffmpeg), so
any frame can be drawn on its own and looked at. `python -m fyt sheet` lays frames out on one image:

```bash
python -m fyt sheet jobs/<id>/video.mp4                # a frame a second from a finished video
python -m fyt sheet jobs/<id>/props.json --every 0.5   # frames drawn straight from the props, no full render
```

Use it when adding or changing a scene template (`renderer/src/scenes/`): render, look at the sheet,
fix what is wrong, repeat. It costs nothing at run time; the scheduled pipeline doesn't call it.

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
- `contains_synthetic_media` sets YouTube's "altered or synthetic content" label. YouTube asks
  for it on realistic footage of people or events that didn't happen, cloned real voices and
  AI-generated music, not for a narrator voice over real photos and graphics, so it's off. Turn it
  on for any video that does show realistic synthetic people or events.
  `python -m fyt relabel` (or the workflow's `relabel` task) clears the label on videos already up.

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

When the article has few photos, or a topic has no article, the list is topped up with freely
licensed photos of the subject (`fyt/freeimages.py`, `growth.image_sources`): Wikimedia Commons first,
then Openverse (Flickr and museum images under CC0, CC BY or CC BY-SA only, never NC or ND), the
Library of Congress (only items marked "no known restrictions") and NASA (public domain). None needs a
key. Each searched photo must name the subject and pass the same vision check before it goes behind a
scene, and is credited with its author and licence. Google Images and other web image searches are
deliberately not used: most of their results are copyrighted, and a monetised channel can lose a video
or get a strike for one. (Google's own licence-filtered Custom Search API is closed to new users and
shuts down at the start of 2027.)

Before Kokoro speaks, `fyt/speech.py` rewrites the narration into plain spoken words: years
("1992" as "nineteen ninety-two"), decades, dates, ordinals, money, percentages, units, Roman
numerals, abbreviations ("Dr.", "St.", "c. 1450") and acronyms ("HAL" as a name, "FBI" letter by
letter). Captions still show the text as written, timed to the spoken words. To change how an
acronym is said, add it to `WORD_ACRONYMS` there.

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
   - `UNSPLASH_ACCESS_KEY` (optional): the Access Key of an app at unsplash.com/developers; stock photos
     come from Unsplash first, then Pexels, and each is credited in the description
   - `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` (optional, for illustrated story scenes):
     sign up free at dash.cloudflare.com; the account ID is on the Workers AI page, and the token
     comes from **My Profile → API Tokens → Create Token → Workers AI** template. Or `TOGETHER_API_KEY`.
     Without them, story scenes use emoji-style props.
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

**Growth features** (`growth` in `channel.yaml`):
- *Packaging:* after the script is written, a second pass rewrites the title, the thumbnail text and
  the opening line for curiosity, and gives each Short a last line that loops back into its hook.
- *Topics:* articles are ranked by how well they fit the niche (rated by the model) and by how many
  people read them on Wikipedia in the last 30 days, plus the channel's own view counts when the token
  allows reading them. Off-niche articles are skipped.
- *Series:* each video is filed under one of `growth.series`, named in its description and added to a
  playlist of that name (created the first time).
- *Cuts:* each long video's strongest chapters become Shorts that link to the full video. They take
  the next regular Short slots.
- *Long videos from Shorts that did well* (`growth.long_from_shorts`): the weekly long video tells the
  full story of the recent Short with the most views (at least `long_from_short_min_views`, public for
  two days, from the last `long_from_short_days`), when its article has the material. Each Short gets one
  long video at most; with none that qualifies, a fresh article is picked as before.
- *A model for long videos* (`long_llm`): long videos ask this model first once its key is set, so the
  week's long script doesn't wait on free tiers the Shorts have spent.
- *Timely slots* (`schedule.timely_slots`): a Short slot kept for what is in the news that day. It
  stays empty until `timely_hold_hours` before it goes live, then gets the trending article (most read
  yesterday, or today's anniversary) that fits the channel best, or the next evergreen topic when none
  fits. The day's fit scores are kept in state.db, so the slot and the bonus videos score the trending
  list once a day between them. The `stats` task compares the first-week views of trending and
  evergreen topics.
- *Bonus videos:* once the schedule is full, a run with quota left checks Wikipedia's most-read
  articles and today's anniversaries. If one fits the channel well, it makes a bonus Short (at most
  one a day) or, for a very strong fit, a bonus long video (at most one a week), and publishes it
  within the hour. If nothing fits, it looks again six hours later.
- *Weekly news explainer* (`news_longs_per_week`): once a week, a bonus long video on a recent news
  incident from Wikipedia's "In the news" and most-read lists, using the previous day's feed so the
  facts have had a day to settle. Only a specific incident with established facts and a strong fit
  (`news_min_fit`, 0-10) qualifies; elections, partisan politics and private people are skipped. The
  script attributes claims ("police said"), never speculates about causes or guilt, avoids graphic
  detail, covers what is still unknown, and uses somber or tense music. Its title isn't run through
  the curiosity polish. YouTube often limits ads on tragedy coverage.
- *Visuals in every scene* (`visuals_every_scene`): scenes the script gave no picture (charts, numbers,
  quotes) get a real photo behind them, darkened, with a slow zoom: a spare article image, then a
  freely licensed photo of the subject (Commons, Openverse, Library of Congress, NASA), then a stock photo.
  Searched photos are credited in the description.
- *Music:* with no tracks in `music_dir`, each video gets an original background track composed note by
  note (`fyt/music.py`) in the mood the script picks: somber (slow, dark, quiet, no beat) for deaths,
  disasters and war, tense, curious, uplifting or playful, with a light pulse in Shorts where it fits. No licences, no Content ID claims, nothing to disclose. Drop your own tracks in `music_dir` to
  use those instead.
- *Playlists*: every video is filed under a series, long videos in "<series>" and Shorts in
  "<series> Shorts", newest first, each with a description. New uploads are filed as they go up; each
  scheduled run also files up to 8 older videos (run the `playlists` task to do more at once).
- *Community posts* (on demand: run the `posts` task): drafts three posts (a poll on what to cover next, a
  teaser for the week's long video, a fact with a question) and opens them as a GitHub issue, which
  GitHub emails you. YouTube's API can't publish posts, so paste them in Studio (Create > Create post).
- *Sound effects* (`sound_effects`, `sfx_volume`): a whoosh on the livelier scene changes, a pop as a map
  pin drops or a prop appears, a boom, thunder or crackle with a story scene's effect, a chime when a
  figure lands and a thud for a document's stamp. They're synthesised too (`fyt/sfx.py`) and sit under
  the narrator.
- *First comment* (`first_comment`): each script includes a question about the story, and once the video
  is public the channel posts it as the first comment. The API can't pin comments; pin it in Studio if
  you like.
- *Two-part stories* (`two_part_share`): about a quarter of Shorts from long enough articles are told in
  two parts. Part 1 ends on the open question with "Part two is up next."; part 2 opens with a one-line
  recap, fills the next Short slot and links back to part 1.
- *Watch-time feedback:* with YouTube Analytics access (below), topic choice and the packaging pass see
  which videos people watched furthest and which they left soonest, not only view counts.

**Caption tracks, playlists, comments and stats** need a YouTube token with the full permission, not only
uploads, and watch-time feedback needs the `https://www.googleapis.com/auth/yt-analytics.readonly`
scope too. Run `python -m fyt auth` on your computer (it asks for all three), or make the token in the
OAuth Playground with all three scopes, then replace the `YOUTUBE_TOKEN_JSON` secret with the new token. Until then those steps are skipped and
the videos still go out; captions are burned into the video anyway.

Long videos pick an article with at least `wikipedia.long_min_chars` of text. On Groq's free tier the
script is planned first and then written one chapter at a time, each from its own part of the article,
because a whole 8 minute script doesn't fit in one request. The chapters become timestamps in the
description.

Long videos are told like a thriller, not a summary (`LONG_STRUCTURE` in `fyt/llm.py`): a cold open
drops the viewer into the story's most dramatic moment and cuts away before the outcome, says what is
at stake, then rewinds; the story follows one person with a goal, linked scene to scene by "but" and
"so"; something changes every minute or so, a twist lands around the middle, and the end returns to
the cold open and finishes it. The outline plans this before any scene is written: the cold open, and
for every chapter a turn and the open question it ends on, which every chapter's request sees, so the
loops one chapter opens are the ones a later chapter closes. Scenes are short beats of 15-25 words,
photo scenes cut to a new shot every 5 seconds (`growth.long_shot_seconds`), and each chapter after
the first opens with a "Part N" card and a hit. A long video takes about an hour to render on the free runner.

A Short is built on one question and its answer (`SHORT_STRUCTURE` in `fyt/llm.py`): the writer first
decides what a stranger would ask after the hook, the answer, and why someone who never heard of the
subject should care, then writes hook, context, build and payoff around that. Every scene adds a new
fact, at least three concrete specifics come from the notes, and at most two names or specialist terms
appear besides the subject, each explained where it first comes up. Three checks stop a Short that
has too little to say (`fyt/qa.py` `substance`, `fyt/pipeline.py`):
- a draft under `SHORT_MIN_WORDS` (105) or with a sentence that restates an earlier one is written
  again, told what was wrong;
- the story editor (`llm.mend`) fixes where a newcomer would get lost and says what a stranger takes
  away, scoring the Short 0-10; under `SHORT_MIN_WORTH` (5) the topic is skipped;
- after every rewrite, cut and fix, a Short under `SHORT_FLOOR_WORDS` (100) or still repeating itself
  is not made, and the scheduler moves on to the next topic.
The log names the model that wrote each script and the editor's takeaway and score.
The main model's free daily tokens are kept for scripts: translations, the visual plan, 3D casting, sets and
direction, storyboards, topic ranking and post drafts ask `llm.helper_models` first and the main model only
when every helper fails (`llm.helping`). Writing, the story editor, tightening, polish and the fact check
stay on the main model.

Change the times in the workflow's `cron` lines, and the niche in `channel.yaml`
(`wikipedia.list_pages`, `categories` or `articles`). Try one article locally with
`python -m fyt make "wiki:Boston Molasses Disaster"`, or queue some with
`python -m fyt topics wiki -n 5`.

## Instagram Reels

Every Short can also go up on Instagram as a Reel, to send Instagram viewers to the YouTube channel
(`fyt/instagram.py`, settings under `instagram` in `channel.yaml`).

- **Caption.** With `instagram.enabled`, each Short gets `instagram.txt` next to its video (and in the run's
  artifact): the hook, one line of the story, a call to action naming the channel (`cta`, `youtube_handle`),
  the video's comment question, the Wikipedia credit and at most five hashtags (Instagram's limit since
  December 2025: the fixed `hashtags` first, then the video's own tags). Links in captions can't be tapped
  on Instagram, so the caption points to the link in the bio. To post one by hand, download the run's
  artifact and paste `instagram.txt` as the Reel's caption; `python -m fyt reel <job>` writes it for a local job.
- **Posting.** With `instagram.publish: true` and the two secrets below, each run of **Daily videos** posts
  the Shorts that have gone public on YouTube since the last run as Reels (the files come from the run that
  made them), at most `max_per_run` a run. Two extra runs at 15:40 and 23:40 UTC, just after each Short slot
  and its jitter, post them as soon as they're public. A Reel never comes out before its Short, and Shorts older than
  `max_age_hours` aren't posted, so turning posting on doesn't post a backlog. Run the workflow with task
  **reels** to post right away. Shorts render at 1080x1920 H.264/AAC, which Instagram takes as they are.

Instagram only lets apps post through the Graph API with a professional account. The route used here
(Facebook Login) is the one that uploads a video file directly; it needs the Instagram account linked to a
Facebook Page. Once:

1. In the Instagram app: **Settings > Account type and tools > Switch to professional account** (Creator or
   Business), then link it to a Facebook Page (make an empty Page for the channel if you have none).
2. Put the YouTube channel in the bio: **Edit profile > Links > Add external link**, the channel's URL. Apps
   can't set the bio, so this stays manual.
3. At [developers.facebook.com](https://developers.facebook.com/apps), create an app (use case: *Manage
   messaging and content on Instagram*, or type *Business*) and add **Instagram** with Facebook Login for
   Business. While you're an admin of the app it can post to your own account without App Review.
4. In the [Graph API Explorer](https://developers.facebook.com/tools/explorer/), pick the app and generate a
   user token with `instagram_basic`, `instagram_content_publish`, `pages_show_list`, `pages_read_engagement`
   and `business_management`, choosing your Page and Instagram account when asked.
5. Run `python -m fyt ig-token --app-id <id> --app-secret <secret> --token <token>` (the app's id and secret
   are under **App settings > Basic**). It checks the token can post and prints `INSTAGRAM_USER_ID` and a
   Page token that doesn't expire as `INSTAGRAM_TOKEN`; add both as repository secrets.
6. Set `instagram.publish: true` (and `youtube_handle`) in `channel.yaml`.

Instagram allows 100 posts a day through the API; the channel makes about three Shorts a day.

## Facebook and Threads

The same Shorts can go up on the Facebook Page and on Threads (`fyt/crosspost.py`, `facebook` and `threads`
in `channel.yaml`), from the same queue and in the same step as the Reels. Links can be tapped on both, so
each post links straight to the Short on YouTube. A platform whose access doesn't work yet is skipped with
a warning in the run, without using up the Shorts' retries.

- **Facebook** posts a Reel to the Page the Instagram account is linked to, with the `INSTAGRAM_TOKEN`
  secret. The token needs `pages_manage_posts` on top of the Instagram permissions: in Business Settings,
  **Users > System users**, pick the system user, check it has the Page as an asset (full control), then
  **Generate new token** with `pages_manage_posts`, `pages_read_engagement`, `pages_show_list` and the
  Instagram permissions, and put it in `INSTAGRAM_TOKEN`.
- **Threads** has its own API. In the Meta app, **Add use case > Access the Threads API** with
  `threads_basic` and `threads_content_publish`; under **App roles > Roles** add the Threads account as a
  Threads tester and accept the invite in the Threads app (**Settings > Account > Website permissions**).
  Then generate a token for it in the use case's settings and add it as `THREADS_TOKEN`, with the Threads
  app secret (**App settings > Basic**, Threads app secret) as `THREADS_APP_SECRET`. Threads tokens last
  60 days; with the app secret the run renews it every week and keeps it in `state.db`, encrypted with the
  app secret. Threads only takes videos from a link, so it always uses the temporary host.

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
  visualplan.py      the visual plan: which moments become 3D reconstructions, within the render budget
  scenes3d.py        the 3D catalog on the Python side, and the guards that keep world scenes true
  worldgen.py        each video's story world: cast, sets, direction and style, designed from the story
  director.py        the scene director: casting fixes, place layers, acts, shot lists, light, art profile
  inspect3d.py       render inspection: environment richness and animation quality of each 3D scene
  assets.py          which real object each 3D scene shows, and the most faithful model of it available
  artdirect.py       each video's look
  shotlist.py        the production storyboard (shotlist.json)
  qcheck.py          the quality gate before and after rendering (qc.json); a failure holds the video
  qa.py              automatic checks on script and render
  factcheck.py       checks every claim in a script against the source article before it is voiced
  youtube.py         OAuth, upload (video, thumbnail, captions), stats
  instagram.py       Shorts as Instagram Reels: the caption, and posting once the Short is public
  store.py           topic queue (SQLite) + job folders
renderer/            Remotion (React) video templates
  src/scenes/        scene templates: title, statement, stat, bars, list, quote, timeline, comparison, broll,
                     map (animated routes), process, document, dialogue, story (2D illustrated scenes
                     acting out the narration, drawn with Fluent Emoji, MIT); camera moves and transitions
  src/scenes/world/  the 3D engine: catalog.json, assets.json, molecules.json, the shared kit, and one module per subject
    storyworld/      the generators: grammar.json, humanoid and creature rigs, parts, environments, styles
  src/components/    background, captions, audio visualizer
  render.mjs         CLI renderer (video, thumbnail, --frame preview)
fixtures/            demo scripts used by `fyt demo`
jobs/<id>/           per-video outputs: research.md, script.json, visualplan.json, world.json, props.json, shotlist.json, qc.json, contact.png, video.mp4, thumbnail.png, captions.srt, instagram.txt
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
