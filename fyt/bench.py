"""The quality benchmark reel: six fixed scenes rendered the same way every time, so a change to the
renderer can be judged against the last one before it reaches a video.

"It rendered without errors" is not the bar. Each scene tests something a real video needs, and each
run keeps what a person (or a vision model) needs to score it side by side with the last run:

| Scene      | Tests                                                                 |
|------------|-----------------------------------------------------------------------|
| gimli      | an airliner gliding down to land: flight path, banking, camera tracking, ground at speed |
| voyager    | a probe in deep space: scale, space lighting, a data-driven subject   |
| ghost-army | a 1944 campaign map, then soldiers with an inflatable tank in a field: borders, routes, map-to-3D, people acting |
| krakatoa   | a volcano erupting: smoke, ash, fire, particles, atmosphere           |
| london     | a historic city burning: buildings in depth, fire spreading           |
| storm      | a liner in a storm: water, weather, lighting                          |

Every scene is built through the production code (fixed script and manifest, model calls switched off,
so only the renderer changes between runs): `assets.resolve` for catalog subjects, the pipeline's own
story-world step for the stage scene, `timeline.build_props` for the props, the same sound effects and
music choice as a video.

    python -m fyt bench                         # all six, 16:9, into jobs/bench/<commit>/
    python -m fyt bench --only gimli,krakatoa   # some of them
    python -m fyt bench --format short          # 9:16

Each run folder holds, per scene, `<name>/clip.mp4`, `<name>/contact.png` (a frame a second) and
`<name>/props.json`; for the run, `reel.mp4`, `reel.png` (one row per scene), `report.json` (render
seconds per frame, loudness, motion QA findings, frozen stretches) and `scores.md`, the scoring sheet:
ten criteria from 1 to 5 per scene. A renderer change is merged only when no scene scores lower.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import time
from dataclasses import dataclass, field
from pathlib import Path

from PIL import Image, ImageDraw

from fyt import artdirect, assets, manifest, media, qa, render, sfx, sheet, timeline
from fyt.config import ROOT, Config
from fyt.models import Place, Script, ScriptScene
from fyt.store import Job

CRITERIA = [
    "Composition and visual hierarchy",
    "Environment richness",
    "Material quality",
    "Lighting and shadows",
    "Animation smoothness",
    "Camera movement",
    "Physical and historical plausibility",
    "Typography and readability",
    "Audio synchronisation",
    "Frame-to-frame consistency",
]


@dataclass
class Bench:
    name: str
    title: str
    tests: str
    scenes: list[tuple[ScriptScene, float]]  # each scene and how long it is on screen, in seconds
    story: manifest.Manifest | None = None  # for a stage scene: who and what it shows
    mood: str = "tense"
    notes: list[str] = field(default_factory=list)


def _world(narration: str, **kw) -> ScriptScene:
    return ScriptScene(type="world", narration=narration, illustrative=False, **kw)


def benches() -> list[Bench]:
    ghost = manifest.Manifest(
        entities=[
            manifest.Entity(id="tank", name="the inflatable Sherman tank", kind="inflatable tank", search=["sherman tank", "tank"],
                            look="olive drab rubber M4 Sherman tank decoy, life size, slightly soft edges", certain=True, scenes=[2]),
            manifest.Entity(id="soldiers", name="Ghost Army soldiers", kind="person", search=["soldier"],
                            look="American soldiers in 1944 olive drab uniforms and M1 helmets", certain=True, scenes=[2]),
        ],
        places=[manifest.Place(id="field", name="a field in France", look="summer farmland in northern France, hedgerows, 1944", scenes=[2])],
        moments=[manifest.Moment(scene=2, entity="soldiers", place="field", action="pump up the rubber tank", motion="present",
                                 cue="pumped up a rubber Sherman tank", documented=True, priority=1)],
    )
    return [
        Bench("gimli", "Benchmark: the Gimli Glider", "aircraft: flight path, banking, camera tracking, ground at speed", [
            (_world("Out of fuel and with both engines dead, the Boeing 767 glided down onto the old runway at Gimli.",
                    subject="aircraft", variant="airliner", action="land", shot="chase", subject_name="Air Canada Flight 143"), 10.0)]),
        Bench("voyager", "Benchmark: Voyager 1, one light-day out", "space: scale, lighting, a data-driven subject", [
            (_world("Voyager 1 is now almost one light-day from Earth, and it is still drifting outward.",
                    subject="space", variant="probe", action="flyby", subject_name="Voyager 1"), 10.0)], mood="curious"),
        Bench("ghost-army", "Benchmark: the Ghost Army", "map: 1944 borders and a route; then 3D people and a decoy", [
            (ScriptScene(type="map", narration="In 1944 the Ghost Army followed the Allied advance from Normandy towards the Rhine.",
                         heading="The Ghost Army, 1944", places=[Place(name="Normandy", lat=49.37, lon=-0.88), Place(name="Brest", lat=48.39, lon=-4.49),
                                                               Place(name="Luxembourg", lat=49.61, lon=6.13), Place(name="Viersen", lat=51.26, lon=6.39)],
                         route=True, vehicle="army", regions=["France", "Germany"], year_from=1944, year_to=1945), 5.0),
            (_world("In a French field, soldiers of the Ghost Army pumped up a rubber Sherman tank.", subject="stage", variant="model",
                    action="present", subject_name="soldiers"), 7.0)], story=ghost,
            notes=["The map draws today's borders; a 1944 map needs dated border data (Stage 2)."]),
        Bench("krakatoa", "Benchmark: Krakatoa erupts", "natural phenomenon: smoke, ash, fire, particles, atmosphere", [
            (_world("In August 1883 Krakatoa erupted, blasting ash and rock high into the sky.",
                    subject="landscape", variant="volcano", action="erupt", subject_name="Krakatoa"), 10.0)]),
        Bench("london", "Benchmark: the Great Fire of London", "historic city: buildings in depth, fire spreading", [
            (_world("In September 1666 fire swept through the timber houses of the City of London.",
                    subject="city", variant="historic", action="fire", subject_name="London"), 10.0)], mood="somber"),
        Bench("storm", "Benchmark: a liner in a storm", "ocean: water, weather, reflections, lighting", [
            (_world("The liner ploughed on through the storm, rolling in the heavy sea.",
                    subject="ship", variant="liner", action="sail", weather="storm", shot="side", subject_name="the liner"), 10.0)]),
    ]


def _script(b: Bench) -> Script:
    return Script(title=b.title, description="benchmark", tags=[], thumbnail_text="x", thumbnail_kicker="x", thumbnail_query="x",
                  sources=["benchmark"], mood=b.mood, scenes=[s for s, _ in b.scenes])


def _stage(cfg: Config, job: Job, script: Script, story: manifest.Manifest) -> Script:
    """The stage scenes' story worlds, by the pipeline's own step, designed by the rules alone (the model's
    key is hidden for the call) so a run depends only on the renderer."""
    from fyt import pipeline

    key = cfg.llm.api_key_env
    saved = os.environ.pop(key, None)
    try:
        script, back = pipeline.story_worlds(cfg, job, script, story, {}, {})
    finally:
        if saved is not None:
            os.environ[key] = saved
    if back:
        raise RuntimeError(f"benchmark stage scenes {back} could not be built")
    return script


def props_for(cfg: Config, b: Bench, folder: Path) -> dict:
    job = Job(folder)
    job.public.mkdir(parents=True, exist_ok=True)
    script = assets.resolve(_script(b))
    if b.story is not None:
        script = _stage(cfg, job, script, b.story)
    missing = assets.stage(script, job.public)
    if missing:
        script = script.model_copy(update={"scenes": [
            s.model_copy(update={"model": assets.generic(s), "label": assets.label(s, assets.generic(s))}) if (s.model or {}).get("src") in missing else s
            for s in script.scenes]})
    spans, t = [], 0.0
    for _, secs in b.scenes:
        spans.append((t, t + secs))
        t += secs
    effects = sfx.write_all(job.public) if cfg.sound_effects else None
    music = media.pick_music(cfg, job.public, seconds=t + 2, seed=7, mood=b.mood)
    look = artdirect.choose(script) if cfg.visuals.art_direction else None
    props = timeline.build_props(cfg, script, spans, [[] for _ in spans], {}, None, music, effects, look=look)
    # no voice, so no tail or end card: the clip is exactly its scenes
    last = props.scenes[-1].model_copy(update={"end": round(t, 3)})
    props = props.model_copy(update={"duration": round(t, 3), "showCaptions": False, "endCard": 0, "scenes": [*props.scenes[:-1], last]})
    return props.model_dump(mode="json")


def loudness(video: Path) -> dict:
    """Integrated loudness (LUFS) and true peak (dBTP) of the clip's sound, by ffmpeg's EBU R128 meter."""
    done = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(video), "-af", "ebur128=peak=true", "-f", "null", "-"],
                          capture_output=True, text=True)
    tail = done.stderr[done.stderr.rfind("Summary:"):]
    i = re.search(r"I:\s+(-?[\d.]+) LUFS", tail)
    p = re.search(r"Peak:\s+(-?[\d.]+|-inf) dBFS", tail)
    return {"lufs": float(i.group(1)) if i else None, "true_peak_dbtp": float(p.group(1)) if p and p.group(1) != "-inf" else None}


def commit() -> str:
    try:
        return subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip()
    except Exception:
        return "local"


def _reel_sheet(rows: list[tuple[str, Path]], out: Path, per_row: int = 6) -> Path:
    """One row per scene: its name and frames spread evenly across the clip."""
    strips = []
    for name, video in rows:
        dur = qa.media_duration(video) or 1.0
        times = [dur * (k + 0.5) / per_row for k in range(per_row)]
        into = out.parent / "_reel" / name
        into.mkdir(parents=True, exist_ok=True)
        shots = sheet.from_video(video, times, into)
        imgs = [Image.open(p).convert("RGB") for _, p in shots]
        w = 480
        h = round(w * imgs[0].height / imgs[0].width) if imgs else 270
        strip = Image.new("RGB", (w * per_row, h + 28), (16, 18, 24))
        ImageDraw.Draw(strip).text((8, 6), name, fill=(235, 235, 235))
        for k, im in enumerate(imgs):
            strip.paste(im.resize((w, h)), (k * w, 28))
        strips.append(strip)
    sheet_img = Image.new("RGB", (max(s.width for s in strips), sum(s.height for s in strips)), (16, 18, 24))
    y = 0
    for s in strips:
        sheet_img.paste(s, (0, y))
        y += s.height
    sheet_img.save(out)
    return out


def _concat(videos: list[Path], out: Path) -> Path:
    lst = out.with_suffix(".txt")
    lst.write_text("".join(f"file '{v.resolve()}'\n" for v in videos))
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(lst), "-c", "copy", str(out)], check=True)
    lst.unlink()
    return out


def scores_sheet(run: str, report: dict) -> str:
    lines = [f"# Benchmark scores: {run}", "",
             "Score each scene 1 (poor) to 5 (broadcast quality) per criterion, watching the clip at normal speed and the",
             "contact sheet side by side with the previous run. A change merges only if no scene's total drops.", ""]
    for name, r in report["scenes"].items():
        lines += [f"## {name}: {r['tests']}", "",
                  f"Render {r['seconds_per_frame']} s/frame · loudness {r['loudness']['lufs']} LUFS · "
                  f"motion findings {len(r['motion'])} · frozen stretches {len(r['frozen'])}", ""]
        lines += [f"- {n}" for n in r.get("notes", [])] + ([""] if r.get("notes") else [])
        lines += ["| Criterion | Score | Note |", "| --- | --- | --- |"] + [f"| {c} |  |  |" for c in CRITERIA] + ["| **Total** |  |  |", ""]
    return "\n".join(lines)


def run(cfg: Config, out: Path, only: list[str] | None = None) -> dict:
    cfg = cfg.model_copy(deep=True)
    sha = commit()
    root = (out / sha).resolve()  # the renderer runs from its own folder
    root.mkdir(parents=True, exist_ok=True)
    chosen = [b for b in benches() if not only or b.name in only]
    if only and len(chosen) != len(only):
        raise SystemExit(f"unknown benchmark scene: {sorted(set(only) - {b.name for b in benches()})}; choose from {[b.name for b in benches()]}")
    report: dict = {"commit": sha, "format": cfg.format, "scenes": {}}
    clips = []
    for b in chosen:
        folder = root / b.name
        props = props_for(cfg, b, folder)
        (folder / "props.json").write_text(json.dumps(props, indent=1))
        started = time.time()
        # not mastered: with no narrator, mastering would only turn the music up (videos are mastered in the pipeline)
        video = render.render(folder / "props.json", folder / "public", folder / "clip.mp4")
        took = time.time() - started
        frames = round(props["duration"] * props["fps"])
        sheet.contact_sheet(video, folder / "contact.png", every=1.0)
        report["scenes"][b.name] = {
            "tests": b.tests,
            "notes": b.notes,
            "seconds": round(took, 1),
            "frames": frames,
            "seconds_per_frame": round(took / max(1, frames), 2),
            "loudness": loudness(video),
            "motion": render.motion_check(folder / "props.json"),
            "frozen": qa.static_spans(video, min_seconds=2.0),
            "labels": [s.get("label") for s in props["scenes"]],
        }
        clips.append((b.name, video))
        print(f"bench {b.name}: {report['scenes'][b.name]['seconds_per_frame']} s/frame", flush=True)
    if clips:
        _concat([v for _, v in clips], root / "reel.mp4")
        _reel_sheet(clips, root / "reel.png")
    report["total_seconds"] = round(sum(r["seconds"] for r in report["scenes"].values()), 1)
    (root / "report.json").write_text(json.dumps(report, indent=2))
    (root / "scores.md").write_text(scores_sheet(sha, report))
    return report


def compare(before: Path, after: Path, out: Path, per_row: int = 4) -> Path:
    """Two runs side by side, scene by scene: each scene's frames from the earlier run above the same
    moments from the later one, so a change can be judged at a glance (the clips still need watching)."""
    rows = []
    for name in [b.name for b in benches()]:
        for label, run_dir in ((f"{name} · before ({before.name})", before), (f"{name} · after ({after.name})", after)):
            clip = run_dir / name / "clip.mp4"
            if clip.exists():
                rows.append((label, clip))
    return _reel_sheet(rows, out, per_row=per_row)
