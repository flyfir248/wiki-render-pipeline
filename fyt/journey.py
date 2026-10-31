"""Scale journeys: a What If video told as one unbroken camera move, from your street to the edge of
what can be seen.

A journey script's scenes are beats of type `journey`. Each beat may set `scale` (the measure, in metres,
by the end of the beat: how tall you are, how far you have gone), a `landmark` passed at that scale
with a short `landmark_note`, and a second readout (`gauge`, with its `gauge_label`) that the story
brings in when the first one stops being enough. The script's `journey` block names the measure
("YOUR HEIGHT") and whether the first beat is a cold open showing where the journey ends.

`build()` turns the beats and their voiced spans into the renderer's `journey` props: L (log10 metres)
over time, with beats that set no scale filled in so the camera never stops, the landmarks, the second
readout's changes, the title and the cold open. renderer/src/journey/ draws the rest.
"""

from __future__ import annotations

import math
import zlib

from fyt.models import Script

MIN_BEATS = 12


def is_journey(script: Script) -> bool:
    return bool(script.journey) and any(s.type == "journey" for s in script.scenes)


def _levels(script: Script, first: int) -> list[float | None]:
    return [math.log10(s.scale) if s.scale and s.scale > 0 and i >= first else None for i, s in enumerate(script.scenes)]


def build(script: Script, spans: list[tuple[float, float]]) -> dict:
    """The renderer's journey props for a journey script voiced into `spans` (one per scene)."""
    cfg = script.journey or {}
    cold = bool(cfg.get("cold_open")) and len(script.scenes) > 1
    first = 1 if cold else 0
    # when each beat's picture starts and ends: a scene stays up until the next one starts
    starts = [0.0] + [spans[i][0] for i in range(1, len(spans))]
    ends = [spans[i + 1][0] if i + 1 < len(spans) else spans[i][1] for i in range(len(spans))]
    levels = _levels(script, first)
    known = [(ends[i], lv) for i, lv in enumerate(levels) if lv is not None]
    if not known:
        raise ValueError("a journey needs at least one beat with a scale")
    keys = [{"t": round(starts[first], 3), "L": round(known[0][1] if levels[first] is None else min(levels[first], known[0][1]), 4)}]
    # the first beat starts a little below its own scale, so the journey is already moving
    if levels[first] is not None:
        keys[0]["L"] = round(levels[first] - 0.05, 4)
    for t, lv in known:
        if t > keys[-1]["t"] + 1e-3:
            keys.append({"t": round(t, 3), "L": round(max(lv, keys[-1]["L"]), 4)})
    # the last key holds to the end so the camera doesn't stop dead on the last word
    marks = [
        {"name": s.landmark, "note": s.landmark_note or None, "L": round(levels[i], 4)}
        for i, s in enumerate(script.scenes) if s.landmark and levels[i] is not None
    ]
    gauges, label = [], ""
    for i, s in enumerate(script.scenes):
        if i < first or not s.gauge:
            continue
        label = s.gauge_label or label or "TIME"
        gauges.append({"t": round(starts[i] + 0.2, 3), "label": label.upper(), "text": s.gauge})
    title_at = first
    return {
        "measure": (cfg.get("measure") or "YOUR HEIGHT").upper(),
        "keys": keys,
        "marks": sorted(marks, key=lambda m: m["L"]),
        "gauges": gauges,
        "title": {"text": script.title, "from": round(starts[title_at], 3), "to": round(ends[title_at], 3)},
        "coldOpen": round(ends[0], 3) if cold else 0,
        "seed": zlib.crc32(script.title.encode()) & 0x7FFFFFFF,
    }


def problems(script: Script) -> list[str]:
    """What keeps a journey script from working."""
    out = []
    beats = [s for s in script.scenes if s.type == "journey"]
    if len(beats) < MIN_BEATS:
        out.append(f"a journey needs at least {MIN_BEATS} beats; this one has {len(beats)}")
    first = 1 if (script.journey or {}).get("cold_open") else 0
    levels = [lv for lv in _levels(script, first) if lv is not None]
    if any(b < a - 1e-9 for a, b in zip(levels, levels[1:])):
        out.append("the scale goes backwards between beats")
    if levels and levels[-1] - levels[0] < 3:
        out.append("the journey covers less than a factor of 1,000 in scale")
    long_lines = [i + 1 for i, s in enumerate(beats) if len(s.narration.split()) > 22]
    if long_lines:
        out.append(f"beats {long_lines[:5]} run over 22 words; a journey line is one short sentence or two")
    return out
