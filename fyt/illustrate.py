"""Props for the 2D `story` scenes: the script names everyday things ("police car", "rocket"),
and each is drawn with a flat illustration from Microsoft's Fluent Emoji (MIT licence), installed
with the renderer as @iconify-json/fluent-emoji-flat. Only the illustrations a video uses are
copied into its job folder.
"""

from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path

from fyt.config import ROOT
from fyt.models import Script

ICONS = ROOT / "renderer" / "node_modules" / "@iconify-json" / "fluent-emoji-flat" / "icons.json"
SKIN = re.compile(r"-(dark|light|medium|medium-dark|medium-light)$")
# Words a script is likely to use that the set names differently.
SYNONYMS = {
    "car": "automobile",
    "plane": "airplane",
    "aircraft": "airplane",
    "jet": "airplane",
    "explosion": "collision",
    "blast": "collision",
    "crash": "collision",
    "earth": "globe-showing-europe-africa",
    "world": "globe-showing-europe-africa",
    "planet": "ringed-planet",
    "boat": "sailboat",
    "spacecraft": "rocket",
    "spaceship": "rocket",
    "astronaut": "astronaut",
    "people": "busts-in-silhouette",
    "fire-truck": "fire-engine",
    "truck": "delivery-truck",
    "gun": "water-pistol",
    "crowd": "busts-in-silhouette",
    "soldier": "military-helmet",
    "army": "military-helmet",
    "doctor": "health-worker",
    "scientist": "scientist",
    "money": "money-bag",
    "cash": "dollar-banknote",
    "law": "balance-scale",
    "court": "balance-scale",
    "judge": "judge",
    "letter": "envelope",
    "document": "page-facing-up",
    "report": "page-facing-up",
    "phone": "mobile-phone",
    "computer": "laptop",
    "storm": "cloud-with-lightning-and-rain",
    "rain": "cloud-with-rain",
    "lightning": "high-voltage",
    "smoke": "dashing-away",
    "question": "red-question-mark",
    "warning": "warning",
    "danger": "warning",
    "death": "skull",
    "poison": "skull-and-crossbones",
    "factory": "factory",
    "city": "cityscape",
    "town": "houses",
    "mountain": "mountain",
    "sea": "water-wave",
    "ocean": "water-wave",
    "wave": "water-wave",
    "sun": "sun",
    "clock": "alarm-clock",
    "time": "hourglass-not-done",
}
# What each effect is drawn with, on top of the renderer's own particles.
EFFECTS = {
    "explosion": "collision",
    "fire": "fire",
    "smoke": "dashing-away",
    "lightning": "high-voltage",
    "sparkles": "sparkles",
    "rain": None,
    "snow": None,
}


@lru_cache(maxsize=1)
def _icon_set(path: Path = ICONS) -> dict:
    return json.loads(path.read_text())


def resolve(thing: str, icons: dict | None = None) -> str | None:
    """The best illustration name for a plain noun, or None if nothing fits."""
    icons = icons if icons is not None else _icon_set()["icons"]
    q = re.sub(r"[^a-z0-9]+", "-", thing.lower()).strip("-")
    if not q:
        return None
    for cand in (q, SYNONYMS.get(q), q.removesuffix("s"), SYNONYMS.get(q.split("-")[-1])):
        if cand and cand in icons:
            return cand
    words = [w for w in q.split("-") if w not in {"a", "an", "the", "of", "old"}]
    plain = [n for n in icons if not SKIN.search(n)]
    for need in (set(words), {words[-1]} if words else set()):
        hits = [n for n in plain if need and need <= set(n.split("-"))]
        if hits:
            return min(hits, key=len)
    return None


def svg(name: str, icon_set: dict | None = None) -> str:
    data = icon_set or _icon_set()
    icon = data["icons"][name]
    w, h = icon.get("width", data.get("width", 32)), icon.get("height", data.get("height", 32))
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}">{icon["body"]}</svg>'


def add_props(script: Script, public: Path, icon_set: dict | None = None) -> int:
    """Write the illustrations the story scenes need into the job and point each prop at its file.
    Returns how many props have no illustration (the renderer leaves them out)."""
    data = icon_set or _icon_set()
    missing = 0
    (public / "icons").mkdir(parents=True, exist_ok=True)

    def place(name: str | None) -> str | None:
        if not name:
            return None
        path = public / "icons" / f"{name}.svg"
        if not path.exists():
            path.write_text(svg(name, data))
        return f"icons/{name}.svg"

    for scene in script.scenes:
        if scene.type != "story":
            continue
        for actor in scene.actors or []:
            actor.src = place(resolve(actor.thing, data["icons"]))
            missing += actor.src is None
        if scene.effect:
            scene.effect_src = place(EFFECTS.get(scene.effect))
    return missing
