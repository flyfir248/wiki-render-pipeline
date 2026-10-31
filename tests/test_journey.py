import json
from pathlib import Path

from fyt import journey
from fyt.models import Script

FIXTURE = Path(__file__).resolve().parent.parent / "fixtures" / "whatif_growing_journey.json"


def _script(**over):
    data = json.loads(FIXTURE.read_text())
    data.update(over)
    return Script.model_validate(data)


def _spans(n, dur=4.0):
    return [(i * dur, i * dur + dur - 0.3) for i in range(n)]


def test_fixture_is_a_clean_journey():
    s = _script()
    assert journey.is_journey(s)
    assert journey.problems(s) == []


def test_build_keys_rise_and_cold_open_ends_with_first_beat():
    s = _script()
    props = journey.build(s, _spans(len(s.scenes)))
    Ls = [k["L"] for k in props["keys"]]
    ts = [k["t"] for k in props["keys"]]
    assert Ls == sorted(Ls) and ts == sorted(ts)
    assert Ls[-1] > 26  # the observable universe, ~8.8e26 m
    assert props["coldOpen"] == 4.0
    assert props["keys"][0]["t"] == 4.0  # the journey proper starts after the cold open
    assert props["title"]["text"] == s.title and props["title"]["from"] == 4.0
    assert props["measure"] == "YOUR HEIGHT"


def test_build_marks_and_gauges():
    s = _script()
    props = journey.build(s, _spans(len(s.scenes)))
    names = [m["name"] for m in props["marks"]]
    assert "Mount Everest" in names or any("Everest" in n for n in names)
    assert [m["L"] for m in props["marks"]] == sorted(m["L"] for m in props["marks"])
    assert props["gauges"] and all(g["label"] == g["label"].upper() for g in props["gauges"])


def test_problems_catch_short_backwards_and_wordy_journeys():
    s = _script()
    short = s.model_copy(update={"scenes": s.scenes[:5]})
    assert any("at least" in p for p in journey.problems(short))
    scenes = [sc.model_copy() for sc in s.scenes]
    scenes[10] = scenes[10].model_copy(update={"scale": 0.001, "narration": " ".join(["word"] * 30)})
    bad = journey.problems(s.model_copy(update={"scenes": scenes}))
    assert any("backwards" in p for p in bad) and any("22 words" in p for p in bad)


def test_plain_script_is_not_a_journey():
    s = _script(journey=None)
    assert not journey.is_journey(s)
