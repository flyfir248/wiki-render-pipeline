"""The story-relevance gate: every 3D scene must show what the story is about, before the video renders.

A renderer being available is never a reason for its subject to appear. Each 3D scene (a catalog
module's or the stage's) passes two checks, and one that fails goes back to its 2D scene, which the
storyboard then paints:

1. text: it shows an entity the story's manifest lists in that scene (fyt.manifest), the same entity
   its other scenes show; an event it acts out rests on words in its narration (fyt.scenes3d.guard);
2. picture: a frame at its key moment is rendered and a free vision model is asked whether it shows
   that entity, recognisably, in a believable state (not floating, broken, cut off or blank).

The verdicts are written to the job's relevance.json.
"""

from __future__ import annotations

import json
from pathlib import Path

from fyt import assetlib, manifest, render, storyboard
from fyt.config import Config
from fyt.manifest import Manifest
from fyt.models import Script

FRAME = """You check a frame of a documentary video before it is published. It is a 3D scene meant to show
the subject below while the narrator says the line given. Pass it only if the frame clearly shows
that subject, recognisable as that kind of thing, and nothing about it is broken: not floating in
the air when it should stand, not cut off or hidden, not inside-out, black or blank. A simple or
stylised look is fine, and so is a missing detail: judge only what a picture can show (what kind of
thing it is and its rough shape), never makes, models, markings, exact colours, numbers, times or
decisions the narrator mentions. A named subject (a ship, a person, a place with a name) passes when
the frame shows that kind of thing: no picture can show which ship or which man it is, or its era.
Fail it if it shows something else, or nothing recognisable.
Reply with a single JSON object: {"matches": true or false, "problems": "at most 12 words, or empty"}."""


def is_3d(scene) -> bool:
    return scene.type == "world"


def subject_text(scene, story: Manifest | None) -> str:
    e = manifest.entity(story, scene.subject_name) if story else None
    if e:
        return f"{e.name}, a {e.kind} ({e.look})"
    return f"{scene.variant or ''} {scene.subject or ''}".strip()


def text_gate(script: Script, story: Manifest | None) -> dict[int, str]:
    """{scene index: why} for 3D scenes that don't show something the story lists in that scene."""
    if story is None:
        return {}
    bad = {}
    for i, s in enumerate(script.scenes):
        if not is_3d(s):
            continue
        e = manifest.entity(story, s.subject_name)
        p = manifest.place(story, s.subject_name)
        if e is None and p is None:
            bad[i] = f"shows {s.subject} '{s.subject_name}', which the story's manifest doesn't list"
        elif e is not None and (i + 1) not in e.scenes:
            bad[i] = f"{e.name} is not in this scene's narration"
    return bad


def key_frames(props, script: Script) -> dict[int, int]:
    """{scene index: frame} at each 3D scene's key moment."""
    out = {}
    for i, (s, r) in enumerate(zip(script.scenes, props.scenes)):
        if is_3d(s):
            at = r.effectAt if r.effectAt is not None else 0.45
            out[i] = int(round((r.start + max(0.15, min(0.85, at)) * (r.end - r.start)) * props.fps))
    return out


def picture_gate(cfg: Config, script: Script, story: Manifest | None, props, props_json: Path, public: Path, work: Path, log=print) -> dict[int, str]:
    """{scene index: why} for 3D scenes whose key frame doesn't show their subject. Scenes are passed
    when no check can be made (no vision model, a render error), with a log line saying so."""
    frames = key_frames(props, script)
    if not frames:
        return {}
    try:
        files = render.frames(props_json, public, work, list(frames.values()))
    except Exception as e:
        log(f"relevance: could not render the 3D key frames ({str(e)[:120]}); not checked by eye")
        return {}
    bad = {}
    for (i, _), file in zip(frames.items(), files):
        s = script.scenes[i]
        meant = f"{subject_text(s, story)}. The narrator says: \"{s.narration[:200]}\""
        v = storyboard.review(cfg, file, meant, rules=FRAME) if file.is_file() else None
        if v is None:
            continue
        if not v.matches:
            bad[i] = f"frame check: {v.problems or 'does not show the subject'}"
    return bad


def apply(script: Script, bad: dict[int, str]) -> Script:
    scenes = list(script.scenes)
    for i in bad:
        scenes[i] = assetlib.back_to_2d(scenes[i])
    return script.model_copy(update={"scenes": scenes})


def dumps(text: dict[int, str], picture: dict[int, str], checked: list[int]) -> str:
    return json.dumps({
        "checked": [i + 1 for i in checked],
        "failed_text": {str(i + 1): why for i, why in text.items()},
        "failed_picture": {str(i + 1): why for i, why in picture.items()},
    }, indent=2)
