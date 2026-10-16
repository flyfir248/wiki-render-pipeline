"""What the channel's own viewers respond to, read from YouTube Analytics retention curves.

Each uploaded video's scenes are kept in state.db (Uploads.outlines). For every video with enough
views, the curve of how many viewers are still watching is split at the scene boundaries, and each
scene is scored by how fast it lost viewers compared with the rest of its video. Averaged over many
videos, that says which scene types hold attention and which lose it, plus how well the openings of
Shorts keep people from swiping away. The summary goes into the script writer's instructions.
"""

from __future__ import annotations

import json
from collections import defaultdict
from datetime import datetime, timezone

from fyt import youtube
from fyt.config import Config
from fyt.store import Uploads

MIN_VIEWS = 50  # a curve from fewer views is mostly noise
MIN_SCENES = 5  # a scene type needs this many scored scenes before it counts
MAX_VIDEOS = 40  # most recent videos read per run (one Analytics query each)
CACHE_HOURS = 20  # curves are re-read at most about once a day

_lessons: dict[str, str] = {}


def _at(curve: list[tuple[float, float]], x: float) -> float:
    """The curve's value at elapsed fraction x, interpolated."""
    if not curve:
        return 0.0
    if x <= curve[0][0]:
        return curve[0][1]
    for (x0, y0), (x1, y1) in zip(curve, curve[1:]):
        if x0 <= x <= x1:
            return y0 + (y1 - y0) * ((x - x0) / (x1 - x0) if x1 > x0 else 0)
    return curve[-1][1]


def scene_losses(outline: dict, curve: list[tuple[float, float]]) -> list[tuple[str, float]]:
    """(scene type, relative loss) per scene: the share of viewers the scene lost per second,
    divided by the video's average. 1 is typical, 0.5 held twice as well, 2 lost twice as fast.
    The first scene is skipped; the opening is judged separately."""
    duration = outline["duration"]
    scenes = outline["scenes"]
    if not curve or duration <= 0 or len(scenes) < 3:
        return []
    start, end = _at(curve, scenes[1][1] / duration), _at(curve, min(1.0, scenes[-1][2] / duration))
    span = max(1.0, scenes[-1][2] - scenes[1][1])
    average = max(1e-4, (start - end) / span)  # share lost per second over the video
    out = []
    for kind, s, e in scenes[1:]:
        if e - s < 1.5:
            continue
        lost = _at(curve, s / duration) - _at(curve, min(1.0, e / duration))
        out.append((kind, max(0.0, lost / (e - s)) / average))
    return out


def opening_hold(outline: dict, curve: list[tuple[float, float]], seconds: float = 3.0) -> float | None:
    """Share of viewers still there a few seconds in (for Shorts, the swipe-away test).

    YouTube's curve is a watch ratio, not a head count: a Short that loops is watched more than once,
    so the curve can start above 1 and a raw reading said "122% still watching". Measured against the
    curve's own start, it is the share of the opening audience that stays, at most 100%."""
    if not curve or outline["duration"] <= seconds:
        return None
    first = curve[0][1]
    if first <= 0:
        return None
    return min(1.0, _at(curve, seconds / outline["duration"]) / first)


def _curves(uploads: Uploads, video_ids: list[str]) -> dict[str, list[tuple[float, float]]]:
    stamp = uploads.note("curves_read")
    cached = json.loads(uploads.note("curves") or "{}")
    fresh = stamp and (datetime.now(timezone.utc) - datetime.fromisoformat(stamp)).total_seconds() < CACHE_HOURS * 3600
    if fresh:
        return {v: [tuple(p) for p in cached[v]] for v in video_ids if v in cached}
    views = youtube.retention(video_ids)
    curves = {}
    for vid in video_ids:
        if views.get(vid, {}).get("views", 0) < MIN_VIEWS:
            continue
        try:
            curves[vid] = youtube.retention_curve(vid)
        except Exception as e:  # one bad video shouldn't stop the rest
            print(f"warning: no retention curve for {vid}: {e}")
    uploads.set_note("curves", json.dumps(curves))
    uploads.set_note("curves_read", datetime.now(timezone.utc).isoformat(timespec="seconds"))
    return curves


def summarise(outlines: dict[str, dict], curves: dict[str, list[tuple[float, float]]], fmt: str) -> str:
    by_type: dict[str, list[float]] = defaultdict(list)
    holds = []
    for vid, curve in curves.items():
        outline = outlines.get(vid)
        if not outline or outline.get("format") not in (fmt, None):
            continue
        for kind, loss in scene_losses(outline, curve):
            by_type[kind].append(loss)
        hold = opening_hold(outline, curve)
        if hold is not None:
            holds.append(hold)
    rated = sorted((sum(v) / len(v), k, len(v)) for k, v in by_type.items() if len(v) >= MIN_SCENES)
    lines = []
    if len(rated) >= 2:
        describe = lambda r: f"{r[1]} (lost viewers {abs(1 - r[0]) * 100:.0f}% {'slower' if r[0] < 1 else 'faster'} than average, {r[2]} scenes)"  # noqa: E731
        good = [describe(r) for r in rated if r[0] < 0.9]
        bad = [describe(r) for r in rated if r[0] > 1.1]
        if good:
            lines.append("Scene types that held viewers best (use them more): " + "; ".join(good) + ".")
        if bad:
            lines.append("Scene types that lost viewers fastest (use them less, or keep them short): " + "; ".join(bad) + ".")
    if fmt == "short" and len(holds) >= 5:
        lines.append(
            f"On average {sum(holds) / len(holds) * 100:.0f}% of viewers are still watching 3 seconds in. "
            "The opening line decides this: start on the most surprising concrete detail."
        )
    return "\n".join(lines)


def scene_lessons(cfg: Config) -> str:
    """Lessons for the script writer from the channel's watch-time curves, or "" without enough data
    or without Analytics access."""
    key = f"{cfg.jobs_path}:{cfg.format}"
    if key in _lessons:
        return _lessons[key]
    _lessons[key] = ""
    try:
        if not youtube.authorised() or not youtube.can_analyze():
            return ""
        uploads = Uploads(cfg)
        outlines = uploads.outlines()
        recent = [v for v in uploads.video_ids() if v in outlines][-MAX_VIDEOS:]
        if recent:
            _lessons[key] = summarise(outlines, _curves(uploads, recent), cfg.format)
    except Exception as e:  # lessons are a nice-to-have
        print(f"warning: could not read watch-time curves: {e}")
    return _lessons[key]
