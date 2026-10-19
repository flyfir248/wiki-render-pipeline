"""The 3D quality benchmark: a fixed 8-second story-world clip rendered the same way every time, so a
change to the renderer can be judged against the last one before it reaches a video.

It covers what a story world has to do well: a wide establishing shot that pushes in, a cut on the
beat to a close setup, an animated subject (an airliner flying with a flock), reflective water and a
city in depth, and a transition between two scenes. The world is built by the rules from a fixed
manifest (no model, no keys), so only the renderer changes between runs.

    python -m fyt bench                 # renders jobs/bench/bench.mp4, contact.png, frames and report.json

report.json records the render time per frame and the look check (contrast, and the vision verdict
where a vision model is set up); keep the contact sheet next to the previous one to compare.
"""

from __future__ import annotations

import json
import os
import time
from pathlib import Path

from fyt import manifest, qcheck, render, sheet, worldgen
from fyt.config import Config
from fyt.models import RenderProps, Script, ScriptScene

SCENES = [
    ("Minutes after take-off from LaGuardia, the Airbus flew into a flock of Canada geese.", 4.5),
    ("The captain glided the jet down onto the Hudson River beside the city.", 3.5),
]


def story() -> tuple[Script, manifest.Manifest]:
    sc = Script(title="Benchmark: Miracle on the Hudson", description="benchmark", tags=[], thumbnail_text="x", thumbnail_kicker="x",
                thumbnail_query="x", sources=["benchmark"], mood="tense", scenes=[ScriptScene(type="statement", narration=n) for n, _ in SCENES])
    m = manifest.Manifest(
        entities=[
            manifest.Entity(id="jet", name="the Airbus A320", kind="airliner", search=["airbus a320"], look="white Airbus A320 airliner with grey belly and blue tail", certain=True, scenes=[1, 2]),
            manifest.Entity(id="geese", name="Canada geese", kind="bird", search=["canada goose"], look="Canada geese, black neck, white chin strap, brown body", certain=True, scenes=[1]),
        ],
        places=[
            manifest.Place(id="sky", name="sky over New York", look="cold January sky above the Bronx", scenes=[1]),
            manifest.Place(id="hudson", name="Hudson River", look="grey Hudson River in winter, Manhattan skyline", scenes=[2]),
        ],
        moments=[
            manifest.Moment(scene=1, entity="jet", place="sky", action="hits the geese", motion="move", cue="flew into a flock", documented=True),
            manifest.Moment(scene=2, entity="jet", place="hudson", action="glides down to the river", motion="move", cue="glided the jet down", documented=True),
        ],
    )
    return sc, m


def props_for(cfg: Config) -> dict:
    sc, m = story()
    ids = [e.id for e in m.entities]
    # the rules alone design it (the model's key is hidden for the call), so only the renderer varies
    key = cfg.llm.api_key_env
    saved = os.environ.pop(key, None)
    try:
        _, builds, settings, _ = worldgen.design(cfg, sc, m, ids, log=lambda x: None)
        shots, _ = worldgen.direct(cfg, sc, m, builds, [1, 2], log=lambda x: None)
    finally:
        if saved is not None:
            os.environ[key] = saved
    scenes, t = [], 0.0
    for i, k in enumerate(sorted(shots)):
        w = worldgen.world_of("noir", 7, shots[k], builds, settings, {})
        secs = SCENES[i][1]
        scenes.append({"id": f"s{k}", "type": "world", "start": t, "end": t + secs, "heading": None, "subject": "stage", "variant": "model",
                       "action": "move", "shot": "side", "setting": None, "label": "RECONSTRUCTION", "effectAt": 0.5, "seed": 7,
                       "subjectName": shots[k].actors[0].entity, "world": w})
        t += secs
    return {"format": "short", "fps": 30, "title": "bench", "duration": t, "theme": cfg.theme.model_dump(), "voice": None, "music": None, "sfx": None,
            "scenes": scenes, "captions": [], "showCaptions": False, "showVisualizer": False, "badge": None, "subscribe": None, "endCard": 0}


def run(cfg: Config, out: Path) -> dict:
    cfg = cfg.model_copy(deep=True)
    cfg.format = "short"
    out = out.resolve()  # the renderer runs from its own folder
    out.mkdir(parents=True, exist_ok=True)
    (out / "public").mkdir(exist_ok=True)
    props = props_for(cfg)
    (out / "props.json").write_text(json.dumps(props, indent=1))
    started = time.time()
    video = render.render(out / "props.json", out / "public", out / "bench.mp4")
    took = time.time() - started
    frames = round(props["duration"] * props["fps"])
    sheet.contact_sheet(video, out / "contact.png", every=0.5)
    sc, _ = story()
    rp = RenderProps.model_validate(props)
    script = sc.model_copy(update={"scenes": [s.model_copy(update={"type": "world"}) for s in sc.scenes]})
    look = qcheck.look_check(cfg, script, rp, video, out / "look")
    report = {"seconds": round(took, 1), "frames": frames, "seconds_per_frame": round(took / max(1, frames), 2),
              "look_warnings": look.warnings, "look_frames": look.checks.get("look_frames", [])}
    (out / "report.json").write_text(json.dumps(report, indent=2))
    return report
