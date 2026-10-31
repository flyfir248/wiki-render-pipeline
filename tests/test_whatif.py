import json
from pathlib import Path

from fyt import artdirect, scenes3d, whatif
from fyt.models import Script, ScriptScene, WhatIfScript

FIXTURE = Path(__file__).resolve().parent.parent / "fixtures" / "whatif_sea_short.json"


def _script(scenes, title="What If the Sea Rose 1 Metre Every Day?"):
    return Script(title=title, description="d", tags=["t"], thumbnail_text="x", thumbnail_kicker="k", thumbnail_query="q",
                  sources=[], scenes=[ScriptScene(type="statement", narration=f"line {i}", **s) for i, s in enumerate(scenes)])


def test_a_whatif_topic_names_its_premise_and_title():
    assert whatif.is_whatif_topic("whatif:the sea rose one metre every day")
    assert not whatif.is_whatif_topic("wiki:Krakatoa")
    assert whatif.premise_of("whatif: What if the Moon were twice as close?") == "the Moon were twice as close"
    assert whatif.title_for("the sea rose one metre every day") == "What If the Sea Rose One Metre Every Day?"


def test_clock_stamps_parse_to_seconds():
    assert whatif.clock_seconds("DAY 2") == 2 * 86400
    assert whatif.clock_seconds("day 1,609") == 1609 * 86400
    assert whatif.clock_seconds("YEARS 24") == 24 * 365.25 * 86400
    assert whatif.clock_seconds("THE END") is None
    assert whatif.clean_stamp("minutes 10") == "MINUTE 10"


def test_normalize_carries_the_clock_and_never_lets_the_level_fall():
    s = whatif.normalize(_script([
        {"clock": "day 0", "level": 0.0},
        {"level": 0.2},  # no clock: still day 0
        {"clock": "DAY 3", "clock_note": "+3 m", "level": 0.1},  # a fall: held at 0.2
        {"clock": "DAY 3", "level": 1.4},  # clamped to 1
    ]), "the sea rose one metre every day")
    assert [x.clock for x in s.scenes] == ["DAY 0", "DAY 0", "DAY 3", "DAY 3"]
    assert [x.level for x in s.scenes] == [0.0, 0.2, 0.2, 1.0]
    assert s.scenes[3].clock_note == "+3 m"  # the stage's total carries to its later scenes
    assert s.series == whatif.SERIES


def test_normalize_gives_a_reworded_title_its_premise_back():
    s = whatif.normalize(_script([{"clock": "DAY 0"}], title="The Day the Oceans Rose"), "the sea rose one metre every day")
    assert s.title.startswith("What If")


def test_problems_catch_a_ladder_that_goes_backwards_or_is_too_short():
    assert whatif.problems(whatif.normalize(Script.model_validate(json.loads(FIXTURE.read_text())))) == []
    back = _script([{"clock": "DAY 10"}, {"clock": "DAY 2"}, {"clock": "DAY 30"}, {"clock": "DAY 40"}])
    assert any("backwards" in p for p in whatif.problems(back))
    short = _script([{"clock": "DAY 1"}, {"clock": "DAY 2"}])
    assert any("at least 4" in p for p in whatif.problems(short))


def test_the_whatif_schema_asks_for_clocks_and_the_usual_one_does_not():
    assert "clock" in json.dumps(WhatIfScript.model_json_schema())
    assert "clock" not in json.dumps(Script.model_json_schema())


def test_a_whatif_stage_keeps_its_flood_and_is_labelled_an_illustration():
    scene = ScriptScene(type="world", subject="city", variant="modern", action="flood", narration="By day two the sea covers the streets.", level=0.1)
    g = scenes3d.guard(scene)
    assert g.action == "flood" and g.illustrative
    # the same scene in a true story, with no flood in its words, shows the city calmly
    assert scenes3d.guard(scene.model_copy(update={"level": None})).action != "flood"


def test_whatif_videos_take_their_own_look():
    s = whatif.normalize(Script.model_validate(json.loads(FIXTURE.read_text())))
    assert artdirect.choose(s) == "whatif"
