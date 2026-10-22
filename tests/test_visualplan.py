"""The visual plan every video gets: which moments become 3D reconstructions, and the guards that keep
them true to the narration (fyt/visualplan.py, fyt/scenes3d.py, renderer/src/scenes/world/catalog.json)."""
import re
from pathlib import Path

from fyt import llm, scenes3d, visualplan
from fyt.config import Config
from fyt.models import Script, ScriptScene, Word
from fyt.timeline import build_props, cue_time, key_moment

ROOT = Path(__file__).resolve().parent.parent


def script(*lines: str, title: str = "A true story", types: list[str] | None = None) -> Script:
    return Script(
        title=title,
        description="D",
        tags=["a"],
        thumbnail_text="X",
        thumbnail_kicker="K",
        thumbnail_query="q",
        scenes=[ScriptScene(narration=t, type=(types or [])[i] if types else "statement", text="t") for i, t in enumerate(lines)],
        sources=["https://example.com"],
    )


def world(script_: Script) -> list[tuple[int, str, str]]:
    return [(i, s.subject, s.action) for i, s in enumerate(script_.scenes, 1) if s.type == "world"]


def planned(*lines: str, fmt: str = "short", notes: str = "", **kw) -> tuple[Script, dict]:
    def offline(*a, **k):
        raise RuntimeError("offline")

    old = visualplan._llm_plan
    visualplan._llm_plan = offline
    try:
        return visualplan.plan(Config(format=fmt, visuals={"painted": False}), script(*lines, **kw), notes, log=lambda m: None)
    finally:
        visualplan._llm_plan = old


# The rule planner picks a different treatment for each kind of story, from the catalog alone.

def test_volcano_story_gets_an_eruption_and_a_tsunami():
    s, report = planned(
        "In 1883 the island of Krakatoa sat quietly in the strait.",
        "Then in August the volcano began to erupt, throwing an ash cloud miles high.",
        "Within hours a tsunami thirty metres tall swept the coast.",
        "Over thirty thousand people died.",
    )
    acts = world(s)
    assert (2, "landscape", "erupt") in acts and (3, "landscape", "tsunami") in acts
    assert report["planner"] == "rules"
    # A documented event is a reconstruction; it is not labelled as an illustration.
    assert not s.scenes[1].illustrative and s.scenes[1].cue == "erupt"


def test_rail_story_gets_a_derailment_not_a_ship_or_plane():
    s, _ = planned(
        "The night express left the station packed with passengers.",
        "Near the bend the train derailed at full speed.",
        "Rescuers worked through the night.",
    )
    assert (2, "train", "derail") in world(s)
    assert all(subj == "train" for _, subj, _ in world(s))


def test_storm_carries_on_and_the_train_does_not_cross_after_the_collapse():
    s, _ = planned(
        "In 1879 the Tay Bridge was the longest railway bridge in the world.",
        "That night a violent storm was blowing as a passenger train set out across the bridge.",
        "As the train crossed the high girders, the bridge collapsed and fell into the river.",
        "The inquiry found the bridge had been badly designed.",
    )
    assert world(s)[-1] == (3, "train", "bridge_collapse") and s.scenes[3].type == "statement"
    assert s.scenes[2].weather == "storm" and s.scenes[2].cue == "bridge collapsed"


def test_space_and_rocket_stories():
    s, _ = planned(
        "The rocket stood on the launch pad as the countdown ran.",
        "At liftoff the engines roared and it climbed into the sky.",
        "Two minutes later the first stage fell away.",
    )
    assert {a for _, subj, a in world(s) if subj == "rocket"} >= {"launch", "separation"}

    s, _ = planned(
        "Sixty-six million years ago an asteroid ten kilometres wide approached the Earth.",
        "It struck the Yucatan with the force of billions of bombs.",
    )
    assert (2, "space", "impact") in world(s)
    assert s.scenes[1].obstacle == "earth"


def test_city_fire_keeps_its_city_and_a_chart_story_gets_no_3d():
    s, _ = planned(
        "In 1666 London was a city of timber houses and narrow streets.",
        "On the second of September a fire broke out in a bakery and the blaze spread through the town.",
        title="The Great Fire of London",
    )
    assert (2, "city", "fire") in world(s)
    assert s.scenes[1].subject_name == s.scenes[0].subject_name or s.scenes[0].type != "world"

    s, report = planned(
        "Inflation measures how fast prices rise.",
        "Economists compare a basket of goods year on year.",
        "That number guides interest rates.",
    )
    assert world(s) == [] and report["world_seconds"] == 0


def test_no_fixed_share_of_3d():
    # An incident told beat by beat may be mostly reconstruction; nothing caps it at one scene in three.
    s, _ = planned(
        "The ship steamed across the Atlantic at night.",
        "At 11:40 the ship struck an iceberg on her starboard side.",
        "The ship began to list as water poured in.",
        "By 2:20 the ship sank beneath the waves.",
    )
    assert len(world(s)) >= 3


# The guards: nothing is shown that the narration doesn't say.

def test_an_event_the_narration_does_not_name_is_not_drawn():
    scene = ScriptScene(narration="The train ran north through the hills.", type="world", subject="train", action="derail")
    out = scenes3d.guard(scene)
    assert out.action == "travel" and out.illustrative and out.cue is None


def test_weather_and_effects_need_the_words():
    scene = ScriptScene(narration="The plane cruised over the sea.", type="world", subject="aircraft", action="cruise",
                        weather="storm", effect="fire")
    out = scenes3d.guard(scene)
    assert out.weather is None and out.effect is None
    # Weather the sources describe may be shown even when this scene doesn't repeat it.
    assert scenes3d.guard(scene, "That night a violent thunderstorm sat over the route.").weather == "storm"
    named = scene.model_copy(update={"narration": "Flames streamed from the left engine as the plane cruised on."})
    assert scenes3d.guard(named).effect == "fire"


def test_ambiguous_words_do_not_trigger_disasters():
    # "wave", "ash" and "fell" are not a tsunami, an eruption and a collapse.
    s, _ = planned(
        "The mountain town waved goodbye to the summer.",
        "Ash trees lined the road as the leaves fell.",
    )
    assert all(a in ("flyover",) for _, _, a in world(s))


def test_the_model_plan_is_applied_and_guarded(monkeypatch):
    seen = {}

    def fake(cfg, system, user, model, max_tokens=0):
        seen["system"] = system
        return visualplan.VisualPlan(reconstructions=[
            visualplan.Reconstruction(scene=2, subject="landscape", variant="volcano", action="erupt", cue="exploded", priority=1),
            visualplan.Reconstruction(scene=1, subject="city", action="collapse", priority=1),  # no city in the narration
            visualplan.Reconstruction(scene=9, subject="train", action="travel"),  # no such scene
        ])

    monkeypatch.setattr(llm, "structured", fake)
    s, report = visualplan.plan(Config(format="short", visuals={"painted": False}), script(
        "Mount Tambora stood over the island of Sumbawa.",
        "In April 1815 the volcano exploded in the largest eruption in recorded history.",
    ), "", log=lambda m: None)
    assert report["planner"] == "model"
    assert "landscape" in seen["system"] and "rocket" in seen["system"]  # the catalog reaches the planner
    assert world(s) == [(2, "landscape", "erupt")]  # a city over "Mount Tambora stood..." is not shown
    assert s.scenes[0].type == "statement" and not s.scenes[1].illustrative
    assert s.scenes[1].cue == "exploded"


def test_budget_keeps_the_highest_ranked_reconstructions():
    cfg = Config(format="short", visuals={"painted": False})
    cfg.visuals.world_seconds_short = 6.0
    line = "The ship struck the iceberg and began to sink quickly into the freezing dark water below."
    calm = "The ship sailed calmly on across the wide open ocean under a clear sky that night."
    sc = script(calm, "-", line)
    plan_ = [
        visualplan.Reconstruction(scene=1, subject="ship", action="sail", priority=3),
        visualplan.Reconstruction(scene=3, subject="ship", action="collide", priority=1),
    ]
    out, ranked = visualplan.apply(sc, plan_)
    out, dropped = visualplan.within_budget(cfg, sc, out, ranked)
    assert dropped == [0] and out.scenes[0].type == "statement" and out.scenes[2].type == "world"


def test_a_real_photo_stays():
    sc = script("The ship struck an iceberg.", types=["broll"])
    sc.scenes[0].image = "photo.jpg"
    assert not visualplan.convertible(sc.scenes[0])


# Legacy scenes, timing and the catalog shared with the renderer.

def test_legacy_aircraft_and_ship_scenes_become_world_scenes():
    a = scenes3d.legacy_to_world(ScriptScene(narration="x", type="aircraft", maneuver="land"))
    assert (a.type, a.subject, a.action) == ("world", "aircraft", "land")
    b = scenes3d.legacy_to_world(ScriptScene(narration="x", type="ship", vessel="liner", ship_action="sink"))
    assert (b.type, b.subject, b.variant, b.action) == ("world", "ship", "liner", "sink")


def test_key_moment_lands_on_the_cue_words():
    words = [Word(word=w, start=i * 0.5, end=i * 0.5 + 0.4) for i, w in enumerate("then the ship struck the iceberg".split())]
    assert cue_time("struck", words, 0.0) == 1.5
    assert cue_time("the iceberg", words, 0.0) == 2.0  # a phrase, not its first "the"
    assert cue_time("icebergs", words, 0.0) == 2.5  # same stem
    assert cue_time("anchor", words, 0.0) is None
    scene = ScriptScene(narration="then the ship struck the iceberg", type="world", subject="ship", action="collide", cue="struck")
    assert key_moment(scene, words, 0.0, 4.0) == round((1.5 + 0.15) / 4, 3)
    # No cue: the catalog's moment for the action.
    assert key_moment(scene.model_copy(update={"cue": None}), words, 0.0, 4.0) == scenes3d.moment("ship", "collide")


def test_world_scene_reaches_the_renderer():
    sc = script("Near the bend the train derailed at full speed.", types=["world"])
    sc.scenes[0] = scenes3d.guard(sc.scenes[0].model_copy(update={"subject": "train", "action": "derail"}))
    words = [[Word(word=w, start=i * 0.4, end=i * 0.4 + 0.3) for i, w in enumerate(sc.scenes[0].narration.split())]]
    props = build_props(Config(format="short"), sc, [(0.0, 4.0)], words, {}, None, None)
    scene = props.scenes[0]
    assert (scene.type, scene.subject, scene.action, scene.illustrative) == ("world", "train", "derail", False)
    assert 0.05 <= scene.effectAt <= 0.9 and scene.seed is not None


def test_every_catalog_subject_has_a_renderer_module_and_guide_entry():
    index = (ROOT / "renderer/src/scenes/world/index.tsx").read_text()
    block = re.search(r"MODULES[^{]*\{(.*?)\};", index, re.S).group(1)
    registered = set(re.findall(r"^\s*(\w+):", block, re.M))
    assert set(scenes3d.SUBJECTS) == registered
    guide = scenes3d.guide_text()
    assert all(subject in guide for subject in scenes3d.SUBJECTS)
    assert "world" in llm.SCRIPT_GUIDE and "<<WORLD SCENE>>" not in llm.SCRIPT_GUIDE


def test_painted_videos_tell_events_in_pictures_and_keep_3d_for_diagrams(monkeypatch):
    monkeypatch.setattr(visualplan, "_llm_plan", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("offline")))
    sc = script(
        "In 1883 the island of Krakatoa sat quietly in the strait.",
        "Then in August the volcano began to erupt, throwing an ash cloud miles high.",
        "The liner struck the iceberg at full speed.",
        types=["statement", "statement", "world"],
    )
    sc.scenes[2] = sc.scenes[2].model_copy(update={"subject": "ship", "action": "crash"})
    s, report = visualplan.plan(Config(format="short"), sc, "", log=lambda m: None)
    assert world(s) == [] and report["world_seconds"] == 0
    assert s.scenes[2].type == "statement" and s.scenes[2].narration.startswith("The liner")
    cell = script("Red blood cells carry oxygen through the body.", types=["world"])
    cell.scenes[0] = cell.scenes[0].model_copy(update={"subject": "science", "variant": "red blood cell"})
    assert visualplan.unstaged(cell).scenes[0].type == "world"
