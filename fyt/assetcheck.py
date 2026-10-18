"""One definite test of story-driven 3D, without making a video: `python -m fyt assetcheck`.

For a fixed panel of things from different kinds of story (an animal, a ship, a microscopic animal, a
light aircraft, an organ) it runs the real model search, checks, preparation and, where it is set up,
generation; renders each model on the 3D stage; and asks the vision model whether the rendered frame
shows that thing. The result is one report with a pass or fail per thing and why, and one sheet with
each thing's model preview beside its rendered frame:

    report.md, report.json, sheet.png, frames/   (in the folder given, default jobs/assetcheck)

A pass means: a model of that thing was found or generated, it passed every check, it rendered, and a
vision model looking at the render agreed it shows that thing. Nothing short of that is reported as one.
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path

from PIL import Image, ImageDraw

from fyt import assetlib, relevance, render, storyboard
from fyt.config import Config
from fyt.manifest import Entity

PANEL = [
    Entity(id="bear", name="an American black bear", kind="animal", search=["american black bear", "black bear", "bear"],
           look="a full-grown American black bear, glossy black fur, brown muzzle, on all fours", certain=True, scenes=[1]),
    Entity(id="ship", name="the brigantine Mary Celeste", kind="sailing ship", search=["brigantine", "sailing ship", "ship"],
           look="a two-masted 19th-century wooden merchant brigantine, dark hull, square sails", certain=True, scenes=[1]),
    Entity(id="tardigrade", name="a tardigrade", kind="microscopic animal", search=["tardigrade", "water bear"],
           look="a plump eight-legged micro-animal with clawed stubby legs, translucent beige body", certain=True, scenes=[1]),
    Entity(id="plane", name="a Cessna light aircraft", kind="light aircraft", search=["cessna", "light aircraft", "airplane"],
           look="a small single-engine high-wing propeller plane, white with a coloured stripe", certain=True, scenes=[1]),
    Entity(id="heart", name="a human heart", kind="organ", search=["human heart", "heart anatomy"],
           look="an anatomical human heart with the aorta and main vessels, red and purple", certain=True, scenes=[1]),
]
SECONDS = 5  # each thing's stage scene
SETTINGS = {"ship": "sea", "tardigrade": "room", "heart": "room"}  # where each is shown; countryside otherwise


def _props(cfg: Config, found: dict[str, dict], srcs: dict[str, str]) -> dict:
    scenes = []
    for i, (eid, a) in enumerate(found.items()):
        scenes.append({
            "id": f"s{i}", "type": "world", "start": i * SECONDS, "end": (i + 1) * SECONDS, "heading": a["entity"],
            "subject": "stage", "variant": "model", "action": "present", "shot": "side", "setting": SETTINGS.get(eid, "countryside"),
            "model": {"id": eid, "level": "generated" if a.get("source") == "generated" else "found", "src": srcs[eid],
                      "clips": a.get("clips", []), "fit": a.get("fit") or assetlib.facing(a["entity_obj"])},
            "label": "RECONSTRUCTION", "effectAt": 0.55, "backdropSrc": None, "seed": 5 + i,
        })
    return {"format": "short", "fps": 30, "title": "asset check", "duration": max(1, len(scenes)) * SECONDS,
            "theme": cfg.theme.model_dump(), "voice": None, "music": None, "sfx": None, "scenes": scenes, "captions": [],
            "showCaptions": False, "showVisualizer": False, "badge": None, "subscribe": None, "endCard": 0}


def _sheet(rows: list[dict], out: Path) -> Path:
    w, h, pad = 360, 640, 12
    pics = [[r.get(k) if r.get(k) and Path(r[k]).is_file() else None for k in ("preview", "frame")] for r in rows]
    heights = [(h + 44) if any(p) else 36 for p in pics]
    sheet = Image.new("RGB", (2 * w + 3 * pad, sum(heights) + pad), "white")
    draw = ImageDraw.Draw(sheet)
    y = pad
    for r, row_pics, height in zip(rows, pics, heights):
        draw.text((pad, y), f"{'PASS' if r['pass'] else 'FAIL'}  {r['name']}: {r['why'][:80]}", fill="black")
        for j, pic in enumerate(row_pics):
            if pic:
                img = Image.open(pic).convert("RGB")
                img.thumbnail((w, h))
                sheet.paste(img, (pad + j * (w + pad), y + 20))
        y += height
    sheet.save(out)
    return out


def run(cfg: Config, out: Path, log=print) -> list[dict]:
    out = out.resolve()  # the renderer runs in its own folder
    if out.exists():
        shutil.rmtree(out)
    (out / "public").mkdir(parents=True)
    lines: list[str] = []

    def note(m: str) -> None:
        lines.append(m)
        log(m)

    note(assetlib.generator_status(cfg))
    rows, found = [], {}
    for e in PANEL:
        start = len(lines)
        hit = assetlib.resolve(cfg, e, "medium", log=note)
        row = {"id": e.id, "name": e.name, "pass": False, "log": lines[start:]}
        if hit:
            found[e.id] = hit | {"entity": e.name, "entity_obj": e}
            row |= {k: hit.get(k) for k in ("source", "title", "author", "licence", "url", "checked", "triangles", "clips")}
            preview = Path(hit["file"]).with_name("preview.jpg")
            row["preview"] = str(preview) if preview.is_file() else None
            row["why"] = "found, but not rendered"
        else:
            row["why"] = "no model found or generated that passed the checks"
        rows.append(row)

    if found:
        srcs = assetlib.stage(found, out / "public")
        props = _props(cfg, found, srcs)
        (out / "props.json").write_text(json.dumps(props))
        at = [int((i + 0.55) * SECONDS * 30) for i in range(len(found))]
        try:
            frames = render.frames(out / "props.json", out / "public", out / "frames", at)
        except Exception as ex:
            frames = []
            note(f"render failed: {str(ex)[:200]}")
        by_id = dict(zip(found, frames))
        for row in rows:
            frame = by_id.get(row["id"])
            if row["id"] not in found:
                continue
            if not frame or not frame.is_file():
                row["why"] = "the model did not render"
                continue
            row["frame"] = str(frame)
            v = storyboard.review(cfg, frame, f"{row['name']}. The narrator says: \"Here is {row['name']}.\"",
                                  rules=relevance.FRAME)
            if v is None:
                row["why"] = "rendered, but no vision check of the frame could be made"
            else:
                row["pass"] = bool(v.matches)
                row["why"] = "the rendered frame shows it" if v.matches else f"frame check: {v.problems or 'not recognisable'}"

    passed = sum(r["pass"] for r in rows)
    md = [f"# 3D asset check: {passed} of {len(rows)} passed", "", lines[0] if lines else "", ""]
    for r in rows:
        md.append(f"## {'PASS' if r['pass'] else 'FAIL'}: {r['name']}")
        md.append(f"- why: {r['why']}")
        if r.get("title"):
            md.append(f"- model: {r['title']!r} from {r['source']} ({r['licence']}, {r['triangles']} triangles, checked: {r['checked']})")
            md.append(f"- by {r.get('author') or 'unknown'}, {r.get('url') or ''}")
        md += [f"  - {m}" for m in r["log"][-8:]] + [""]
    (out / "report.md").write_text("\n".join(md))
    (out / "report.json").write_text(json.dumps(rows, indent=2, default=str))
    _sheet(rows, out / "sheet.png")
    note(f"asset check: {passed} of {len(rows)} passed; report in {out / 'report.md'}")
    return rows
