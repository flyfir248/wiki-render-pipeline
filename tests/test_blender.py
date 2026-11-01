import json
from pathlib import Path

from fyt import blender, journey
from fyt.models import Script

FIXTURE = Path(__file__).resolve().parent.parent / "fixtures" / "whatif_growing_journey.json"


def _script(name="growing"):
    data = json.loads(FIXTURE.read_text())
    data["journey"] = {**data["journey"], "blender": name}
    return Script.model_validate(data)


def _shots(tmp_path, shots, name="growing"):
    d = tmp_path / name
    d.mkdir(parents=True)
    for s in shots:
        (d / s["file"]).write_bytes(b"\0")
    (d / "manifest.json").write_text(json.dumps({"fps": 30, "shots": shots}))
    return tmp_path


def _spans(n, dur=4.0):
    starts = [i * dur for i in range(n)]
    return starts, [s + dur for s in starts]


STREET = {"id": "G01", "file": "G01.mp4", "duration": 6.0, "from_m": 1.8, "to_m": 8.0}
HOUSES = {"id": "G02", "file": "G02.mp4", "duration": 6.0, "from_m": 9.0, "to_m": 50.0}


def test_no_blender_key_means_no_clips(tmp_path):
    s = Script.model_validate(json.loads(FIXTURE.read_text()))
    assert blender.segments(s, *_spans(len(s.scenes)), root=_shots(tmp_path, [STREET])) == []


def test_clips_cover_the_beats_in_their_height_range(tmp_path):
    s = _script()
    root = _shots(tmp_path, [STREET, HOUSES])
    starts, ends = _spans(len(s.scenes))
    segs = blender.segments(s, starts, ends, first=1, root=root)
    assert [c["id"] for c in segs] == ["G01", "G02"]
    street, houses = segs
    # fixture beats 3-5 are 1.8, 2.4 and 5 m: 12 s of narration for a 6 s clip, slowed to the 0.5 limit
    assert street["from"] == starts[3] and street["rate"] == 0.5 and street["to"] == starts[3] + 12.0
    assert street["src"] == "blender/G01.mp4"
    # beats 6-8 (10, 20, 45 m) follow straight on, and the two never overlap
    assert houses["from"] == starts[6] >= street["to"]


def test_short_span_speeds_up_within_limits_and_missing_files_are_skipped(tmp_path):
    s = _script()
    root = _shots(tmp_path, [STREET])
    (root / "growing" / "G01.mp4").unlink()
    assert blender.segments(s, *_spans(len(s.scenes)), first=1, root=root) == []
    root2 = _shots(tmp_path / "b", [STREET])
    segs = blender.segments(s, *_spans(len(s.scenes), dur=1.6), first=1, root=root2)
    assert segs[0]["rate"] == 1.25  # 4.8 s of beats for a 6 s clip: sped up, capped
    assert segs[0]["to"] - segs[0]["from"] == 4.8


def test_stage_copies_clips_into_public(tmp_path):
    s = _script()
    root = _shots(tmp_path / "lib", [STREET, HOUSES])
    public = tmp_path / "public"
    assert blender.stage(s, public, root=root) == ["G01.mp4", "G02.mp4"]
    assert (public / "blender" / "G02.mp4").exists()


def test_scene_shots_become_video_scenes(tmp_path):
    data = json.loads((FIXTURE.parent / "whatif_no_gravity.json").read_text(encoding="utf-8"))
    s = Script.model_validate(data)
    z1 = {"id": "Z01", "file": "Z01.mp4", "duration": 9.0}
    root = _shots(tmp_path, [z1], name="no-gravity")
    media = blender.scene_media(s, root=root)
    wanted = [i for i, sc in enumerate(s.scenes) if sc.blender_shot == "Z01"]
    assert sorted(media) == wanted and media[wanted[0]].src == "blender/Z01.mp4"
    assert all(media[i].kind == "video" for i in media)
    # Z02/Z03 aren't in this shot set, so their scenes keep their own type
    out = blender.as_video_scenes(s, media)
    assert [out.scenes[i].type for i in wanted] == ["broll"] * len(wanted)
    others = [i for i, sc in enumerate(s.scenes) if sc.blender_shot and i not in media]
    assert all(out.scenes[i].type == s.scenes[i].type for i in others)


def test_journey_props_carry_clips(tmp_path, monkeypatch):
    monkeypatch.setattr(blender, "ROOT", _shots(tmp_path, [STREET]))
    s = _script()
    props = journey.build(s, [(a, b - 0.3) for a, b in zip(*_spans(len(s.scenes)))])
    assert [c["id"] for c in props["clips"]] == ["G01"]
