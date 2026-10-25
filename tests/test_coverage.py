"""3D first (fyt/visualplan.py fill, fyt/worldgen.py livelier, fyt/coverage.py): scenes of the story's own
cast fill the video toward the 3D target only where something will move, data scenes keep their figures
over the 3D scene, and the coverage report counts a scene as animated only when its subject or its place
moves, never for the camera alone."""
from pathlib import Path

from fyt import coverage, llm, relevance, visualplan, worldgen
from fyt.config import Config
from fyt.manifest import Entity, Manifest, Moment, Place
from fyt.models import RenderProps, RenderScene, Script, ScriptScene, Word
from fyt.timeline import land_times, revealed


def _offline(monkeypatch):
    def fail(*a, **k):
        raise RuntimeError("offline")
    monkeypatch.setattr(llm, "structured", fail)


def _bear_story() -> tuple[Script, Manifest]:
    lines = [
        ("statement", "A black bear wandered out of the Georgia forest."),
        ("map", "The forest lies in the north of Georgia."),
        ("stat", "The bear found forty kilograms of cocaine in the woods."),
        ("timeline", "The bear was found dead and later stuffed for a museum display."),
        ("list", "Rangers searched the forest for the rest of the bags."),
    ]
    sc = Script(title="Cocaine Bear", description="D", tags=["a"], thumbnail_text="X", thumbnail_kicker="K", thumbnail_query="q",
                scenes=[ScriptScene(narration=t, type=k, text="t", heading="h", value=40 if k == "stat" else None, suffix=" kg" if k == "stat" else None,
                                    items=["bags", "dogs"] if k == "list" else None,
                                    events=[{"label": "1985", "text": "found"}] if k == "timeline" else None) for k, t in lines],
                sources=["https://example.com"])
    m = Manifest(
        entities=[Entity(id="bear", name="black bear", kind="animal", search=["black bear"], look="black bear", certain=True, scenes=[1, 3, 4]),
                  Entity(id="ranger", name="park ranger", kind="person", search=["park ranger"], look="ranger in uniform", certain=True, scenes=[5])],
        places=[Place(id="forest", name="Georgia forest", look="pine forest", scenes=[1, 2, 3, 4, 5])],
        moments=[Moment(scene=1, entity="bear", place="forest", action="wanders", motion="move", cue="wandered", documented=True)],
    )
    return sc, m


def test_data_scenes_become_3d_with_their_figures_where_something_moves(monkeypatch):
    _offline(monkeypatch)
    sc, m = _bear_story()
    cfg = Config()
    cfg.format = "short"
    planned, report = visualplan.plan(cfg, sc, story=m)
    kinds = [s.type for s in planned.scenes]
    assert kinds[0] == "world" and kinds[1] == "map"  # a map stays a map
    assert planned.scenes[2].type == "world" and planned.scenes[2].overlay == "stat" and planned.scenes[2].value == 40
    assert planned.scenes[4].type == "world" and planned.scenes[4].overlay == "list" and planned.scenes[4].subject_name == "ranger"
    # the dead, stuffed bear would only stand there: its timeline stays a timeline
    assert planned.scenes[3].type == "timeline"
    assert set(report["filled"]) == {3, 5} and report["world_share"] > 0.5 and report["target_share"] == 0.8
    # the 2D scene each one replaced is kept to fall back to
    assert planned.scenes[2].fallback["type"] == "stat"


def test_no_fill_beyond_the_target(monkeypatch):
    _offline(monkeypatch)
    sc, m = _bear_story()
    cfg = Config()
    cfg.format = "short"
    cfg.visuals.world_share_short = 0.15
    planned, report = visualplan.plan(cfg, sc, story=m)
    assert report["filled"] == [] and sum(s.type == "world" for s in planned.scenes) == 1


def test_overlay_figures_land_on_the_words():
    s = ScriptScene(narration="It held forty kilograms.", type="world", overlay="stat", value=40)
    words = [Word(word=w, start=i * 0.4, end=i * 0.4 + 0.3) for i, w in enumerate("It held forty kilograms.".split())]
    assert land_times(s, words, 0.0) == [1.1]  # as "forty" is said
    assert revealed(ScriptScene(narration="n", type="world", overlay="list", items=["a", "b"])) == ["a", "b"]
    assert revealed(ScriptScene(narration="n", type="world", overlay="timeline", events=[{"label": "1985", "text": "x"}])) == ["1985"]


def _shot(verb: str, arche: str, form: str = "") -> tuple[dict, dict]:
    b = worldgen.Build(entity="x", archetype=arche, size=2, primary="#000000", secondary="#000000", accent="#000000", form=form)
    return {1: worldgen.Shot(scene=1, actors=[worldgen.Actor(entity="x", verb=verb)], camera="orbit", on="x")}, {"x": b}


def _sc(text: str) -> Script:
    return Script(title="T", description="D", tags=["a"], thumbnail_text="X", thumbnail_kicker="K", thumbnail_query="q",
                  scenes=[ScriptScene(narration=text, type="world")], sources=["https://example.com"])


def test_a_subject_left_standing_acts_unless_the_narration_says_it_is_still():
    verb = lambda text, arche, form="", v="idle": worldgen.livelier(*_shot(v, arche, form)[:1], _sc(text), _shot(v, arche, form)[1])[1].actors[0].verb  # noqa: E731
    assert verb("A bear roamed the hills.", "quadruped") == "walk"
    assert verb("The bear was found dead.", "quadruped") == "idle"
    assert verb("It is now on display in a mall.", "quadruped") == "idle"
    assert verb("Geese crossed the river.", "bird") == "fly"
    assert verb("Geese stood on the shore.", "bird") == "walk"
    assert verb("The car left town.", "vehicle", "car", "present") == "drive"
    assert verb("The liner left Southampton.", "vehicle", "liner", "present") == "move"
    assert verb("The airliner left LaGuardia.", "vehicle", "airliner", "present") == "fly"
    assert verb("The car was parked outside.", "vehicle", "car", "present") == "present"
    # walking across the set, followed
    sh = worldgen.livelier(*_shot("idle", "humanoid")[:1], _sc("A ranger searched."), _shot("idle", "humanoid")[1])[1]
    assert (sh.actors[0].at, sh.actors[0].to, sh.camera) == ("left", "right", "follow")


def _props(world: dict, seconds: float = 5.0) -> RenderProps:
    return RenderProps.model_validate({"format": "short", "fps": 30, "title": "t", "duration": seconds, "theme": Config().theme.model_dump(),
                                       "scenes": [RenderScene(id="s1", type="world", start=0, end=seconds, world=world).model_dump()], "captions": [],
                                       "voice": None, "music": None, "showCaptions": False, "showVisualizer": False})


def _world(verb: str, kind: str, time: str = "day") -> dict:
    return {"set": {"kind": kind, "time": time, "place": kind}, "camera": "orbit", "on": "bear",
            "cast": [{"entity": "bear", "verb": verb, "build": {"parts": []}, "model": {"src": "models/bear.glb", "clips": ["Walk"]}}], "beats": []}


def test_coverage_counts_motion_not_the_camera():
    cfg = Config()
    cfg.format = "short"
    sc = _sc("A bear.")
    walking = coverage.build(cfg, sc, _props(_world("walk", "forest")))
    assert walking["share_3d"] == 1.0 and walking["share_animated"] == 1.0 and walking["scenes"][0]["secondary"] == ["its own animation"]
    # an orbiting camera round a bear standing in a forest, with birds far off, is a still scene
    standing = coverage.build(cfg, sc, _props(_world("idle", "forest")))
    assert standing["share_animated"] == 0.0 and standing["static"] == [1] and standing["share_camera_moving"] == 1.0
    assert any("stand still" in w for w in coverage.warnings(standing))
    # water moving round it is the place moving
    assert coverage.build(cfg, sc, _props(_world("idle", "river")))["share_animated"] == 1.0
    assert "3D coverage" in coverage.markdown(walking)


def test_a_failed_frame_gets_a_closer_take_once():
    s = ScriptScene(narration="n", type="world", subject_name="container",
                    world={"camera": "aerial", "on": "plane", "cast": [{"entity": "plane"}, {"entity": "container"}]})
    t = relevance.retake(s)
    assert t.world["camera"] == "push_in" and t.world["on"] == "container"
    assert relevance.retake(t) is None
    assert relevance.retake(ScriptScene(narration="n", type="world", subject_name="x", world={"cast": [{"entity": "y"}]})) is None


def test_the_frame_check_asks_for_the_kind_of_thing_not_its_make():
    m = Manifest(entities=[
        Entity(id="bear", name="black bear", kind="animal", search=["american black bear", "black bear", "bear"], look="175 lb, black fur", certain=True, scenes=[1]),
        Entity(id="plane", name="the plane", kind="light aircraft", search=["cessna 404 titan", "cessna 404", "cessna"], look="white", certain=True, scenes=[1]),
        Entity(id="box", name="containers", kind="object", search=["plastic container", "container", "object"], look="", certain=True, scenes=[1])])
    ask = lambda e: relevance.subject_text(ScriptScene(narration="n", type="world", subject_name=e), m)  # noqa: E731
    assert (ask("bear"), ask("plane"), ask("box")) == ("a bear", "a cessna, a light aircraft", "a container")


def test_what_is_dropped_from_a_plane_falls_not_the_plane():
    b = {"plane": worldgen.Build(entity="plane", archetype="vehicle", size=4, primary="#ffffff", secondary="#000000", accent="#000000", form="light"),
         "box": worldgen.Build(entity="box", archetype="object", size=1, primary="#ffffff", secondary="#000000", accent="#000000")}
    actors = [worldgen.Actor(entity="plane", verb="fly"), worldgen.Actor(entity="box", verb="present")]
    beats = worldgen.checked_beats([worldgen.Beat(cue="dropped", camera="aerial", actors=[worldgen.BeatActor(entity="plane", verb="fall")])],
                                   "Forty containers were dropped from a Cessna over Tennessee.", actors, b)
    assert {a.entity: a.verb for a in beats[0].actors} == {"plane": "fly", "box": "fall"}


def test_a_weak_checker_never_drops_3d(monkeypatch):
    from fyt import storyboard
    asked = []
    monkeypatch.setattr(storyboard, "_checkers", lambda cfg: [(storyboard.CLOUDFLARE_VISION, lambda *a: asked.append(1))])
    monkeypatch.setattr(storyboard, "_small_jpeg", lambda p: b"x")
    cfg = Config()
    cfg.review_model = "auto"
    assert storyboard.review(cfg, Path("f.png"), "a bear", skip=relevance.WEAK) is None and not asked


def test_a_closing_line_naming_no_one_shows_whoever_the_story_leaves_behind(monkeypatch):
    _offline(monkeypatch)
    lines = [("statement", "The liner Titan steamed across the Atlantic."), ("statement", "It struck an iceberg and sank."),
             ("statement", "A sailor clung to the ice."), ("statement", "A novel had foretold it all fourteen years before.")]
    sc = Script(title="Titan", description="D", tags=["a"], thumbnail_text="X", thumbnail_kicker="K", thumbnail_query="q",
                scenes=[ScriptScene(narration=t, type=k, text="t", heading="h") for k, t in lines], sources=["https://example.com"])
    m = Manifest(
        entities=[Entity(id="titan", name="liner Titan", kind="ship", search=["ocean liner"], look="liner", certain=True, scenes=[1, 2]),
                  Entity(id="sailor", name="sailor", kind="person", search=["sailor"], look="sailor", certain=True, scenes=[3])],
        places=[Place(id="sea", name="North Atlantic", look="open sea", scenes=[1, 2, 3])],
        moments=[Moment(scene=1, entity="titan", place="sea", action="steams on", motion="move", cue="steamed", documented=True),
                 Moment(scene=2, entity="titan", place="sea", action="strikes iceberg and sinks", motion="fall", cue="sank", documented=True),
                 Moment(scene=3, entity="sailor", place="sea", action="clings to the ice", motion="present", cue="clung", documented=True)],
    )
    cfg = Config()
    cfg.format = "short"
    cfg.visuals.world_share_short = 1.0
    planned, _ = visualplan.plan(cfg, sc, story=m)
    # the closing line is 3D, never the sunk liner sailing on: the sailor it left, at sea
    assert planned.scenes[3].type == "world" and planned.scenes[3].subject_name == "sailor"
    assert 4 in m.entities[1].scenes and 4 in m.places[0].scenes


def test_the_same_subject_doing_the_same_thing_is_never_filmed_the_same_way_twice():
    a = lambda k, cam: worldgen.Shot(scene=k, actors=[worldgen.Actor(entity="x", verb="walk")], camera=cam, on="x")  # noqa: E731
    out = worldgen.vary_cameras({1: a(1, "orbit"), 2: a(2, "follow"), 3: a(3, "orbit")})
    assert out[3].camera not in ("orbit", "follow")


def test_a_building_named_after_a_bird_is_built_as_a_building():
    e = Entity(id="k", name="the Kehlsteinhaus", kind="building", search=["Eagle's Nest"], look="stone chalet on a summit", certain=True, scenes=[1])
    assert worldgen.archetype_of(e) == "structure"
    b = worldgen.Build(entity="k", archetype="bird", size=2, primary="#000000", secondary="#000000", accent="#000000")
    assert worldgen.checked_build(b, e, 1).archetype == "structure"  # the model's bird is overruled
    assert worldgen.archetype_of(Entity(id="t", name="tardigrade", kind="microscopic animal", search=[], look="", certain=True, scenes=[1])) == "insect"
