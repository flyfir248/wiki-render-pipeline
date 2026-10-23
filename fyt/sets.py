"""Set pieces: what a story world's places are built from. Trees, rocks and plants for the outdoors,
houses and towers along a street, road and rail tiles under the action, machines in a factory, picked from
free (CC0) packs (assets/set-picks.json) and prepared once into renderer/public/sets. A place of a kind
gets that kind's pieces by role (sets.json there); the renderer places them, and keeps its own drawn
pieces for a kind or role the packs do not cover.
"""
from __future__ import annotations

import json
import shutil
import tempfile
import zipfile
from functools import lru_cache
from pathlib import Path

from fyt import kit
from fyt.assetlib import RENDERER_DIR
from fyt.packs import _find, _model

PICKS = kit.BUNDLED.parent / "set-picks.json"
DIR = RENDERER_DIR / "public" / "sets"
INDEX = DIR / "sets.json"


# triangles a piece keeps: a set holds hundreds of trees and clumps of grass, so the nature pack's are
# simplified hard (a CPU renders every frame); the Kenney pieces are low already
BUDGET = {"nature": 1500}


def _name(pack: str, stem: str) -> str:
    return f"{pack}-{stem}".lower().replace("_", "-") + ".glb"


def import_sets(folders: list[Path], picks: Path = PICKS) -> dict:
    """Every piece the picks name, prepared from the pack zips in `folders`, and the index of each kind's
    pieces by role (only the pieces that were made)."""
    spec = json.loads(picks.read_text())
    zips = sorted({z for d in folders for z in d.glob("*.zip")})
    wanted = sorted({(p, s) for roles in spec["sets"].values() for ps in roles.values() for p, s in ps})
    out: dict[str, str] = {}
    with tempfile.TemporaryDirectory() as tmp:
        unpacked: dict[str, Path | None] = {}
        for pid, stem in wanted:
            name = _name(pid, stem)
            if (DIR / name).is_file():
                out[name] = "kept"
                continue
            if pid not in unpacked:
                z = _find(spec["packs"][pid], zips)
                unpacked[pid] = None
                if z:
                    unpacked[pid] = Path(tmp) / pid
                    with zipfile.ZipFile(z) as f:
                        f.extractall(unpacked[pid])
            if unpacked[pid] is None:
                out[name] = f"no zip for {pid}"
                continue
            f = _model(unpacked[pid], stem)
            if f is None:
                out[name] = f"no {stem} in {pid}"
                continue
            try:
                kit.library_model(f, name, out=DIR / name, triangles=BUDGET.get(pid, 4000), texture=512, plain=True)
                out[name] = "made"
            except Exception as e:  # noqa: BLE001 - one piece failing leaves the rest
                out[name] = f"failed: {str(e)[:160]}"
    index = {kind: {role: [f"sets/{_name(p, s)}" for p, s in ps if (DIR / _name(p, s)).is_file()] for role, ps in roles.items()}
             for kind, roles in spec["sets"].items()}
    INDEX.write_text(json.dumps({"about": "Written by fyt/sets.py from assets/set-picks.json: each kind of place's pieces by role.",
                                 "sources": {k: {"source": v["source"], "author": v["author"], "licence": "CC0"} for k, v in spec["packs"].items()},
                                 "sets": {k: {r: v for r, v in roles.items() if v} for k, roles in index.items()}}, indent=1) + "\n")
    pieces.cache_clear()
    return out


@lru_cache(maxsize=1)
def _index() -> dict:
    return json.loads(INDEX.read_text())["sets"] if INDEX.is_file() else {}


def pieces(kind: str) -> dict[str, list[str]]:
    """A kind of place's pieces by role, each a path under the renderer's public folder."""
    return _index().get(kind, {})


pieces.cache_clear = _index.cache_clear  # type: ignore[attr-defined]


def stage(kind: str, public: Path) -> dict[str, list[str]]:
    """A place's pieces, copied into the video's public folder."""
    got = pieces(kind)
    for src in {s for ss in got.values() for s in ss}:
        to = public / src
        if not to.is_file():
            to.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(RENDERER_DIR / "public" / src, to)
    return got
