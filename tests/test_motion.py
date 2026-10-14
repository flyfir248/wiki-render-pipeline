"""Code-drawn motion-graphics scenes: what the script writer fills in, and the contact sheet."""

from PIL import Image

from fyt import qa
from fyt.config import Config
from fyt.models import DataPoint, Script, ScriptScene, Word
from fyt.sheet import frame_times, tile
from fyt.timeline import build_props


def script(*scenes: ScriptScene) -> Script:
    return Script(title="T", description="D", tags=["a"], thumbnail_text="X", thumbnail_kicker="K",
                  thumbnail_query="q", scenes=list(scenes), sources=["https://example.com"])


def words(text: str, every: float = 0.5) -> list[Word]:
    return [Word(word=w, start=i * every, end=i * every + 0.3) for i, w in enumerate(text.split())]


def test_scale_things_appear_smallest_first_as_they_are_named():
    s = script(ScriptScene(narration="x", type="scale", data=[
        DataPoint(label="Krakatoa", value=200000), DataPoint(label="Hiroshima bomb", value=15),
        DataPoint(label="Tsar Bomba", value=50000)]))
    said = words("first Hiroshima then the Tsar Bomba and finally Krakatoa itself")
    props = build_props(Config(), s, [(0.0, 6.0)], [said], {}, None, None)
    assert props.scenes[0].revealTimes == [0.5, 2.0, 4.0]
    assert qa.check_script(Config(), s) == []


def test_cycle_steps_appear_as_they_are_said():
    s = script(ScriptScene(narration="x", type="cycle", items=["Magma pushes up", "Cone grows steep", "Flank collapses"]))
    said = words("magma rises the cone steepens and then a flank collapses")
    props = build_props(Config(), s, [(0.0, 6.0)], [said], {}, None, None)
    assert props.scenes[0].revealTimes == [0.0, 1.5, 4.0]


def test_new_scenes_are_checked_for_their_data():
    bad = script(
        ScriptScene(narration="x", type="trend", data=[DataPoint(label="1990", value=1)]),
        ScriptScene(narration="x", type="scale", data=[DataPoint(label="a", value=3), DataPoint(label="b", value=0)]),
        ScriptScene(narration="x", type="proportion", value=140),
        ScriptScene(narration="x", type="cycle", items=["a", "b"]),
    )
    problems = " | ".join(qa.check_script(Config(), bad))
    for what in ("trend line", "size comparison", "proportion", "cycle"):
        assert what in problems
    good = script(ScriptScene(narration="x", type="proportion", value=67))
    assert qa.check_script(Config(), good) == []


def test_contact_sheet_lays_frames_in_a_grid(tmp_path):
    assert frame_times(3.0, 1.0) == [0.0, 1.0, 2.0]
    assert len(frame_times(600.0, 1.0)) == 60  # long videos are sampled, not dumped
    shots = []
    for i in range(5):
        f = tmp_path / f"{i}.png"
        Image.new("RGB", (960, 540), (i * 40, 0, 0)).save(f)
        shots.append((float(i), f))
    out = tile(shots, tmp_path / "sheet.png")
    w, h = Image.open(out).size
    assert (w, h) == (480 * 4 + 12, 270 * 2 + 4)


def test_scripts_can_ask_for_the_signature_cuts():
    s = script(ScriptScene(narration="x", type="statement", text="t", transition="thread"),
               ScriptScene(narration="y", type="statement", text="t", transition="whip"))
    props = build_props(Config(), s, [(0.0, 1.0), (1.0, 2.0)], [[], []], {}, None, None)
    assert [sc.transition for sc in props.scenes] == ["thread", "whip"]
