---
name: weird-but-true-visual-style
description: Apply the permanent Weird But True visual identity (bright cinematic low-poly 3D documentary) when designing, modelling, animating, lighting, rendering, reviewing or packaging any channel scene, Short, long video or thumbnail in Three.js or Blender. Read before building or QC-ing any shot.
---

# Weird But True — Visual Style Skill

Version 1.2 (22 Nov 2026). v1.0 was the owner's text; v1.1 keeps its direction and turns it into numbers QC can
check, adds Shorts, a pinned palette, thumbnails, a render budget, a colour-blind rule and a growing mistakes list.
Where a number and an adjective disagree, the number wins. Where narrative truth and "bright" disagree, truth wins
and the scene uses the sombre profile (section 4.3).

**Where the tools are.** Frame QC: `scripts/wbt_frame_qc.py` in the FacelessYT repo's copy of this skill, and
`D:\BlenderWorkspace\03_SCRIPTS\qc\wbt_frame_qc.py` on the laptop. Shared Three.js kit and the style test:
`test-scene/` in the repo, `D:\BlenderWorkspace\04_PIPELINES\threejs\web\wbt_kit.js` and `wbt_hachiko.js` on the laptop.

**Rule zero: rich environments.** Section 3A is mandatory and outranks every other style rule except narrative truth.
No scene is built without a written dressing plan, and no scene is approved until the density gate passes.

**How to use it.** Before building: read sections 1-10 and 3A and the mistakes list (section 17). Before rendering: run the
browser preview and `scripts/wbt_frame_qc.py` (section 14). After a review: put every repeated note into section 17
and fix the skill, not only the video (section 18).

## 1. Creative direction

**Bright Cinematic Low-Poly 3D Documentary.** A colourful, carefully art-directed 3D world: stylized low-poly
characters and environments, appealing shapes, rich but controlled colour, soft cinematic lighting, polished material
detail. Warm, inviting, readable, full of personality. It attracts attention through colour, composition and visual
storytelling, not darkness, visual noise or exaggerated effects.

Not crude or primitive low-poly. Geometry is intentionally simplified; composition, materials, lighting, animation and
staging stay polished. It should feel like a premium animated documentary: approachable for a broad audience,
sophisticated enough for serious history, science, technology and real-world stories.

## 2. Reference image

**Fixed location:** `D:\BlenderWorkspace\05_REFERENCES\wbt-style\reference.jpg` (the one image that defines the
look). Supporting frames go in the same folder as `support-01.jpg`, `support-02.jpg`, … A repo copy is not kept
(licence). If the file is missing, say so and work from this text; never invent what the reference shows.

Use it as a guide to the visual language, not a scene to reproduce. Carry forward: clearly faceted low-poly
characters; recognisable silhouettes and readable faces; warm, bright seasonal colour; soft daylight, gentle shadows,
shallow atmospheric depth; detailed but simplified clothing, props and architecture; a coherent miniature-world
feeling with characters grounded in a believable place; friendly without making every subject childish.
Do not reproduce the reference character, outfit, dog, bench, shopfront or composition unless a project asks.

## 3. Geometry and modelling

**Characters.** Deliberate planar facets (flat shading, `flatShading: true` in Three.js, Shade Flat in Blender).
Readable silhouettes, slightly simplified proportions. Faces read at medium and wide sizes. Clothing has a few
recognisable folds and layers, no micro-geometry. Hands hold objects; feet touch the ground. Keep proportions, face,
palette and accessories identical across scenes (section 9, character kit).

**Environments.** Coherent spaces, not isolated backdrops. Simplified architecture, trees, vehicles, furniture,
terrain, props. Detail through shape variation, material contrast and purposeful set dressing. Establish scale with
doors, furniture, people and vehicles.

**Facet and polygon budget** (triangles per object; the facet edge should be visible at the shot size it is seen at):

| Object | Triangles | Facet size on screen |
|---|---|---|
| Hero character, full body | 1,500-4,000 | 6-20 px |
| Hero head in close-up | 600-1,500 for the head alone | 10-30 px |
| Background person | 300-900 | any |
| Animal (hero) | 800-2,500 | 6-20 px |
| Tree | 60-400 | 8-40 px |
| Building | 200-1,500 | 10-60 px |
| Distant hills, rocks | 20-200 | 20-80 px |

Below the low end a shape stops reading; above the high end it stops looking low-poly. Rotate copies of a repeated
asset (any of 4+ yaw angles) and vary scale by ±10-15% so no two neighbours are identical. No random
triangulation, lumpy topology, flipped normals or smoothing on faceted objects.

**Scale (real metres, always).** Adult 1.60-1.85 m, child 1.0-1.4 m, door 2.0-2.1 m high, table 0.75 m, chair seat
0.45 m, car 1.5 m high, storey 3.0 m, medium dog 0.5-0.7 m at the shoulder. Kit assets that use other units are
rescaled on load and checked against a door before anything else is placed (section 17, M-03).

## 3A. Environment density (mandatory, top priority)

The most common failure is an empty world: a character, a floor and a few isolated objects. Every environment must
feel inhabited, specific to its place and period, and busy enough that the viewer believes it continues past the
frame edge. **Rich does not mean cluttered.** Every object must contribute to the location, the period, the
atmosphere or the story. If you cannot say which, cut it.

**Five layers, every scene.**

| Layer | What goes there | Examples |
|---|---|---|
| 1. Foreground | Objects between the camera and the subject that frame the view and give depth | Trees, furniture, signs, railings, posts, plants, door frames, crates |
| 2. Hero zone | The subject and what they touch or use | The person or animal, their tools, the object the story is about |
| 3. Midground | The working life of the place | Benches, displays, streetlights, equipment, pedestrians, vehicles, carts, props |
| 4. Background | What tells you where and when you are | Buildings, windows, rooftops, trees, distant architecture, skyline, hills |
| 5. Atmosphere and activity | Motion and air | Weather, smoke, steam, dust, falling leaves or snow, foliage moving, distant traffic, birds, light shafts, people going about their day |

**Dressing plan first.** Before any geometry, write the plan in the shot file (a comment block) or the shot list:
the location and year, then each of the five layers as a list of named objects, then the activity (who moves, where
they come from and where they go). Example, a 1930s airship hangar:

- *Location and period:* Lakehurst-style airship hangar, 1936, dawn.
- *Foreground:* a coil of mooring rope, the edge of a tool cart, a hand rail on the gantry stairs.
- *Hero zone:* the ground crew chief with a clipboard beside the bow mooring line.
- *Midground:* the airship's gondola and lower hull, wheeled ladders, fuel and gas service stations, crates, cables
  across the floor, a tractor, ground crew hauling lines, a mechanic on a ladder.
- *Background:* steel roof beams and trusses, industrial windows, overhead lamps, the open hangar doors with
  service buildings and a water tower outside.
- *Atmosphere and activity:* dust in the light shafts from the windows, steam from a service line, workers crossing,
  a truck passing outside, a flag moving at the doors, period signage ("NO SMOKING", unit numbers).

**Minimum counts in the final camera view** (named props, people and vehicles that are on screen; the hero is
separate; layers are measured from the camera: foreground nearer than 0.75 × the hero distance, midground up to
3 × the hero distance, background beyond):

| Shot size | Foreground | Hero | Midground | Background | Atmosphere systems |
|---|---|---|---|---|---|
| Wide / establishing | 2 | 1 | 8 | 5 | 2 |
| Medium | 1 | 1 | 6 | 3 | 2 |
| Close-up | 0 | 1 | 3 | 1 | 1 |

An atmosphere system is something that moves on its own: a crowd, falling particles, steam, smoke, traffic, birds,
swaying lamps or foliage. A close-up still needs a readable place behind the face (a window, a shelf, a street).

**Density review gate (before approving any scene).** Inspect the final camera view, not the set from a work camera:

1. **Per-layer counts.** In Three.js, build props with the kit's `prop()`, `hero()` and `atmo()` and set
   `window.SHOT_SIZE`; `test-scene/render_test.mjs` prints the counts for the first and last frame and
   `DENSITY FAIL` if any layer is under the table above. In Blender, count by collection (`FG`, `HERO`, `MID`, `BG`,
   `ATMO`) in the camera's view.
2. **Empty space.** `scripts/wbt_frame_qc.py frames` splits each sampled frame into cells 1/24 of the width and marks
   a cell empty when under 3.5% of its pixels carry an edge and its brightness barely varies. Only connected empty
   patches of 2% of the frame or more count (a flat facet on a beam is the style; a bare floor is not).
   Limits: empty share ≤ 15% and largest patch ≤ 8% (sombre: 20% and 10%). Sky counts: a plain sky over a third of the
   frame fails, so add cloud, birds, rooftops or treetops.
3. **Paths.** Every walker passes props by ≥ 0.3 m (`render_test.mjs` prints `PATH FAIL` with the props it hits).
   People enter and leave through a believable opening (a door, a passage, a street, the frame edge), never into a wall.
4. **Look at it.** On the stills sheet, point at any area of the frame larger than a postage stamp with nothing in
   it and ask whether that is intended (a sky for a title, a deliberate quiet beat). Unintended means dress it.

Fixes that work, in order: texture and wear on the ground (paving joints, puddles, tracks, fallen leaves); props that
belong to the place along the walls and edges; people with a job; background windows, signage and rooftops; motion.
Snow, sand and water are the hardest: give them tracks, piles, cleared paths and footprints (M-28).

## 4. Colour

### 4.1 Behaviour
- Each scene uses 3-5 colour families from 4.2 plus neutrals. List them in the shot plan.
- Strongest contrast and saturation go to the subject or key evidence: subject saturation at least 0.10 (HSV S)
  above the frame average.
- The subject separates from what is directly behind it by lightness ΔL* ≥ 15 or a clearly different hue: a
  cream animal never sits on beige ground, a navy coat never stands against a navy wall.
- Complementary or analogous pairs guide the eye. Not every object equally saturated.
- Use natural colour where history, science or geography require it. Never recolour evidence or historically
  significant objects in a way that misleads.
- Colour may signal time, place, mood, danger or technology; keep each meaning fixed for the whole video.

### 4.2 Default palette (pinned)

| Family | Name | Hex |
|---|---|---|
| Warm sunlight | Golden | `#F2B53A` |
| | Amber | `#E08A2E` |
| | Peach | `#F4B38A` |
| Nature | Leaf green | `#7DBA4E` |
| | Forest green | `#2F7A4A` |
| | Turquoise | `#2FB3A6` |
| | Sky blue | `#7EC4EA` |
| Built | Warm wood | `#A8703F` |
| | Cream | `#F3E6C8` |
| | Sandstone | `#D8B58A` |
| | Muted brick | `#B65E48` |
| Cool contrast | Teal | `#2A8C9A` |
| | Blue-grey | `#6E8496` |
| | Soft navy | `#2E4566` |
| Neutral | Charcoal | `#33363B` |
| | Warm grey | `#8C847A` |
| | Off-white | `#F6F1E7` |
| Highlight | Signal yellow (evidence, one object per shot) | `#FFD23F` |

Skin (choose by who the person was, never a single default): `#F1C9A5`, `#E0AE84`, `#C68B5E`, `#A06842`,
`#7A4B2E`, `#55331F`. Hair: `#1F1A17`, `#3B2A20`, `#6B4A2E`, `#A77B4F`, `#D8C08A`, `#B9B4AC`.
Eyes: `#22252B` with an `#FFFFFF` catch-light.

Skies (zenith → horizon): day `#5FA8E6 → #BFE2F5 → #F6E6C8`; golden hour `#6C8FD0 → #F4C08A → #F7A867`;
overcast `#9AA7B4 → #CCD3D8`; night `#1B2A4A → #3A4D78` (never pure black: night is navy, lit by a moon key).

### 4.3 Sombre palette (disasters, deaths, war, illness)

| Name | Hex | Use |
|---|---|---|
| Ash | `#5E5A57` | ground, ruins |
| Smoke | `#8A8580` | air, haze |
| Bone | `#D9D2C5` | the lightest value, faces |
| Deep slate | `#263240` | shadows, water |
| Dusk blue | `#3E4E66` | sky |
| Moss | `#4F6247` | surviving nature |
| Ember | `#C2562B` | fire only, ≤5% of the frame |

Sombre still means readable: faces lit, subject separated (section 5 numbers, sombre column). Switch to it on the beat
where the story turns, keep it until the story turns back, and never mix the two palettes in one shot.

### 4.4 Colour-blind rule (maps, charts, labels, any colour that carries meaning)
- Red against green never carries a meaning on its own. Two sides = blue `#1F5BC4` vs orange `#F39A2B`;
  a third = light grey `#EDEDED` with a dark outline (this trio passes the check below).
- Every coded colour also differs in a second channel: label, pattern (hatch/dots), shape or lightness
  (ΔL* ≥ 20 between any two coded colours).
- Check with `python scripts/wbt_frame_qc.py palette <hex> <hex> …`: every pair must stay ≥ 20 ΔE (CIE76) under
  simulated deuteranopia and protanopia.

## 5. Lighting and exposure

Default: soft broad daylight, warm key (`#FFF1DC`-`#FFE2B8`, 5,000-5,800 K), cool fill or sky (`#BFD8F0`), key:fill
ratio 2:1 to 3:1 (sombre up to 4:1). Gentle AO and contact shadows ground everything. Golden hour for warmth or
memory. Night, overcast, fire, industrial or disaster light when the story demands it, keeping geometry and clarity.
Fog, bloom, DOF, dust, rain, smoke and particles only when they serve the scene.

**Measured targets** (whole frame, sRGB 0-255, Rec.709 luma Y; checked by `wbt_frame_qc.py`):

| Measure | Default | Sombre |
|---|---|---|
| Mean luma | 105-170 | 60-115 |
| Luma standard deviation (contrast) | ≥ 40 | ≥ 32 |
| Pixels ≥ 250 (blown) | ≤ 2% | ≤ 1% |
| Pixels ≤ 12 (crushed) | ≤ 3% | ≤ 10% |
| Mean saturation (HSV S, pixels with V > 0.15) | 0.25-0.55 | 0.10-0.32 |
| Colourfulness (Hasler-Süsstrunk M) | ≥ 30 | ≥ 12 |
| Frame 1 of a Short, any profile | mean luma ≥ 95 | ≥ 80 |

Snow, fog and overcast scenes may drop mean saturation to 0.14 (`--snow`), but keep one warm accent (a lit window,
a coat, a lamp) and the subject above 0.30. Found on the first style test (Hachikō, winter beat at 0.16).

Bloom: Three.js `UnrealBloomPass` strength ≤ 0.35, threshold ≥ 0.85; Eevee bloom/glare intensity ≤ 0.05.
Vignette darkens corners by ≤ 25%. Film grain ≤ 2% amplitude. Tone mapping: ACES/AgX, exposure 0.95-1.15.
No universal gloss, mirror surfaces or harsh specular glare.

## 6. Materials

Tactile, readable materials: cloth, wood, stone, painted metal, glass, leather, soil, foliage, skin. Roughness 0.55-0.9
for almost everything (skin 0.6-0.7, cloth 0.8-0.95, painted metal 0.4-0.55, glass and water 0.05-0.2); metalness 0
except bare metal (0.8-1). Vary roughness ±0.1 between neighbouring objects of the same material so it feels authored,
not plastic. Flat colour per facet beats noisy textures; textures ≤ 2K. Procedural materials where they help
consistency.

## 7. Camera and composition

**Framing.** 16:9 (1920×1080) for long videos, 9:16 for Shorts (section 8). One clear focal subject; separate
foreground, subject, background. Subject's bounding box inside the safe area; nothing important within 5% of any edge.
The shot reads at phone size.

**Shot vocabulary with numbers** (elevation = camera pitch above the subject's eye line; Blender focal length on a
36 mm sensor; Three.js vertical FOV for 16:9 / 9:16):

| Shot | Elevation | Lens (Blender) | Three.js FOV 16:9 / 9:16 | Subject height in frame |
|---|---|---|---|---|
| Establishing wide | +25° to +40° (high three-quarter) | 28-35 mm | 38-45° / 55-62° | people ≥ 6% |
| Medium | +5° to +15° | 35-50 mm | 27-38° / 45-55° | person 45-70% |
| Close-up | 0° to +8° | 50-85 mm | 16-27° / 32-45° | face 25-45% |
| Overhead / elevated | +55° to +90° | 35 mm | 38° / 55° | systems, layout |
| Low angle (scale or power only) | -5° to -15° | 24-35 mm | 45° / 62° | ≥ 50% |
| POV | eye height 1.6 m | 24-28 mm | 45-50° / 62-68° | — |

Default azimuth is three-quarter: 25-45° off the subject's facing, never a dead-flat profile or straight-on unless
the shot is a deliberate reveal. Faces must be ≥ 36 px tall at 1080 p long-form and ≥ 48 px at 720×1280 Shorts
whenever a character's emotion is the point.

**Movement (per shot).**
- Default: locked-off or a slow push-in of 6-15% of the camera distance across the shot.
- Orbit ≤ 4° per second and ≤ 25° per shot. Pan ≤ 6° per second. Dolly/track ≤ 0.8 m per second at human scale.
- Every move eases in and out (smoothstep or ease-in-out cubic) over ≥ 0.5 s. No linear starts or stops.
- One motivated move per shot. No random orbiting, no constant drift on every shot.
- Handheld only for chaos after a disaster: rotation noise ≤ 0.4°, 0.5-1.5 Hz, position noise ≤ 1% of distance.
- The camera never enters a building, cloud, tree or character (check the last frame as well as the first).

## 8. Shorts (9:16)

**Frame:** render 1080×1920 for final upload, 720×1280 for the Three.js CPU path; every percentage below is of
frame width (x) or height (y) from the top-left.

**Safe zones** (YouTube Shorts UI plus the studio template):

| Zone | Area | What may go there |
|---|---|---|
| Top bar | y 0-12% | nothing important (search/camera icons) |
| Hook text | y 12-32%, x 6-84% | 2-4 words of hook text |
| Subject band | y 22-62%, x 8-84% | faces, evidence, the action |
| Captions | y 60-72% | burned-in captions (template) |
| Bottom | y 72-100% | set dressing only (title, channel, music UI) |
| Right rail | x 85-100% | set dressing only (like/comment/share buttons) |

**First second.**
- Frame 1 is the thumbnail in the feed: the hero subject, lit and readable, mean luma ≥ 95 (sombre ≥ 80). No fade
  from black, no title card, no logo, no empty sky.
- Something moves in the subject band by 0.5 s (a step, a turn, a reveal). A still frame for a whole second is a
  swipe.
- The first spoken line delivers the title's promise within 2 s (PACKAGING.md).

**Pacing.** A new visual event (cut, reveal, new action or a new object entering) at least every 3 s; shots 2-7 s.

**Portrait camera.** At the same distance a 9:16 camera sees about a third of the width of a 16:9 one: pull back
20-40%, or stage along the subject's long axis (a street running away from camera, a queue, a tower), not across it.

## 9. Characters, animation and the shared character kit

**Shared kit.** Every Short and video builds people from one kit so the channel has one face, one hand and one outfit
system: head is 1/6.5 of body height; eyes are two flat dark discs `#22252B` with catch-lights, spaced one eye-width
apart, at 45% of head height; brows are a single slab per side; mouth is a shallow wedge; hands are mitten-blocks
with a separate thumb (no individual fingers below close-up); outfits are 2-4 layered pieces in palette colours. Keep
the kit's code in one place per engine (Three.js `web/wbt_kit.js`, Blender `04_PIPELINES/shorts` character
builder) and extend it rather than writing new people per video.

**Recurring characters** (register here when a character appears in more than one shot or video, with exact colours):

| Character | Skin | Hair | Outfit | Accessories |
|---|---|---|---|---|
| Hachikō (Akita dog, test 22 Nov) | coat `#E9D3AE`, belly `#F7EEDD` | — | — | collar `#B65E48`; ears and tail dark tip `#A8703F` |
| Prof. Hidesaburō Ueno (test 22 Nov) | `#E0AE84` | `#1F1A17` | suit `#33363B`, shirt `#F6F1E7` | hat `#2E4566`, bag `#A8703F` |

**Motion.** Readable, purposeful, slightly stylized: anticipation, action, follow-through, settle. Body weight and
contact believable.
- Walk: stride length 0.65-0.8 m for an adult, cadence 1.6-2.0 steps per second; ground speed = stride × cadence, so
  planted feet never slide (≤ 2 cm drift per planted step).
- Held props are parented to the hand; they never float or slide through fingers.
- No limb or body intersections, no joint snaps, no idle loops that repeat inside 6 s.
- Nothing moves through furniture, walls or other people: give every walker a path that clears all set pieces by
  ≥ 0.3 m.
- Background people: subtle, varied activity only when it adds life.
- Motion timing follows narration and sound cues (word timings from Whisper/captions).

**Life in frame.** Every 3D shot has motion besides the camera (people, animals, water, smoke, traffic, leaves): at
least one moving element in the subject band at all times (lesson L-lifeless, the most common QC note).

## 10. Overlays, text and tone

Graphic-novel elements (map lines, markers, date cards, diagrams, cutaways, ink contours, halftone, shape
transitions, impact frames) are secondary tools, not a permanent filter.
- On-screen text: at most 6 words per 2 s on screen; labels ≥ 3.5% of frame height; ink `#1E2228` on paper `#FFF8EA`
  or the reverse, contrast ratio ≥ 4.5:1.
- Labels never cover faces, key actions or evidence, and never overlap each other (keep 1% of frame height between
  any two label boxes).
- Numbers appear on the frame where their word is spoken (±0.2 s), never before.
- No running counters for quantities that change between beats; show each value as a fixed card.

**Tone and sensitive subjects.**
- Visuals show the event, mechanism, consequence or human experience the narration describes; demonstration over
  decoration.
- Charm only where the subject allows. Tragedies and victims are never playful.
- **Deaths are implied, never shown:** an empty chair, a lowered flag, a figure walking away, a light going out. No
  bodies, blood, impacts on people or moments of death. Suffering is shown through the environment and the
  survivors.
- Distinguish reconstruction from archival footage. Never invent visual details that imply unsupported facts.

## 11. Thumbnails and title cards

- One subject, filling 35-60% of the frame height, on a background that contrasts with it by ΔL* ≥ 30 (lab
  lightness) or a complementary hue.
- At most 3 words of text (tighter than PACKAGING.md's 2-5), cap height ≥ 9% of the thumbnail height, ≤ 2 lines.
- Text never sits in the bottom-right 20% × 15% of a long-form thumbnail (YouTube's duration badge).
- No dark empty gradients; mean luma ≥ 100 (sombre ≥ 80); the subject is the most saturated thing in the frame.
- Shorts covers keep subject and text in the central 3:2 area; long thumbnails are 1280×720.
- The thumbnail shows something the video shows. Title cards inside videos follow the same rules.

## 12. Engine use

**Blender** for hero characters and bespoke models, prop and environment kits, rigging and authored animation,
simulations, lighting and look-development. **Three.js** for procedural environments, timeline-driven animation and
cameras, maps, labels, diagrams, browser previews and review tools, and assembly/rendering where it fits.

**Interchange.** GLB/glTF for runtime assets; apply transforms and check scale before export; validate normals,
materials, texture paths, rigs and clips in the receiving engine; do not assume shaders, modifiers or simulations
transfer; record baked effects and engine-specific replacements. Keep source assets and project material inside
`D:\BlenderWorkspace`.

## 13. Render budget (GTX 1650 Ti 4 GB, i7-10750H, 16 GB, laptop cooling)

| Engine | Use | Settings | Budget |
|---|---|---|---|
| Eevee | default for all animation | 1080p, render samples 32 (preview 8), shadow rays 1, steps 2, raytracing off, AO/GTAO on | ≤ 20 s per frame; a 7 s shot ≤ 70 min |
| Cycles (CUDA) | hero stills, shots ≤ 5 s | 64-128 samples, OpenImageDenoise, max bounces 4, light tree on | ≤ 60 s per frame |
| Three.js (SwiftShader CPU) | Shorts dioramas, maps, diagrams | 720×1280, MSAA 4, shadow map 2048 | ≤ 2 s per frame; a 7 s shot ≤ 8 min |

- VRAM ≤ 3.2 GB: instancing, textures ≤ 2K, decimated background assets. Simulations baked to `09_CACHE`.
- **One render job at a time on the laptop.** Every render goes through `09_CACHE\render_queue.txt` and the daemon
  (window 21:00-07:00 unless `render_until.txt` extends it). Never run a CPU Three.js render beside a Blender GPU job
  (the laptop shut down from heat on 11 and 22 Nov).
- Heat: wait for the GPU to cool to 72 °C before a chunk, render 2-3 frames per chunk, rest 40 s, abort a chunk at
  78 °C, 120 s rest between shots (60 s between Three.js shots).
- Render as resumable PNG/JPG sequences in chunks; when one thing changes, re-render only the chunks it touches.
- Cloud tests: a 20 s look test can render in a cloud container with the same Three.js version (0.186.1); that never
  touches the laptop's heat budget.

## 14. Preview and automatic QC

1. **Live preview first.** Open the Three.js page in a browser (`?shot=<id>&w=360&h=640`) and scrub it, or play the
   Blender viewport at Solid/Material preview. Write notes as `shot @ seconds: problem`. Fix, re-preview. Only render
   once the live version looks right.
2. **Stills sheet.** Render the first, middle and last frame of every shot (`still_sheet.ps1`) and look at all three.
3. **Numbers.** Run
   `python scripts/wbt_frame_qc.py frames <mp4-or-frame-dir> --profile short|long [--sombre] [--every 1.0]`.
   It checks section 5's exposure and colour targets and section 3A's empty-space limits on frame 1 and every sampled second and exits non-zero on a
   failure. Fix or record a deliberate exception in the shot plan.
4. **Human review.** Watch the whole thing at phone size with sound. Checklist:
   - *Style:* bright, polished, faceted low-poly? Palette from 4.2/4.3 only? Rich but not cluttered? Tone fits?
   - *Density (3A):* five layers present? Counts and empty-space numbers pass? Any unintended empty area?
   - *Composition:* focal subject obvious, in the safe zone, separated from background? Camera move motivated?
   - *Technical:* floating objects, clipping, intersections, broken shadows, sliding feet, scale errors? Characters and
     props consistent between shots? Labels readable and not overlapping? Synced to narration?
   - *Editorial:* does each shot add information or emotion? Factually responsible? Respectful? Does it cut
     coherently to the next?
5. **Edit list.** Before the final render, write a short edit list (cuts and reorders, no rebuilds) that moves the
   strongest moment to the first 2 s of a Short or the first 30 s of a long video.

## 15. Storytelling numbers
- Under every script paragraph, one line saying what the camera sees (place, subject, action, shot size).
- Show, don't tell: if a sentence can be shown, show it instead of writing it on screen.
- 3D covers ≥ 80% of the runtime of a long video and ≥ 75% of a studio Short (lesson L-low-3d-share).

## 16. Final creative test

A successful shot is instantly readable; colourful without being noisy; stylized without looking cheap; cinematic
without being dark by default; detailed without being cluttered; entertaining without sacrificing factual integrity —
and it passes section 14's numbers. The goal: a recognisable, bright, cinematic low-poly documentary world that viewers
want to spend time in.

## 17. Mistakes list (regression checks)

Every entry is a defect this channel actually shipped or nearly shipped. Check new work against all of them.
Add a row whenever a note repeats (section 18). Counts come from `05_REFERENCES\lessons.json` and reviews.

| ID | What went wrong | Rule now |
|---|---|---|
| M-01 | Juliane F02 looked right at frame 150 but opened dark, with the camera inside a cloud (21 Nov) | QC first, middle and last frame of every shot; frame 1 mean luma ≥ 95 |
| M-02 | Darvaza's "years burning" counter jumped 35/55/0/36 | No running counters across beats; fixed value cards (section 10) |
| M-03 | Kit people ~0.15 units tall: Carrington operator and Mincemeat officers knee-high to the desk | Rescale kits to metres; check against a 2 m door first |
| M-04 | Clones of GLB kit objects kept the kit's grid offset and landed in the wrong place | Reset `position` on every clone not placed with `put()` |
| M-05 | Procedural wood frog read as a hamster | Silhouette check against a photo before rendering any animal |
| M-06 | Glass started behind the nightstand top; camera ended inside a building (S01, S04) | Check first and last frame for intersections and camera inside geometry |
| M-07 | Characters blocked by palms and lamps in the sight line (S05) | Clear the line from camera to subject; nothing between them taller than 30% of the subject |
| M-08 | Subject cut off by the frame edge (10 notes, 3 jobs) | Subject's bounding box inside the safe zone on every frame of the move |
| M-09 | Little moves besides the camera (12 notes, 5 jobs) | One moving element in the subject band at all times (section 9) |
| M-10 | Picture showed the wrong subject (an arm, not a knife; a gun, not Lewis) (6 notes) | The noun the narration names is the largest thing in frame on that line |
| M-11 | Bare set or empty areas (4); subject floating in a void (1) | Ground plane and set dressing fill the frame; no empty background behind the subject |
| M-12 | Subject too small to read on a phone (3) | Section 7 subject-height and face-size minimums |
| M-13 | Subject hidden behind text or set pieces (2) | Labels and props clear of faces and evidence (sections 8, 10) |
| M-14 | Washed out: haze and bright ground flattened the contrast | Luma std ≥ 40; thin haze; darken ground albedo; keep one dark shape in every frame |
| M-15 | Subject too dark or poorly lit; dark navy look on every Short | Section 5 numbers; night is navy and moonlit, not black |
| M-16 | Captions ran words together ("THOUSANDPEOPLE") | Word gap ≥ 0.35 em after scaling; check the longest word in the script |
| M-17 | Numbers appeared before the narrator said them (338 m, 36,417) | Number on the frame of its spoken word ±0.2 s |
| M-18 | A stray red line crossed the frame and a heading was clipped in a transition | Check every transition's middle frame; no element cropped by the frame |
| M-19 | The same shot used twice (1) | No shot repeats in a video; reuse a set only with a new angle or action |
| M-20 | Too many words on screen for the time shown (1) | ≤ 6 words per 2 s |
| M-21 | Soundtrack clipped (2); sound effects too loud and all alike | Peaks ≤ -1 dBTP, loudness -14 LUFS; SFX 10-14 dB under the voice; no SFX reused within 20 s |
| M-22 | Laptop shut down from heat (11 Nov, 22 Nov) | Section 13: one job at a time, heat gates, no CPU render beside a GPU job |
| M-23 | 3D below the runtime target (6 jobs) | Section 15 minimums |
| M-25 | Style test (22 Nov): the hook card covered the heads of people stepping out of the doorway behind the subject | Check the card's box against every head on every frame, not just the hero's; tilt the camera up rather than move the card into the subject band |
| M-26 | Style test round 1: the cream dog sat on beige sandstone paving and blended in | Subject vs its background ΔL* ≥ 15 or a different hue (section 4.1); pick the ground colour after the subject |
| M-27 | Style test round 2: the high wide shot lost contrast (luma std 39) with soft fill on pale stone | On wides over pale ground, drop fill to ≤ 0.3 of the key and raise the key so shadows draw the shapes |
| M-28 | Style test rounds 1-2: environments read as a character, a floor and a few isolated objects; the winter plaza was a blank white field (largest empty patch 21%) | Section 3A: dressing plan, five layers, per-layer counts and the empty-space gate; on snow add tracks, a shovelled path, piles, paw prints |
| M-29 | Style test round 3: the new path check found walkers passing through planters, a lamp, a cart, ticket gates and a timetable, and vanishing into the back wall | Run the path check every render; move props or reroute; exits go through an opening |
| M-24 | (Known 3D failure modes) billboard trees and people turning with the camera; people walking through furniture | No sprites for solid objects (sprites only for smoke, sparks, mist); walker paths clear set pieces by 0.3 m |

## 18. Learning loop

1. Record each defect as `video / shot @ seconds: problem`.
2. Group repeated notes by root cause.
3. Fix the current scene.
4. If the same root cause appears twice (in one video or across videos), add or update a row in section 17 and, where
   possible, a check in `scripts/wbt_frame_qc.py` or the shared kit. Bump the minor version and date it.
5. Re-preview the affected shot and its neighbours.
6. One-off creative notes stay in the video's notes, not here.

Iterate new looks on a 20-second test, not a full film: watch, note, fix the skill, repeat 3-4 times. The reference
test lives in `test-scene/` (Hachikō at Shibuya Station, three 7 s shots; `wbt_kit.js` is the shared Three.js kit):
`npm i three@0.186.1 && node test-scene/render_test.mjs wbt_hachiko.js T01 out 0-210` renders a shot without the laptop.

## Changelog
- 1.2 (22 Nov 2026): environment density made mandatory and top priority (section 3A): five layers, written dressing
  plan, per-layer minimum counts by shot size, empty-space and path-clearance gates in the QC tools; M-28, M-29.
- 1.1.1 (22 Nov 2026): two lessons from the Hachikō test (subject-to-ground separation, contrast on high wides).
- 1.1 (22 Nov 2026): numbers for exposure, colour, lenses, camera moves, faces, facets, walking; Shorts section with
  safe zones and first-second hook; pinned default and sombre palettes; reference image location; thumbnails;
  render budget and heat rules; colour-blind rule; shared character kit; deaths implied, never shown; mistakes list
  seeded from 24 real defects; automatic frame QC script.
- 1.0 (22 Nov 2026): owner's original direction.
