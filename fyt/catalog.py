"""The asset catalogue: every model in the library and set-piece folder inspected (renderer/inspect-model.mjs)
and recorded with what it can do, and a coverage report of where the library is thin.

`build()` writes assets/catalog.json, one entry per library model and set piece: its pack, licence, size,
triangles, rig (native: it came with a skeleton; auto: rigged here by fyt/rigging.py; none), clips, the
story actions it can perform (from its clips, or the renderer's whole-body posing for a still animal, or
its wheels and propellers for a vehicle) and the kinds of place it dresses. `report()` turns it into a
Markdown summary: per pack, what was made and what moves; animals left still and why; kinds of place
with no pieces, or missing a role; files on disk that nothing names, entries whose file is missing, and
models that are byte-for-byte the same.
"""
from __future__ import annotations

import hashlib
import json
import re
import subprocess
from collections import Counter, defaultdict
from pathlib import Path

from fyt import assets, kit, sets
from fyt.assetlib import RENDERER_DIR

OUT = kit.BUNDLED.parent / "catalog.json"
GRAMMAR = assets.WORLD / "storyworld" / "grammar.json"

# a clip's name -> the story verbs it performs (the renderer's clipFor, read the other way)
CLIP_ACTIONS = [
    (re.compile(r"run|gallop|sprint|charge", re.I), ["run", "charge", "chase", "flee"]),
    (re.compile(r"walk|trot|move|locomot", re.I), ["walk", "approach", "depart", "wander", "follow", "carry"]),
    (re.compile(r"swim", re.I), ["swim"]),
    (re.compile(r"fly|flap|glide|hover", re.I), ["fly"]),
    (re.compile(r"attack|bite|swipe|hit|roar|punch|strike", re.I), ["attack", "fight", "hunt", "roar"]),
    (re.compile(r"eat|graze|drink|feed", re.I), ["eat", "graze", "drink"]),
    (re.compile(r"sleep|rest|lie|sit|death|die", re.I), ["sleep", "lie", "die"]),
    (re.compile(r"wave|greet|cheer", re.I), ["wave", "greet", "cheer"]),
    (re.compile(r"interact|work|use", re.I), ["work", "use", "pick_up", "open"]),
    (re.compile(r"idle|stand|breath|look|wait", re.I), ["idle", "look_around"]),
]
# a library animal with no native rig is laid on its side to fall or sleep (storyworld stillPose), and one
# left still is moved as a whole as it goes
LYING = ["fall", "lie", "sleep", "die"]
STILL_ACTIONS = ["idle", "look_around", "walk", "run", "eat"]


def inspect(files: list[Path]) -> dict[str, dict]:
    """inspect-model.mjs's record of each file, by file name."""
    out: dict[str, dict] = {}
    for i in range(0, len(files), 40):
        r = subprocess.run(["node", "inspect-model.mjs", *map(str, files[i:i + 40])], cwd=RENDERER_DIR,
                           capture_output=True, text=True, timeout=600)
        for line in r.stdout.splitlines():
            if line.startswith("{"):
                got = json.loads(line)
                out[Path(got["file"]).name] = got
    return out


def actions(entry: dict, info: dict) -> list[str]:
    """The story verbs a model can perform."""
    acts: list[str] = []
    for clip in info.get("clips", []):
        for rx, verbs in CLIP_ACTIONS:
            if rx.search(clip):
                acts += [v for v in verbs if v not in acts]
    if entry.get("posed"):
        acts += [v for v in (LYING if info.get("clips") else STILL_ACTIONS + LYING) if v not in acts]
    if info.get("wheels"):
        acts += [v for v in ["drive", "race", "approach", "depart", "crash"] if v not in acts]
    if info.get("spinners"):
        acts += [v for v in ["fly", "move"] if v not in acts]
    return acts or ["present"]


def _pack(entry: dict) -> str:
    m = re.search(r"\(([^)]+)\)\s*$", entry.get("title", ""))
    return m.group(1) if m else entry.get("source", "") or "unknown"


def build() -> dict:
    """Inspect the library and the set pieces and write assets/catalog.json."""
    reg = {k: e for k, e in assets.registry().items() if e.get("kind") == "library"}
    models = sorted(assets.MODELS_DIR.glob("*.glb"))
    pieces = sorted(sets.DIR.glob("*.glb"))
    seen = inspect(models + pieces)
    index = json.loads(sets.INDEX.read_text()) if sets.INDEX.is_file() else {"sets": {}, "sources": {}}
    places: dict[str, list[str]] = defaultdict(list)
    for kind, roles in index["sets"].items():
        for role, srcs in roles.items():
            for s in srcs:
                places[Path(s).name].append(f"{kind}:{role}")
    out: dict[str, dict] = {"models": {}, "pieces": {}}
    for key, e in sorted(reg.items()):
        info = seen.get(e.get("src", ""), {"ok": False, "reason": "file missing"})
        out["models"][key] = {
            "pack": _pack(e), "licence": e.get("licence", ""), "author": e.get("author", ""),
            "file": e.get("src", ""), "ok": info.get("ok", False), "reason": info.get("reason", ""),
            "rig": info.get("rig", "none"), "rig_type": info.get("rigType") or e.get("rig_type", ""),
            "rig_note": e.get("rig_note", ""), "clips": info.get("clips", []), "actions": actions(e, info) if info.get("ok") else [],
            "triangles": info.get("triangles", 0), "bytes": info.get("bytes", 0),
            "wheels": info.get("wheels", 0), "spinners": info.get("spinners", 0), "names": e.get("names", [])[:4],
        }
    for f in pieces:
        info = seen.get(f.name, {"ok": False})
        pack = f.name.split("-")[0]
        out["pieces"][f.name] = {"pack": pack, "licence": index["sources"].get(pack, {}).get("licence", "CC0"),
                                 "ok": info.get("ok", False), "triangles": info.get("triangles", 0), "bytes": info.get("bytes", 0),
                                 "places": sorted(places.get(f.name, []))}
    # files on disk nothing names, entries whose file is gone, and identical files
    named = {e.get("src") for e in assets.registry().values() if e.get("src")}
    out["unnamed"] = sorted(f.name for f in models if f.name not in named)
    out["missing"] = sorted(k for k, m in out["models"].items() if m["reason"] == "file missing")
    digests = defaultdict(list)
    for f in models + pieces:
        digests[hashlib.sha1(f.read_bytes()).hexdigest()].append(f.name)
    out["duplicates"] = sorted(v for v in digests.values() if len(v) > 1)
    OUT.write_text(json.dumps(out, indent=1) + "\n")
    return out


def report(cat: dict | None = None) -> str:
    """The catalogue's coverage, as Markdown."""
    cat = cat or (json.loads(OUT.read_text()) if OUT.is_file() else build())
    ms = cat["models"]
    lines = ["# Asset library coverage", ""]
    moving = sum(1 for m in ms.values() if m["clips"])
    lines += [f"{len(ms)} library models ({moving} with clips: {sum(1 for m in ms.values() if m['rig'] == 'native')} came rigged, "
              f"{sum(1 for m in ms.values() if m['rig'] == 'auto')} rigged here), {len(cat['pieces'])} set pieces.", ""]
    lines += ["## By pack", "", "| Pack | Models | Rigged | Rigged here | Still animals | Vehicles with turning parts | Broken |", "|---|---|---|---|---|---|---|"]
    by = defaultdict(list)
    for m in ms.values():
        by[m["pack"]].append(m)
    for pack, group in sorted(by.items()):
        lines.append(f"| {pack} | {len(group)} | {sum(1 for m in group if m['rig'] == 'native')} | {sum(1 for m in group if m['rig'] == 'auto')} | "
                     f"{sum(1 for m in group if m['rig'] == 'none' and 'walk' in m['actions'])} | {sum(1 for m in group if m['wheels'] or m['spinners'])} | "
                     f"{sum(1 for m in group if not m['ok'])} |")
    still = {k: m for k, m in ms.items() if m["rig_note"]}
    if still:
        lines += ["", f"## Animals left still ({len(still)})", "", "They are moved as a whole instead (a gait's rise and rock, lying on their side).", ""]
        lines += [f"- {k}: {m['rig_note']}" for k, m in sorted(still.items())]
    acts = Counter(a for m in ms.values() for a in m["actions"])
    lines += ["", "## Actions the library can perform", "", ", ".join(f"{a} ({n})" for a, n in acts.most_common())]
    grammar = json.loads(GRAMMAR.read_text())
    kinds = grammar["sets"] if isinstance(grammar["sets"], list) else list(grammar["sets"])
    have = defaultdict(set)
    for p in cat["pieces"].values():
        for place in p["places"]:
            kind, role = place.split(":")
            have[kind].add(role)
    lines += ["", "## Kinds of place", "", "| Kind | Roles with pieces |", "|---|---|"]
    lines += [f"| {k} | {', '.join(sorted(have[k])) or 'none: drawn by the renderer'} |" for k in kinds]
    unused = [n for n, p in cat["pieces"].items() if not p["places"]]
    lines += ["", "## Housekeeping", "",
              f"- Set pieces no kind of place uses: {len(unused)}",
              f"- Model files nothing in the registry names: {len(cat['unnamed'])}" + (f" ({', '.join(cat['unnamed'][:12])}{'…' if len(cat['unnamed']) > 12 else ''})" if cat["unnamed"] else ""),
              f"- Registry entries whose file is missing: {len(cat['missing'])}" + (f" ({', '.join(cat['missing'])})" if cat["missing"] else ""),
              f"- Identical files: {len(cat['duplicates'])}" + (f" ({'; '.join(' = '.join(d) for d in cat['duplicates'][:8])})" if cat["duplicates"] else "")]
    return "\n".join(lines) + "\n"
