"""The production storyboard: one record per scene that every later stage reads (shotlist.json).

Built once the narration is timed and the visuals are chosen, before anything renders. For each scene:
when it plays, what it says, what the viewer must take from it, how it is shown (3D, 2.5D, 2D) and
with which assets and where they came from, the camera and the transition, the sounds at its key
moment, and its factual status (documented, reconstruction, scientific model, illustration) with
what is uncertain about it. The quality gate (fyt/qcheck.py) checks the video against it, and a person
reviewing a held video reads it beside the contact sheet.
"""

from __future__ import annotations

import json

from fyt import scenes3d, visualplan
from fyt.models import RenderProps, Script


def _status(scene) -> str:
    if scene.type != "world":
        return "documented"
    label = (scene.label or "").upper()
    if label.startswith("SCIENTIFIC"):
        return "scientific model"
    return "illustration" if label == "ILLUSTRATION" or scene.illustrative else "reconstruction"


def _assets(scene, render) -> list[dict]:
    out = []
    for m in [render.media] + list(render.shots or []):
        if m is not None:
            out.append({"kind": "photo" if m.kind == "image" else "footage", "ref": m.src})
    for b in render.beats or []:
        out.append({"kind": "illustration", "ref": b.src})
    if render.backdropSrc:
        out.append({"kind": "illustration", "ref": render.backdropSrc})
    for a in scene.actors or []:
        out.append({"kind": "prop", "ref": a.thing})
    if scene.model:
        m = scene.model
        out.append({"kind": "model", "id": m.get("id"), "level": m.get("level"), "title": m.get("title"),
                    "sources": m.get("sources", []), "licence": m.get("licence"), "src": m.get("src")})
    return out


def _uncertainty(scene) -> list[str]:
    notes = []
    if scene.type == "world":
        if scene.illustrative and scene.subject and not scenes3d.subjects()[scene.subject].get("conceptual"):
            notes.append("No documented event in this scene's narration: shown as an illustration of the subject.")
        m = scene.model or {}
        if m.get("level") == "generic":
            notes.append("Generic model: not the specific object, and its proportions are not to scale.")
        elif m.get("notes"):
            notes.append(m["notes"])
        if scene.weather:
            notes.append(f"Weather ({scene.weather}) is named in the script or its sources.")
    return notes


def _audio(scene, render, start: float, length: float) -> list[dict]:
    cues = []
    if render.effectAt is not None and scene.type == "world":
        info = scenes3d.subjects().get(scene.subject or "", {}).get("actions", {}).get(scene.action or "", {})
        if info.get("sound"):
            cues.append({"at": round(start + render.effectAt * length, 2), "sound": info["sound"][0]})
    for t in render.landTimes or []:
        cues.append({"at": round(start + t, 2), "sound": "chime or hit (a figure lands)"})
    return cues


def build(script: Script, props: RenderProps, profile: str | None = None, plan: dict | None = None) -> dict:
    shots = []
    for i, (scene, render) in enumerate(zip(script.scenes, props.scenes), 1):
        length = render.end - render.start
        shot = {
            "scene": i,
            "start": round(render.start, 2),
            "end": round(render.end, 2),
            "narration": scene.narration,
            "purpose": scene.purpose or scene.heading or "",
            "technique": visualplan.kind(scene),
            "template": scene.type,
            "assets": _assets(scene, render),
            "camera": scene.shot if scene.type == "world" else (scene.camera or "auto"),
            "transition_in": scene.transition or "auto",
            "audio": _audio(scene, render, render.start, length),
            "status": _status(scene),
            "label": scene.label,
            "uncertainty": _uncertainty(scene),
        }
        if scene.type == "world":
            shot["subject"] = {"subject": scene.subject, "variant": scene.variant, "action": scene.action,
                               "name": scene.subject_name, "setting": scene.setting, "weather": scene.weather}
            if render.effectAt is not None:
                shot["key_moment"] = round(render.start + render.effectAt * length, 2)
                shot["cue"] = scene.cue
        shots.append(shot)
    return {
        "title": script.title,
        "core_message": script.core_message,
        "format": props.format,
        "duration": props.duration,
        "art_direction": profile or "signature",
        "planner": (plan or {}).get("planner"),
        "sources": script.sources,
        "shots": shots,
    }


def dumps(board: dict) -> str:
    return json.dumps(board, indent=2, ensure_ascii=False)
