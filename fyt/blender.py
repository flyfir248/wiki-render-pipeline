"""Prerendered Blender shots: hero 3D shots made in the local Blender studio, placed into a video.

A shot set lives in assets/blender/<name>/: the clips plus a manifest.json:

    {"fps": 30, "shots": [{"id": "G01", "file": "G01.mp4", "duration": 6.0, "from_m": 1.8, "to_m": 8.0}, ...]}

A journey script opts in with `"blender": "<name>"` in its `journey` block. Each shot covers the beats whose
`scale` falls inside its from_m..to_m range: the clip takes over the picture for those beats (slowed or
sped up to fit, within limits), while the readouts, landmark tags, narration line and voice carry on over
it. Where a clip runs out before its beats do, the three.js journey comes back underneath.

Any other hand-written script opts in with a top-level `"blender": "<name>"` and puts `"blender_shot": "<id>"`
on the scenes that show a clip: those scenes become full-frame video scenes (the What If clock, captions
and transitions stay on top).
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path

from fyt.models import Media, Script

ROOT = Path(__file__).resolve().parent.parent / "assets" / "blender"
MIN_RATE, MAX_RATE = 0.5, 1.25  # how far a clip may be slowed or sped up to fit its beats
FADE = 0.35  # seconds of cross-fade at each end of a clip
MIN_SECONDS = 1.0  # a clip squeezed shorter than this is left out


def manifest(script: Script, root: Path | None = None) -> dict | None:
    """The script's shot set, or None when it names none (or the set isn't there)."""
    name = (script.journey or {}).get("blender") or script.blender
    if not name:
        return None
    path = (root or ROOT) / name / "manifest.json"
    if not path.exists():
        return None
    data = json.loads(path.read_text())
    data["name"] = name
    return data


def stage(script: Script, public: Path, root: Path | None = None) -> list[str]:
    """Copy the script's clips into the job's public dir (public/blender/...); returns the files copied."""
    m = manifest(script, root)
    if not m:
        return []
    src_dir = (root or ROOT) / m["name"]
    out = public / "blender"
    out.mkdir(parents=True, exist_ok=True)
    copied = []
    for shot in m["shots"]:
        src = src_dir / shot["file"]
        if src.exists():
            shutil.copy2(src, out / shot["file"])
            copied.append(shot["file"])
    return copied


def thumbnail(script: Script, public: Path, root: Path | None = None) -> Media | None:
    """The set's thumbnail picture (its manifest's optional `thumbnail`), staged in the job's public dir."""
    m = manifest(script, root)
    src = (root or ROOT) / m["name"] / m["thumbnail"] if m and m.get("thumbnail") else None
    if src is None or not src.exists():
        return None
    out = public / "blender"
    out.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, out / src.name)
    return Media(src=f"blender/{src.name}", kind="image")


def scene_media(script: Script, root: Path | None = None) -> dict[int, Media]:
    """The clips of scenes that name a `blender_shot`, by scene index (only shots whose file is there)."""
    m = manifest(script, root)
    if not m:
        return {}
    src_dir = (root or ROOT) / m["name"]
    shots = {s["id"]: s for s in m["shots"] if (src_dir / s["file"]).exists()}
    return {i: Media(src=f"blender/{shots[s.blender_shot]['file']}", kind="video", seconds=shots[s.blender_shot].get("duration"))
            for i, s in enumerate(script.scenes) if s.blender_shot in shots}


def as_video_scenes(script: Script, media: dict[int, Media]) -> Script:
    """Scenes that got a clip are drawn as full-frame video (broll) scenes."""
    if not media:
        return script
    return script.model_copy(update={"scenes": [
        s.model_copy(update={"type": "broll", "camera": s.camera or "push_in"}) if i in media else s
        for i, s in enumerate(script.scenes)
    ]})


def segments(script: Script, starts: list[float], ends: list[float], first: int = 0,
             root: Path | None = None) -> list[dict]:
    """When each clip plays, in seconds from the video's start, and at what playback rate."""
    m = manifest(script, root)
    if not m:
        return []
    src_dir = (root or ROOT) / m["name"]
    out: list[dict] = []
    for shot in sorted(m["shots"], key=lambda s: s["from_m"]):
        if not (src_dir / shot["file"]).exists():
            continue
        beats = [i for i, s in enumerate(script.scenes)
                 if i >= first and s.scale and shot["from_m"] <= s.scale <= shot["to_m"]]
        if not beats:
            continue
        a, b = starts[beats[0]], ends[beats[-1]]
        if out and a < out[-1]["to"]:
            a = out[-1]["to"]  # never two clips at once
        span = b - a
        if span < MIN_SECONDS:
            continue
        rate = min(MAX_RATE, max(MIN_RATE, shot["duration"] / span))
        b = min(b, a + shot["duration"] / rate)  # a clip too short even when slowed hands back to the journey
        out.append({"id": shot.get("id"), "src": f"blender/{shot['file']}", "from": round(a, 3), "to": round(b, 3),
                    "rate": round(rate, 4), "fade": FADE})
    return out
