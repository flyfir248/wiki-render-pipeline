"""Rigging: still library models made to move, with no hand work. A model with no skeleton (the Everything
Library's animals are single meshes) is read from its shape by renderer/rig-model.mjs: its legs, body,
neck, head and tail, or its wings, or a body that bends along its length. It is given a skeleton
through them, vertex weights and its own clips (a walk and a run that cover the ground they claim to,
standing, eating, attacking and lying still, or flying, or slithering and swimming), checked by posing
it, and written back in place. A shape it cannot read keeps its whole-body posing (the renderer's
stillPose) and the reason is recorded.

Learned riggers such as UniRig need a CUDA GPU with 8 GB or more; neither this project's machines nor
free GitHub runners have one, so the rigging here is geometric and runs anywhere.
"""
from __future__ import annotations

import json
import subprocess
import tempfile
from pathlib import Path

from fyt import assets, kit
from fyt.assetlib import RENDERER_DIR


def rig(path: Path, out: Path | None = None, kind: str = "auto") -> dict:
    """Rig one model file (in place unless `out`); returns rig-model.mjs's report: ok, type, clips, gait and
    checks, or ok false with the reason."""
    out = out or path
    with tempfile.TemporaryDirectory() as tmp:
        to = Path(tmp) / path.name
        r = subprocess.run(["node", "rig-model.mjs", str(path), str(to), "--type", kind], cwd=RENDERER_DIR,
                           capture_output=True, text=True, timeout=300)
        lines = [ln for ln in r.stdout.strip().splitlines() if ln.startswith("{")]
        if not lines:
            return {"ok": False, "reason": (r.stderr or r.stdout).strip()[-300:]}
        got = json.loads(lines[-1])
        if not got.get("ok") and kind == "auto" and "leave the ground" in got.get("reason", ""):
            # four legs found but too short to step on (a crocodile's): a body that bends, if it is long
            again = rig(path, out, "serpent")
            return again if again.get("ok") else got
        if got.get("ok"):
            out.write_bytes(to.read_bytes())
        return got


def rig_library(keys: list[str] | None = None) -> dict[str, str]:
    """Rig every still library model (the registry's `posed` entries, or the given keys) and record in the
    registry what each can now do: its clips and rig, or why it was left as it was. An entry's `rig_as`
    names the shape to read it as when its own shape would mislead (a caterpillar's many legs)."""
    reg = assets.registry()
    todo = keys or [k for k, e in reg.items() if e.get("kind") == "library" and e.get("posed")]
    entries, out = {}, {}
    for key in todo:
        e = dict(reg[key])
        f = assets.MODELS_DIR / e["src"]
        if e.get("rig") == "auto" or not f.is_file():
            out[key] = "kept" if e.get("rig") == "auto" else "no file"
            continue
        got = rig(f, kind=e.get("rig_as", "auto"))
        if got.get("ok"):
            e.update(clips=got["clips"], rig="auto", rig_type=got["type"])
            e.pop("rig_note", None)
            out[key] = f"{got['type']}: {', '.join(got['clips'])}"
        else:
            e.update(rig="none", rig_note=got.get("reason", "")[:200])
            out[key] = f"left still: {e['rig_note']}"
        entries[key] = e
    if entries:
        kit.register(entries)
    return out
