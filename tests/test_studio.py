import json
import shutil
from pathlib import Path

from fyt import studio

FIXTURE = Path(__file__).resolve().parent.parent / "fixtures" / "whatif_grow_one_metre.json"


def _queue(tmp_path, name="grow"):
    q = tmp_path / "studio" / "long"
    q.mkdir(parents=True)
    shutil.copy(FIXTURE, q / f"{name}.json")
    return tmp_path / "studio"


def _shots(tmp_path, files):
    d = tmp_path / "blender" / "never-stop-growing"
    d.mkdir(parents=True)
    (d / "manifest.json").write_text(json.dumps({"shots": [{"id": f[:-4], "file": f, "duration": 6.0, "from_m": 1, "to_m": 2} for f in files]}))
    return d


def test_waits_until_every_shot_is_there(tmp_path):
    q = _queue(tmp_path)
    d = _shots(tmp_path, ["G01.mp4", "G02.mp4"])
    (d / "G01.mp4").write_bytes(b"\0")
    assert studio.ready("long", set(), queue=q, root=tmp_path / "blender") == []
    (d / "G02.mp4").write_bytes(b"\0")
    assert [p.name for p in studio.ready("long", set(), queue=q, root=tmp_path / "blender")] == ["grow.json"]


def test_made_scripts_and_other_formats_are_skipped(tmp_path):
    q = _queue(tmp_path)
    d = _shots(tmp_path, ["G01.mp4"])
    (d / "G01.mp4").write_bytes(b"\0")
    assert studio.ready("long", {"studio:grow"}, queue=q, root=tmp_path / "blender") == []
    assert studio.ready("short", set(), queue=q, root=tmp_path / "blender") == []


def test_missing_shot_set_is_reported(tmp_path):
    s = studio.load(FIXTURE)
    assert studio.missing_shots(s, root=tmp_path) == ["never-stop-growing/manifest.json"]
