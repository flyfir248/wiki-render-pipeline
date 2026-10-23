"""Models picked from free (CC0) packs downloaded by hand, imported once into the project library.

assets/library-picks.json names each pack and, for every model picked from it, the library key and the
words a story uses for it; `import_picks` finds the packs' zips in the given folders, prepares each
picked model (fyt/kit.py library_model) and writes the registry entries. The prepared models are
committed, so a run needs neither the zips nor the network for them.
"""
from __future__ import annotations

import json
import tempfile
import zipfile
from pathlib import Path

from fyt import kit

PICKS = kit.BUNDLED.parent / "library-picks.json"
ORDER = (".glb", ".gltf", ".fbx")


def _find(pack: dict, zips: list[Path]) -> Path | None:
    """The zip of a pack: by its file name, or (a Google Drive download, named by date) by a file it has
    or the title in its licence."""
    for z in zips:
        if "zip" in pack and z.name.endswith(pack["zip"]):
            return z
    for z in zips:
        if "zip" in pack:
            break
        try:
            with zipfile.ZipFile(z) as f:
                names = f.namelist()
                if "has" in pack and any(Path(n).name == pack["has"] for n in names):
                    return z
                lic = [n for n in names if Path(n).name.lower() == "license.txt"]
                if "licence_title" in pack and lic and pack["licence_title"] in f.read(lic[0]).decode("utf8", "replace"):
                    return z
        except zipfile.BadZipFile:
            continue
    return None


def _model(root: Path, stem: str, within: str = "") -> Path | None:
    """The picked model in an unpacked pack (under a folder named `within`, when given), best format first
    (a Unity export last: its axes differ)."""
    found = [p for p in root.rglob("*") if p.stem == stem and p.suffix.lower() in ORDER and within in str(p.relative_to(root))]
    found.sort(key=lambda p: (ORDER.index(p.suffix.lower()), "unity" in str(p).lower(), len(str(p))))
    return found[0] if found else None


def import_picks(folders: list[Path], picks: Path = PICKS) -> dict:
    spec = json.loads(picks.read_text())
    zips = sorted({z for d in folders for z in d.glob("*.zip")})
    out, entries = {}, {}
    with tempfile.TemporaryDirectory() as tmp:
        unpacked: dict[str, Path | None] = {}
        for pid, stem, key, names, *more in spec["picks"]:
            extra = dict(more[0]) if more else {}
            within = extra.pop("in", "")
            keep = extra.pop("clips", None)
            pack = spec["packs"][pid]
            if pid not in unpacked:
                z = _find(pack, zips)
                unpacked[pid] = None
                if z:
                    unpacked[pid] = Path(tmp) / pid
                    with zipfile.ZipFile(z) as f:
                        f.extractall(unpacked[pid])
            if unpacked[pid] is None:
                out[key] = f"no zip for {pid}"
                continue
            f = _model(unpacked[pid], stem, within)
            if f is None:
                out[key] = f"no {stem} in {pid}"
                continue
            try:
                made = kit.library_model(f, key, keep)
            except Exception as e:  # noqa: BLE001 - one model failing leaves the rest
                out[key] = f"failed: {str(e)[:160]}"
                continue
            entries[key] = {"kind": "library", "subject": "library", "variant": stem.lower(), "names": names,
                            "title": f"{stem} ({pid})", "source": pack["source"], "licence": "CC0", "author": pack["author"]} | extra | made
            out[key] = f"{len(made['clips'])} clips" if made["clips"] else "still"
    kit.register(entries)
    return out
