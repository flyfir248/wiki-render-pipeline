"""The studio queue: hand-written scripts with prerendered Blender shots, published without anyone clicking.

The local Blender studio (D:\\BlenderWorkspace) renders a video's hero shots, then pushes the clips to
assets/blender/<name>/ and the script to content/studio/<format>/<name>.json (format = long or short).
`fill` gives the next empty slot of that format to the oldest queued script that is ready (its shot set
complete) and not made yet, ahead of the usual topic queue. Each script is made once: its topic,
`studio:<name>`, is recorded in the topic queue like any other.
"""

from __future__ import annotations

import json
from pathlib import Path

from fyt import blender
from fyt.models import Script

QUEUE = Path(__file__).resolve().parent.parent / "content" / "studio"
PREFIX = "studio:"


def topic_of(path: Path) -> str:
    return PREFIX + path.stem


def load(path: Path) -> Script:
    return Script.model_validate(json.loads(path.read_text(encoding="utf-8")))


def missing_shots(script: Script, root: Path | None = None) -> list[str]:
    """Clips the script's shot set names that aren't there yet (all of them when the set itself is missing)."""
    name = (script.journey or {}).get("blender") or script.blender
    if not name:
        return []
    m = blender.manifest(script, root)
    if not m:
        return [f"{name}/manifest.json"]
    d = (root or blender.ROOT) / name
    return [s["file"] for s in m["shots"] if not (d / s["file"]).exists()]


def ready(fmt: str, done: set[str], queue: Path | None = None, root: Path | None = None) -> list[Path]:
    """Queued scripts of this format that can be made now, oldest name first."""
    folder = (queue or QUEUE) / fmt
    if not folder.is_dir():
        return []
    out = []
    for path in sorted(folder.glob("*.json")):
        if topic_of(path) in done:
            continue
        try:
            script = load(path)
        except Exception as e:  # a broken file waits; the rest of the queue still runs
            print(f"::warning::studio script {path.name} doesn't load: {e}")
            continue
        missing = missing_shots(script, root)
        if missing:
            print(f"studio script {path.name} waits for its Blender shots: {missing}")
            continue
        out.append(path)
    return out


def make_one(cfg, topics, name: str):
    """Make one named studio script now, without uploading (a review render, e.g. a remake under a new name).
    Its topic is marked done, so the queue doesn't make it again; upload it with `fyt replace` or `fyt publish`."""
    from fyt import pipeline

    path = next((p for p in QUEUE.glob(f"*/{name}.json") if p.parent.name != "published"), None)
    if path is None:
        raise SystemExit(f"no studio script {name}.json in {QUEUE}")
    fmt = path.parent.name
    missing = missing_shots(load(path))
    if missing:
        print(f"warning: shots missing, those scenes fall back to photos: {missing}")
    topic = topic_of(path)
    topics.add([topic])
    topic_id, _ = topics.find(topic)
    topics.set(topic_id, "in_progress")
    visuals = cfg.visuals.model_copy(update={"plan": False})
    try:
        job = pipeline.make_video(cfg.model_copy(update={"format": fmt, "visuals": visuals}), topic, script=load(path), polish=False)
    except Exception:
        topics.set(topic_id, "failed")
        raise
    topics.set(topic_id, "done", job.id)
    print(f"made {job.id}: {job.meta.get('status')}")
    return job


def make_next(cfg, topics, fmt: str):
    """Make the next ready studio script of this format; None when the queue has nothing ready (or it failed)."""
    from fyt import pipeline

    done = {t for _, t, status, _ in topics.all() if t.startswith(PREFIX) and status in ("done", "in_progress", "failed")}
    paths = ready(fmt, done)
    if not paths:
        return None
    path = paths[0]
    topic = topic_of(path)
    topics.add([topic])
    topic_id, _ = topics.find(topic)
    topics.set(topic_id, "in_progress")
    print(f"studio queue: making {path.name} for the next {fmt} slot")
    try:
        # the Blender clips are the 3D: the runner's own 3D scenes would cost hours and outrun the job's time limit
        visuals = cfg.visuals.model_copy(update={"plan": False})
        job = pipeline.make_video(cfg.model_copy(update={"format": fmt, "visuals": visuals}), topic, script=load(path), polish=False)
    except Exception as e:
        topics.set(topic_id, "failed")
        print(f"::warning::studio script {path.name} failed: {e}")
        return None
    topics.set(topic_id, "done", job.id)
    return job
