"""The outfitted people in the project library (assets/library-picks.json, subject "person"): ready-made
low-poly men and women in outfits (a suit, a soldier's or a farmer's clothes, a spacesuit, a king's
robes), each rigged with its own walk, run, idle, wave and fall. A person in a story world wears the one
whose roles their words name, or their build's top, else everyday clothes; the renderer gives them
the build's skin and hair colours.
"""
from __future__ import annotations

import re
import shutil
import zlib
from pathlib import Path

from fyt import assets

# what a build's top suggests when the words name no role
TOPS = {"spacesuit": "spacesuit astronaut", "armour": "knight armour", "robe": "robe", "suit": "suit", "labcoat": "labcoat",
        "scrubs": "scrubs", "uniform": "uniform", "vest": "vest", "jacket": "jacket", "coat": "coat", "hoodie": "hoodie"}


def outfits() -> dict[str, dict]:
    return {k: e for k, e in assets.registry().items() if e.get("subject") == "person" and assets.library_ready(e)}


def _words(text: str) -> set[str]:
    return set(re.findall(r"[a-z]+", text.lower()))


def outfit_for(words: str, sex: str, top: str = "") -> str | None:
    """The library key of the outfit a person wears: the first (in the picks' order) whose roles their own
    words name, then the first their build's top suggests, else the plain everyday one (no roles)."""
    mine = [(k, e) for k, e in outfits().items() if e.get("sex") == (sex or "m")]
    if not mine:
        return None
    w = _words(words)
    fits = [k for k, e in mine if w & set(e.get("roles", []))]
    if fits:
        # the outfits first named share their roles with others like them: one of those, the same for
        # the same words
        first = set(outfits()[fits[0]].get("roles", [])) & w
        same = [k for k in fits if first & set(outfits()[k].get("roles", []))]
        return same[zlib.crc32(" ".join(sorted(w)).encode()) % len(same)]
    t = _words(TOPS.get(top, ""))
    for k, e in mine:
        if t & set(e.get("roles", [])):
            return k
    return next((k for k, e in mine if not e.get("roles")), mine[-1][0])


def dress(entity_words: str, build, public: Path) -> dict | None:
    """A person's outfit model, copied into the video's public folder, as a world cast model."""
    key = outfit_for(entity_words, getattr(build, "sex", "") or "m", build.outfit.top if build.outfit else "")
    if key is None:
        return None
    e = outfits()[key]
    (public / "models").mkdir(parents=True, exist_ok=True)
    shutil.copy2(assets.MODELS_DIR / e["src"], public / "models" / e["src"])
    return {"id": key, "src": f"models/{e['src']}", "fit": {}, "clips": e.get("clips", []), "licence": e["licence"], "title": e["title"]}
