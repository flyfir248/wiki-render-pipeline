"""What a 3D scene shows, exactly, and where its model comes from.

Each world scene's subject is identified as a named object when the story names one (the Titanic, a
Saturn V, a Boeing 747, a water molecule), then resolved down a ladder, best first:

1. library: a vetted glTF model of that object in renderer/public/models, with its source and licence
   recorded in renderer/src/scenes/world/assets.json (converted and checked offline, never fetched
   during a run);
2. spec: the object's published features (funnels, engines, stages) driving the procedural module, or
   for a molecule its measured geometry (molecules.json, or PubChem's 3D record when a run can reach it);
3. generic: the module's own model of the variant, never presented as that specific object.

The level reached sets the on-screen label: RECONSTRUCTION when a library or spec model shows a
documented event, RECONSTRUCTION · SIMPLIFIED with a generic model, SCIENTIFIC MODEL for a structure
built from measured data, ILLUSTRATION when no documented event is shown or the subject is a concept.
Every choice is written into the production storyboard (fyt/shotlist.py) with its sources.
"""

from __future__ import annotations

import json
import shutil
from functools import lru_cache
from pathlib import Path

import requests

from fyt import scenes3d
from fyt.models import Script, ScriptScene

WORLD = scenes3d.CATALOG_PATH.parent
MODELS_DIR = WORLD.parent.parent.parent / "public" / "models"
LEVELS = ("library", "spec", "generic")
PUBCHEM = "https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/{}/JSON?record_type=3d"
MAX_ATOMS = 90  # a bigger molecule is unreadable on a phone screen and slow to draw
ELEMENTS = {1: "H", 5: "B", 6: "C", 7: "N", 8: "O", 9: "F", 11: "Na", 12: "Mg", 15: "P", 16: "S", 17: "Cl", 19: "K", 20: "Ca", 26: "Fe", 35: "Br", 53: "I"}


@lru_cache(maxsize=1)
def registry() -> dict:
    return json.loads((WORLD / "assets.json").read_text())["assets"]


@lru_cache(maxsize=1)
def molecules() -> dict:
    return json.loads((WORLD / "molecules.json").read_text())["molecules"]


def library_ready(entry: dict) -> bool:
    """A library model is used only when its file is there and its source and licence are recorded."""
    return (
        entry.get("kind") == "library"
        and bool(entry.get("source")) and bool(entry.get("licence"))
        and (MODELS_DIR / Path(entry.get("src", "")).name).is_file()
    )


def identify(subject: str, *texts: str) -> tuple[str, dict] | None:
    """The named object of this subject that the first of `texts` to name one names, library model first."""
    candidates = [(k, e) for k, e in registry().items() if e.get("subject") == subject]
    for text in texts:
        hits = [(k, e) for k, e in candidates if text and scenes3d.find(text, e.get("names", []))]
        if hits:
            ready = [h for h in hits if library_ready(h[1])]
            specs = [h for h in hits if h[1].get("kind") == "spec"]
            return (ready or specs or hits)[0]
    return None


def fetch_molecule(name: str) -> dict | None:
    """A molecule's 3D structure from PubChem, or None when it can't be had (no network, no 3D record)."""
    try:
        r = requests.get(PUBCHEM.format(requests.utils.quote(name)), timeout=15)
        r.raise_for_status()
        c = r.json()["PC_Compounds"][0]
        conf = c["coords"][0]["conformers"][0]
        z = c["atoms"]["element"]
        if len(z) > MAX_ATOMS or any(e not in ELEMENTS for e in z):
            return None
        atoms = [[ELEMENTS[e], [round(x, 4), round(y, 4), round(w, 4)]] for e, x, y, w in zip(z, conf["x"], conf["y"], conf.get("z", [0] * len(z)))]
        b = c.get("bonds", {})
        bonds = [[i - 1, j - 1, o] for i, j, o in zip(b.get("aid1", []), b.get("aid2", []), b.get("order", []))]
        return {"names": [name], "formula": "", "atoms": atoms, "bonds": bonds,
                "source": f"https://pubchem.ncbi.nlm.nih.gov/compound/{requests.utils.quote(name)}", "notes": "PubChem 3D conformer"}
    except Exception:
        return None


def _molecule(scene: ScriptScene, story: str) -> tuple[str, dict] | None:
    for text in (" ".join(x for x in (scene.narration, scene.heading or "") if x), scene.subject_name or "", story):
        for k, m in molecules().items():
            if text and scenes3d.find(text, m["names"]):
                return k, m
    name = (scene.subject_name or "").strip()
    if name and ":" not in name:  # a planner named the compound ("caffeine"): look it up
        m = fetch_molecule(name)
        if m:
            return name.lower(), m
    return None


def _science(scene: ScriptScene, story: str) -> dict:
    variant = scene.variant or "molecule"
    if variant == "dna":
        return {"id": "b-dna", "level": "spec", "title": "B-form DNA", "kind": "data",
                "params": {"basePairsPerTurn": 10.5, "rise": 3.38, "radius": 10.0},
                "sources": ["https://en.wikipedia.org/wiki/Nucleic_acid_double_helix"],
                "notes": "Right-handed B-form helix: 10.5 base pairs a turn, 3.38 A rise, 20 A across."}
    if variant in ("molecule", "crystal"):
        hit = _molecule(scene, story)
        if hit:
            key, m = hit
            return {"id": key, "level": "spec", "title": m.get("formula") or key, "kind": "data",
                    "params": {"atoms": m["atoms"], "bonds": m["bonds"], "lattice": m.get("lattice")},
                    "sources": [m["source"]], "notes": m["notes"]}
    return {"id": f"science:{variant}", "level": "generic", "title": variant, "kind": "concept", "params": {},
            "sources": [], "notes": "No measured structure for this; drawn as an illustration."}


def _entry(key: str, e: dict) -> dict:
    level = "library" if library_ready(e) else "spec" if e.get("kind") == "spec" else "generic"
    out = {"id": key, "level": level, "title": e.get("title", key), "kind": "object", "params": e.get("params", {}),
           "sources": e.get("sources", []) + ([e["source"]] if e.get("source") else []), "notes": e.get("notes", "")}
    if level == "library":
        out |= {"src": f"models/{Path(e['src']).name}", "licence": e["licence"], "author": e.get("author", ""),
                "triangles": e.get("triangles"), "fit": e.get("fit", {})}
    return out


def generic(scene: ScriptScene) -> dict:
    return {"id": f"{scene.subject}:{scene.variant}", "level": "generic", "title": f"generic {scene.variant or scene.subject}",
            "kind": "object", "params": {}, "sources": [], "notes": "The module's own model of this kind of thing."}


def label(scene: ScriptScene, model: dict) -> str:
    if model.get("kind") == "data" and scene.subject == "science":
        return "SCIENTIFIC MODEL"
    if scene.illustrative or model.get("kind") == "concept":
        return "ILLUSTRATION"
    return "RECONSTRUCTION" if model["level"] in ("library", "spec") else "RECONSTRUCTION · SIMPLIFIED"


def resolve(script: Script) -> Script:
    """Every world scene with its model resolved and its label set. A subject that recurs keeps one
    model: the object named in any of its scenes, or in the story when the story names only one."""
    story = " ".join([script.title] + [s.narration for s in script.scenes])
    groups: dict[str, list[int]] = {}
    for i, s in enumerate(script.scenes):
        if s.type == "world" and s.subject:
            groups.setdefault(s.subject_name or f"{s.subject}:{s.variant}", []).append(i)
    scenes = list(script.scenes)
    for name, idx in groups.items():
        first = scenes[idx[0]]
        if first.subject == "science":
            for i in idx:
                m = _science(scenes[i], story)
                scenes[i] = scenes[i].model_copy(update={"model": m, "label": label(scenes[i], m)})
            continue
        group_text = " ".join(scenes[i].narration + " " + (scenes[i].heading or "") for i in idx)
        named = [k for k, e in registry().items() if e.get("subject") == first.subject and scenes3d.find(story, e.get("names", []))]
        hit = identify(first.subject, group_text, name) or (identify(first.subject, story) if len(named) == 1 else None)
        for i in idx:
            s = scenes[i]
            own = identify(s.subject, s.narration + " " + (s.heading or ""))  # a scene naming another object
            key, e = own or hit or (None, None)
            m = _entry(key, e) if e else generic(s)
            update = {"model": m}
            if e:
                update |= {"variant": e.get("variant", s.variant), "subject_name": key}
            s = s.model_copy(update=update)
            scenes[i] = s.model_copy(update={"label": label(s, m)})
    return script.model_copy(update={"scenes": scenes})


def stage(script: Script, public: Path) -> list[str]:
    """Copy the library models the script uses into the job's public folder. Returns models missing."""
    missing = []
    for s in script.scenes:
        src = (s.model or {}).get("src")
        if not src:
            continue
        file = MODELS_DIR / Path(src).name
        if not file.is_file():
            missing.append(src)
            continue
        (public / "models").mkdir(parents=True, exist_ok=True)
        shutil.copy2(file, public / "models" / file.name)
    return missing
