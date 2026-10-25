"""The 3D coverage report: how much of a finished video tells its story in 3D, and how much of that 3D
actually moves (coverage.json and coverage.md beside the video).

For every scene: how long it plays, how it is drawn (3D, 2.5D, 2D), and for a 3D scene the four layers
of motion: the subject's own action (a verb that moves it, or a beat that changes it), secondary motion
(a found model's own animation, turning wheels and propellers, a group moving with it), the place moving
around it (water, weather, drifting cells or clouds, birds over an outdoor set) and the camera move. A
3D scene counts as animated only when its subject or its place moves (water, weather; birds crossing far
off don't count): a camera drifting round a figure that stands still does not. It also notes whether the scene shows one of the story's own entities with
a library model or a generated build, and flags static scenes and repeats (the same subject doing the
same thing, filmed the same way, in the same place as a scene before).

With the video, each 3D scene's picture is also measured: how much the frame changes between three
moments of it, on the band where the action is (proof it was not frozen), and the two render scores of
fyt/inspect3d.py, kept apart: how rich the place looks, and how much moves inside the picture beyond the
camera's own move.

The totals set against the target share (`visuals.world_share_*`) become quality warnings: they never
hold a video.
"""

from __future__ import annotations

import json
from pathlib import Path

from fyt import inspect3d, visualplan
from fyt.models import RenderProps, Script

# Verbs that leave a subject where it is, doing nothing a viewer reads as action.
STILL_VERBS = {"idle", "present", "sit", "lie", "sleep", "talk", "phone", "glow"}
# Kinds of place that move by themselves (water, flow, clouds), and outdoor kinds that get birds by day.
MOVING_SETS = {"sea", "lake", "river", "beach", "swamp", "marsh", "underwater", "micro", "sky"}
INDOOR_OR_VOID = {"room", "hall", "lab", "hospital", "cave", "factory", "shop", "station", "space", "micro", "sky", "underwater"}
MODULE_STILL = {"present"}


def _layers(scene, render) -> dict:
    """The motion layers of one 3D scene, from what the renderer is told to draw."""
    w = render.world or {}
    if w:
        cast = w.get("cast", [])
        lead = next((a for a in cast if a.get("entity") == w.get("on")), cast[0] if cast else {})
        verbs = [lead.get("verb", "present")] + [a.get("verb", "") for bt in w.get("beats", []) for a in bt.get("cast", []) if a.get("entity") == lead.get("entity")]
        acts = (w.get("direction") or {}).get("acts", {})
        # a gesture the scene director gave the subject (raising a camera, pointing) is its action too
        subject = next((v for v in verbs if v and v not in STILL_VERBS), "") or (acts.get(lead.get("entity", ""), {}).get("gesture") or "")
        m = lead.get("model") or {}
        parts = (lead.get("build") or {}).get("parts", [])
        secondary = [x for x, ok in (
            ("its own animation", bool(m.get("clips")) and subject != ""),
            ("turning parts", any(p.get("spin") for p in parts) and subject != ""),
            ("others moving", any(a.get("verb") not in STILL_VERBS for a in cast if a is not lead)),
            ("looks and reactions", any(a.get("look") or a.get("secondary") for a in acts.values())),
        ) if ok]
        recipe = (w.get("direction") or {}).get("recipe") or {}
        st = w.get("set", {})
        kind, time = st.get("kind", ""), st.get("time", "day")
        env = [x for x, ok in (
            ("water or flow", kind in MOVING_SETS),
            ("weather", bool(scene.weather)),
            ("birds overhead", kind not in INDOOR_OR_VOID and time != "night"),
            ("wind in the vegetation", recipe.get("wind", 0) >= 0.3 and bool(set(recipe.get("fore", []) + recipe.get("mid", [])) & {"reeds", "grass", "ferns", "flowers", "scrub"})),
            ("drifting mist", recipe.get("mist", 0) >= 0.2),
            ("particles", recipe.get("particles", "none") not in ("", "none")),
        ) if ok]
        shots = [x.get("move", "") for x in (w.get("direction") or {}).get("shots", [])]
        return {"subject": subject, "secondary": secondary, "environment": env, "camera": "/".join(shots) or w.get("camera", ""),
                "lead": lead.get("entity", ""), "place": st.get("place", "") or kind, "set": kind,
                "asset": "library model" if m.get("src") else "generated build" if lead else "", "matched": bool(lead)}
    # a catalog module (an airliner, a ship, a rocket): its action is its motion
    moving = (scene.action or "present") not in MODULE_STILL
    return {"subject": scene.action if moving else "", "secondary": ["turning parts"] if moving and scene.subject in ("aircraft", "vehicle", "train") else [],
            "environment": ["weather"] if scene.weather else [], "camera": scene.shot or "", "lead": scene.subject_name or scene.subject or "",
            "place": scene.setting or "", "set": scene.setting or "",
            "asset": (scene.model or {}).get("level", "procedural"), "matched": bool(scene.subject_name)}


def build(cfg, script: Script, props: RenderProps, video: Path | None = None, relevance: dict | None = None) -> dict:
    """The coverage of one rendered video."""
    rows, seen = [], []
    for i, (scene, r) in enumerate(zip(script.scenes, props.scenes), 1):
        length = max(0.0, r.end - r.start)
        row = {"scene": i, "start": round(r.start, 2), "seconds": round(length, 2), "template": scene.type, "kind": visualplan.kind(scene)}
        if scene.overlay:
            row["overlay"] = scene.overlay
        if row["kind"] == "3D":
            lay = _layers(scene, r)
            # birds far off are life in the place, not action: the subject or the place itself must move
            animated = bool(lay["subject"] or set(lay["environment"]) - {"birds overhead"})
            key = (lay["lead"], lay["subject"], lay["camera"], lay["place"])
            row |= lay | {"animated": animated, "static": not animated, "repeat": key in seen}
            seen.append(key)
        rows.append(row)
    if video is not None and video.is_file():
        _measure(cfg, rows, video)
    total = sum(r["seconds"] for r in rows) or 1.0
    three = [r for r in rows if r["kind"] == "3D"]
    t3 = sum(r["seconds"] for r in three) or 0.0
    share = lambda pick: round(sum(r["seconds"] for r in three if pick(r)) / total, 3)  # noqa: E731
    failed = {int(k) for k in {**(relevance or {}).get("failed_text", {}), **(relevance or {}).get("failed_picture", {})}}
    out = {
        "format": props.format,
        "duration": round(total, 1),
        "target_3d": cfg.visuals.world_share(cfg.format),
        "share_3d": round(t3 / total, 3),
        "share_animated": share(lambda r: r["animated"]),
        "share_subject_moving": share(lambda r: bool(r["subject"])),
        "share_matched": round(sum(r["seconds"] for r in three if r["matched"]) / t3, 3) if t3 else 0.0,
        "share_library_models": round(sum(r["seconds"] for r in three if r["asset"] == "library model") / t3, 3) if t3 else 0.0,
        "share_camera_moving": share(lambda r: bool(r["camera"])),
        "share_2d": round(sum(r["seconds"] for r in rows if r["kind"] != "3D") / total, 3),
        "shots_3d": len(three),
        "static": [r["scene"] for r in three if r["static"]],
        "repeats": [r["scene"] for r in three if r["repeat"]],
        "frozen": [r["scene"] for r in three if r.get("picture_change") is not None and r["picture_change"] < 0.25],
        # the render scores (fyt/inspect3d.py), by runtime over the measured 3D scenes
        "environment_richness": _mean(three, "environment_richness"),
        "animation_quality": _mean(three, "animation_quality"),
        "bare": [r["scene"] for r in three if "bare place" in inspect3d.flags(r)],
        "lifeless": [r["scene"] for r in three if "little moves" in inspect3d.flags(r)],
        "dropped_to_2d": sorted(failed),
        "scenes": rows,
    }
    return out


def _mean(rows: list[dict], key: str) -> float | None:
    got = [(r[key], r["seconds"]) for r in rows if r.get(key) is not None]
    return round(sum(v * s for v, s in got) / sum(s for _, s in got), 1) if got and sum(s for _, s in got) else None


def _measure(cfg, rows: list[dict], video: Path) -> None:
    """How much each 3D scene's picture changes, on the band where the action is (qcheck's frozen test),
    and its environment richness and animation quality (fyt/inspect3d.py)."""
    import numpy as np

    from fyt import qcheck

    for r in rows:
        if r["kind"] != "3D" or r["seconds"] < 1:
            continue
        f = qcheck.frames_at(video, [r["start"] + r["seconds"] * k for k in (0.25, 0.5, 0.75)])
        h, w = f.shape[1:]
        band = f[:, int(h * 0.18): int(h * (0.42 if cfg.format == "short" else 0.7)), int(w * 0.1): int(w * 0.9)]
        r["picture_change"] = round(float(np.abs(np.diff(band, axis=0)).mean()), 2)
        try:
            m = inspect3d.scene(video, r["start"], r["seconds"], cfg.format)
        except Exception:  # a measure that fails leaves the report without it, never the video
            continue
        if m:
            r["environment_richness"] = m["environment"].get("score")
            r["animation_quality"] = m["animation"]["score"]
            r["inspection"] = m


def warnings(cov: dict) -> list[str]:
    """What falls short of 3D first, as quality warnings."""
    out = []
    if cov["share_3d"] < cov["target_3d"] - 0.05:
        out.append(f"3D covers {cov['share_3d']:.0%} of the runtime, under the {cov['target_3d']:.0%} target")
    if cov["share_3d"] and cov["share_animated"] < cov["share_3d"] * 0.8:
        out.append(f"only {cov['share_animated']:.0%} of the runtime is 3D that moves on its own (of {cov['share_3d']:.0%} in 3D)")
    if cov["static"]:
        out.append(f"3D scenes {cov['static']} stand still (only the camera moves)")
    if cov["repeats"]:
        out.append(f"3D scenes {cov['repeats']} repeat an earlier shot")
    if cov["frozen"]:
        out.append(f"3D scenes {cov['frozen']} barely change on screen")
    if cov.get("bare"):
        out.append(f"3D scenes {cov['bare']} look bare (environment richness under {inspect3d.RICH_MIN:.0f})")
    if cov.get("lifeless"):
        out.append(f"3D scenes {cov['lifeless']} have little moving in the picture beyond the camera (animation under {inspect3d.ANIM_MIN:.0f})")
    return out


def _score(x) -> str:
    return "-" if x is None else f"{x:.0f}"


def markdown(cov: dict) -> str:
    pct = lambda x: f"{x:.0%}"  # noqa: E731
    lines = [
        "## 3D coverage", "",
        f"| | |", "|---|---|",
        f"| 3D scenes, by runtime | {pct(cov['share_3d'])} (target {pct(cov['target_3d'])}) |",
        f"| 3D that moves on its own (subject or place) | {pct(cov['share_animated'])} |",
        f"| 3D whose subject acts | {pct(cov['share_subject_moving'])} |",
        f"| 3D showing the story's own entities | {pct(cov['share_matched'])} of 3D ({pct(cov['share_library_models'])} with library models) |",
        f"| 3D with a moving camera | {pct(cov['share_camera_moving'])} |",
        f"| Maps, charts, photos and text | {pct(cov['share_2d'])} |",
        f"| 3D shots | {cov['shots_3d']} |",
        f"| Static / repeated / frozen 3D scenes | {len(cov['static'])} / {len(cov['repeats'])} / {len(cov['frozen'])} |",
        f"| Environment richness (rendered, 0-100) | {_score(cov.get('environment_richness'))} |",
        f"| Animation quality (rendered, 0-100) | {_score(cov.get('animation_quality'))} |",
        f"| 3D scenes sent back to 2D by the relevance check | {len(cov['dropped_to_2d'])} |",
        "", "| Scene | Time | Drawn as | Subject | Action | Secondary | Place moving | Camera | Asset | Richness | Animation |", "|---|---|---|---|---|---|---|---|---|---|---|",
    ]
    for r in cov["scenes"]:
        drawn = r["kind"] + (f" + {r['overlay']}" if r.get("overlay") else "") + ("" if r["kind"] == "3D" else f" ({r['template']})")
        if r["kind"] == "3D":
            flag = " (static)" if r["static"] else " (repeat)" if r["repeat"] else ""
            lines.append(f"| {r['scene']} | {r['start']:.0f}s +{r['seconds']:.0f}s | {drawn}{flag} | {r['lead']} | {r['subject'] or 'still'} | "
                         f"{', '.join(r['secondary']) or '-'} | {', '.join(r['environment']) or '-'} | {r['camera'] or '-'} | {r['asset']} | "
                         f"{_score(r.get('environment_richness'))} | {_score(r.get('animation_quality'))} |")
        else:
            lines.append(f"| {r['scene']} | {r['start']:.0f}s +{r['seconds']:.0f}s | {drawn} | | | | | | | | |")
    return "\n".join(lines) + "\n"


def write(cfg, job, script: Script, props: RenderProps, video: Path | None, log=print) -> dict:
    rel = json.loads(job.file("relevance.json").read_text()) if job.file("relevance.json").exists() else None
    cov = build(cfg, script, props, video, rel)
    job.file("coverage.json").write_text(json.dumps(cov, indent=2))
    job.file("coverage.md").write_text(markdown(cov))
    log(f"3D coverage: {cov['share_3d']:.0%} of the runtime in 3D (target {cov['target_3d']:.0%}), {cov['share_animated']:.0%} moving on its own, "
        f"{cov['shots_3d']} 3D shots" + (f"; environment richness {cov['environment_richness']:.0f}, animation quality {cov['animation_quality']:.0f}"
                                          if cov.get("environment_richness") is not None and cov.get("animation_quality") is not None else ""))
    return cov
