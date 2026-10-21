"""Story worlds (fyt/worldgen.py): every stage scene's cast and place are generated for its own story,
stay true to the narration, keep one look per entity within a video, and share nothing with the next
video unless its story asks for the same thing."""
import json
import re
from pathlib import Path

import pytest

from fyt import manifest, pipeline, worldgen
from fyt.config import Config
from fyt.manifest import Entity, Manifest, Moment, Place
from fyt.models import Script, ScriptScene

RENDERER = Path(__file__).resolve().parent.parent / "renderer" / "src" / "scenes" / "world" / "storyworld"


def script(*lines: str, title: str = "Cocaine Bear", mood: str = "curious") -> Script:
    return Script(
        title=title, description="D", tags=["a"], thumbnail_text="X", thumbnail_kicker="K", thumbnail_query="q", mood=mood,
        scenes=[ScriptScene(narration=t, type="statement", text="t") for t in lines], sources=["https://example.com"],
    )


BEAR_STORY = script(
    "In 1985 a smuggler dropped duffel bags of cocaine from his Cessna over Georgia.",
    "Months later a black bear found the bags and ate the cocaine.",
    "A hunter found the bear dead beside the torn bags.",
)
BEAR_MANIFEST = Manifest(
    entities=[
        Entity(id="bear", name="the black bear", kind="animal", search=["black bear"], look="large black American black bear, brown muzzle", certain=True, scenes=[2, 3]),
        Entity(id="bags", name="duffel bags of cocaine", kind="duffel bag", search=["duffel bag"], look="green canvas duffel bags", certain=False, scenes=[1, 2, 3]),
        Entity(id="hunter", name="a hunter", kind="person", search=["hunter"], look="hunter in an orange vest and cap", certain=False, scenes=[3]),
        Entity(id="plane", name="the Cessna", kind="light aircraft", search=["cessna 404"], look="white twin-engine Cessna 404", certain=True, scenes=[1]),
    ],
    places=[Place(id="forest", name="Chattahoochee National Forest", look="dense pine forest, Georgia mountains", scenes=[1, 2, 3])],
    moments=[
        Moment(scene=1, entity="plane", place="forest", action="drops the bags", motion="move", cue="dropped duffel bags", documented=True),
        Moment(scene=2, entity="bear", place="forest", action="eats the cocaine", motion="present", cue="ate the cocaine", documented=True),
        Moment(scene=3, entity="bear", place="forest", action="found dead", motion="present", cue="found the bear dead", documented=True),
    ],
)
FLIGHT_STORY = script(
    "Minutes after take-off the Airbus hit a flock of Canada geese.",
    "Captain Sullenberger glided the plane onto the Hudson River.",
    "Ferries reached the passengers standing on the wings.",
    title="Miracle on the Hudson", mood="tense",
)
FLIGHT_MANIFEST = Manifest(
    entities=[
        Entity(id="geese", name="Canada geese", kind="bird", search=["canada goose"], look="grey-brown geese with black necks", certain=True, scenes=[1]),
        Entity(id="pilot", name="the captain", kind="pilot", search=["airline pilot"], look="airline captain in a dark uniform and cap", certain=False, scenes=[2]),
        Entity(id="ferry", name="a commuter ferry", kind="ferry", search=["ferry"], look="white and blue New York commuter ferry", certain=False, scenes=[3]),
        Entity(id="passengers", name="the passengers", kind="people", search=["passengers"], look="passengers in coats", certain=True, scenes=[3]),
    ],
    places=[Place(id="hudson", name="Hudson River", look="wide grey river between Manhattan and New Jersey, winter", scenes=[2, 3])],
    moments=[
        Moment(scene=1, entity="geese", action="fly into the engines", motion="move", cue="hit a flock", documented=True),
        Moment(scene=3, entity="ferry", place="hudson", action="reaches the passengers", motion="approach", cue="Ferries reached", documented=True),
    ],
)


@pytest.fixture
def offline(monkeypatch):
    def fail(*a, **k):
        raise RuntimeError("no model")
    monkeypatch.setattr(worldgen.llm, "structured", fail)


def test_grammar_drives_the_schema():
    g = worldgen.grammar()
    assert set(g["archetypes"]) == set(worldgen.Archetype.__args__)
    assert set(g["calm"]) <= set(worldgen.Verb.__args__)
    for verb in g["events"]:
        assert verb in worldgen.Verb.__args__, verb


def test_every_archetype_set_and_mark_is_drawn():
    index = (RENDERER / "index.tsx").read_text()
    env = (RENDERER / "environment.tsx").read_text()
    g = worldgen.grammar()
    for arche in g["archetypes"]:
        assert f'"{arche}"' in index or arche in ("vehicle", "object", "structure", "plant"), arche  # parts-built things share the rigid path
    for kind in g["sets"]:
        assert f'"{kind}"' in env, kind
    for mark in g["marks"]:
        assert f'"{mark}"' in index, mark
    for move in g["camera"]:
        assert f'"{move}"' in index, move


@pytest.mark.parametrize("kind,name,expected", [
    ("animal", "the black bear", "quadruped"), ("person", "a park ranger", "humanoid"), ("light aircraft", "a Cessna 404", "vehicle"),
    ("bird", "Canada geese", "bird"), ("duffel bag", "bags of cocaine", "object"), ("cell", "a red blood cell", "cell"),
    ("ferry", "a commuter ferry", "vehicle"), ("organ", "the heart", "cell"), ("building", "the lighthouse", "structure"),
    ("microscopic animal", "a tardigrade", "insect"), ("pilot", "the captain", "humanoid"),
])
def test_archetype_from_the_entity_own_words(kind, name, expected):
    e = Entity(id="x", name=name, kind=kind, search=[name], look="", certain=True, scenes=[1])
    assert worldgen.archetype_of(e) == expected


def test_rules_build_each_entity_from_its_own_words(offline):
    style, builds, settings, made = worldgen.design(Config(), BEAR_STORY, BEAR_MANIFEST, ["bear", "bags", "hunter", "plane"], log=lambda m: None)
    assert made == {"cast": "rules", "sets": "rules", "rules_built": ["bear", "bags", "hunter", "plane"]}
    bear, bags, hunter, plane = (builds[k] for k in ("bear", "bags", "hunter", "plane"))
    assert bear.archetype == "quadruped" and bear.primary == worldgen.COLOURS["black"] and bear.body.build > 0.6
    assert bags.archetype == "object" and bags.parts and bags.primary == worldgen.COLOURS["green"]
    assert hunter.outfit.hair == "cap" and hunter.primary == worldgen.COLOURS["orange"]
    assert plane.archetype == "vehicle" and any(p.spin for p in plane.parts)
    assert settings["forest"].kind == "forest"


def test_unrelated_stories_get_unrelated_worlds(offline):
    _, bear_builds, bear_sets, _ = worldgen.design(Config(), BEAR_STORY, BEAR_MANIFEST, [e.id for e in BEAR_MANIFEST.entities], log=lambda m: None)
    _, flight_builds, flight_sets, _ = worldgen.design(Config(), FLIGHT_STORY, FLIGHT_MANIFEST, [e.id for e in FLIGHT_MANIFEST.entities], log=lambda m: None)
    assert not set(bear_builds) & set(flight_builds)
    assert {b.archetype for b in flight_builds.values()} == {"bird", "humanoid", "vehicle"}
    assert flight_sets["hudson"].kind == "river" and bear_sets["forest"].kind == "forest"
    assert flight_builds["pilot"].outfit.top == "uniform"


def test_undocumented_or_untold_actions_are_calmed():
    _, builds, _, _ = worldgen.design(Config(), BEAR_STORY, BEAR_MANIFEST, ["bear", "bags", "hunter", "plane"], log=lambda m: None) if False else (None, {
        e.id: worldgen.rule_build(e, 1) for e in BEAR_MANIFEST.entities}, None, None)
    shot = worldgen.Shot(scene=3, actors=[
        worldgen.Actor(entity="bear", verb="lie"),
        worldgen.Actor(entity="hunter", verb="crouch", face="bear"),  # the narration doesn't say he crouched
        worldgen.Actor(entity="bags", verb="open", state="damaged"),  # "torn" is told
        worldgen.Actor(entity="plane", verb="crash"),  # not in this scene
    ], camera="establish", callouts=[worldgen.Callout(on="bear", text="FORTY KILOS"), worldgen.Callout(on="hunter", text="a hunter")])
    c = worldgen.checked_shot(shot, BEAR_STORY, BEAR_MANIFEST, builds, 3)
    verbs = {a.entity: a.verb for a in c.actors}
    assert verbs == {"bear": "lie", "hunter": "idle", "bags": "open"}
    assert [x.text for x in c.callouts] == ["a hunter"]  # invented figures never become labels
    assert next(a for a in c.actors if a.entity == "bags").state == "damaged"


def test_illustrative_moment_keeps_its_actor_calm():
    builds = {e.id: worldgen.rule_build(e, 1) for e in BEAR_MANIFEST.entities}
    m = BEAR_MANIFEST.model_copy(update={"moments": [BEAR_MANIFEST.moments[0], BEAR_MANIFEST.moments[1].model_copy(update={"documented": False, "cue": ""})]})
    c = worldgen.checked_shot(worldgen.Shot(scene=2, actors=[worldgen.Actor(entity="bear", verb="eat")], camera="orbit"), BEAR_STORY, m, builds, 2)
    assert c.actors[0].verb == "idle"


def test_rule_direction_blocks_the_moment(offline):
    builds = {e.id: worldgen.rule_build(e, 1) for e in BEAR_MANIFEST.entities}
    shots, how = worldgen.direct(Config(), BEAR_STORY, BEAR_MANIFEST, builds, [1, 2, 3], log=lambda m: None)
    assert how == "rules"
    assert shots[1].actors[0].entity == "plane" and shots[1].actors[0].verb == "fly"
    assert "hunter" not in [a.entity for a in shots[1].actors]
    assert (shots[2].actors[0].entity, shots[2].actors[0].verb) == ("bear", "eat")
    assert (shots[3].actors[0].entity, shots[3].actors[0].verb) == ("bear", "lie")
    assert all(shots[k].camera != shots[k + 1].camera for k in (1, 2))


def test_model_design_is_checked(monkeypatch):
    cast = worldgen.Cast(style="noir", builds=[
        worldgen.Build(entity="bear", archetype="object", size=1.7, primary="black", secondary="#8a6a48", accent="#222222",
                       parts=[worldgen.Part(shape="box", at=[0, 0, 0], size=[1, 1, 1], color="#111111", bone="head")]),
        worldgen.Build(entity="bags", archetype="object", size=0.9, primary="#3f5a2a", secondary="#222222", accent="#ffffff",
                       parts=[worldgen.Part(shape="capsule", at=[0, 0.2, 0], size=[0.4, 0.9, 0.4], rot=[0, 0, 90], color="#3f5a2a", bone="hand_r"),
                              worldgen.Part(shape="box", at=[0, 0.4, 0], size=[0.6, 0.03, 0.05], color="#222222")]),
        worldgen.Build(entity="unicorn", archetype="quadruped", size=2, primary="#ffffff", secondary="#ffffff", accent="#ffffff"),
    ])
    calls = iter([cast, RuntimeError("sets down")])

    def fake(*a, **k):
        r = next(calls)
        if isinstance(r, Exception):
            raise r
        return r
    monkeypatch.setattr(worldgen.llm, "structured", fake)
    style, builds, settings, made = worldgen.design(Config(), BEAR_STORY, BEAR_MANIFEST, ["bear", "bags"], log=lambda m: None)
    assert style == "noir" and made["cast"] == "model" and made["sets"] == "rules"
    assert builds["bear"].archetype == "quadruped"  # a bear is never a heap of parts
    assert builds["bear"].primary == worldgen.rule_build(BEAR_MANIFEST.entities[0], 0).primary  # an invalid colour falls back
    assert all(p.bone == "body" for p in builds["bags"].parts)
    assert "unicorn" not in builds


def test_story_worlds_turn_stage_scenes_into_generated_worlds(tmp_path, offline):
    from fyt.store import Job
    job = Job.create(Config(jobs_dir=str(tmp_path)), "cocaine bear")
    staged = BEAR_STORY.model_copy(update={"scenes": [
        s.model_copy(update={"type": "world", "subject": "stage", "variant": "model", "action": "present", "subject_name": sn, "fallback": s.model_dump()})
        for s, sn in zip(BEAR_STORY.scenes, ["plane", "bear", "bear"])]})
    out, back = pipeline.story_worlds(Config(), job, staged, BEAR_MANIFEST, {}, {})
    assert back == []
    worlds = [s.world for s in out.scenes]
    assert all(w and w["cast"] for w in worlds)
    # one build per entity for the whole video
    bear_builds = [json.dumps(a["build"], sort_keys=True) for w in worlds for a in w["cast"] if a["entity"] == "bear"]
    assert len(bear_builds) == 2 and len(set(bear_builds)) == 1
    assert out.scenes[1].model["level"] == "procedural" and out.scenes[1].label.startswith("RECONSTRUCTION")
    record = json.loads(job.file("world.json").read_text())
    assert {b["entity"] for b in record["builds"]} == {"bear", "bags", "hunter", "plane"}
    assert all(b["source"] == "procedural, from the entity's words" for b in record["builds"])
    assert record["shots"]["2"]["actors"][0]["verb"] == "eat"


def test_world_scenes_are_not_swapped_for_paintings():
    from fyt import visualplan
    s = ScriptScene(type="world", subject="stage", narration="x", label="ILLUSTRATION", illustrative=True,
                    fallback=ScriptScene(type="statement", narration="x", text="t").model_dump(), world={"cast": []})
    out, back = visualplan.painted(script("x").model_copy(update={"scenes": [s]}))
    assert back == [] and out.scenes[0].world is not None


def test_rules_shape_cells_and_vehicles_from_what_they_are_called():
    def build(kind, name, look=""):
        return worldgen.rule_build(Entity(id="x", name=name, kind=kind, search=[name], look=look, certain=True, scenes=[1]), 1)
    disc, sickle, virus = build("cell", "a red blood cell", "red biconcave disc"), build("cell", "a sickled cell", "crescent"), build("virus", "the virus")
    assert [p.shape for p in disc.parts] == ["torus", "cylinder"]
    assert len(sickle.parts) == 7 and {p.shape for p in sickle.parts} == {"sphere"}
    assert sum(p.shape == "cylinder" for p in virus.parts) >= 8
    assert build("cell", "a cell").parts == []  # a generic cell keeps the nucleated blob
    jet, car = build("airliner", "the Airbus A320"), build("car", "a sedan")
    assert jet.size > car.size * 2 and not any(p.spin for p in jet.parts)  # no propeller on a jet


def test_flocks_crowds_and_piles_come_from_plural_names():
    e = lambda name, kind: Entity(id="x", name=name, kind=kind, search=[name], look="", certain=True, scenes=[1])
    assert worldgen.group_size(e("Canada geese", "bird"), "bird") == 7
    assert worldgen.group_size(e("passengers", "person"), "humanoid") == 4
    assert worldgen.group_size(e("the captain", "pilot"), "humanoid") == 1
    assert worldgen.group_size(e("duffel bags", "duffel bag"), "object") == 4
    assert worldgen.group_size(e("a duffel bag", "bag"), "object") == 1


def test_backdrop_from_the_place_words():
    p = lambda name, look: Place(id="p", name=name, look=look, scenes=[1])
    assert worldgen.rule_setting(p("Hudson River", "grey river in winter, Manhattan skyline")).backdrop == "city"
    assert worldgen.rule_setting(p("Chattahoochee National Forest", "Georgia mountains")).backdrop == "mountains"
    assert worldgen.rule_setting(p("a farm", "fields")).backdrop == "hills"


def test_short_kind_words_match_whole_words_only():
    e = Entity(id="c", name="plastic cocaine containers", kind="object", search=["container"], look="small white plastic boxes, sealed", certain=False, scenes=[1])
    assert worldgen.archetype_of(e) == "object"  # 'sealed' is not a seal, 'containers' has no ant


def test_a_still_model_shot_takes_the_action_its_moment_tells(monkeypatch):
    lazy = worldgen.Direction(shots=[worldgen.Shot(scene=3, actors=[worldgen.Actor(entity="bear", verb="idle"), worldgen.Actor(entity="hunter", verb="idle")], camera="establish")])
    monkeypatch.setattr(worldgen.llm, "structured", lambda *a, **k: lazy)
    builds = {e.id: worldgen.rule_build(e, 1) for e in BEAR_MANIFEST.entities}
    shots, how = worldgen.direct(Config(), BEAR_STORY, BEAR_MANIFEST, builds, [3], log=lambda m: None)
    assert how == "model" and shots[3].actors[0].verb == "lie" and shots[3].place == "forest"
    assert shots[3].actors[1].at != shots[3].actors[0].at


def test_places_listed_as_entities_are_sets_not_cast():
    river = Entity(id="hudson-river", name="Hudson River", kind="water body", search=["river"], look="", certain=True, scenes=[1])
    jet = Entity(id="a320", name="Airbus A320", kind="aircraft", search=["a320"], look="", certain=True, scenes=[1])
    assert worldgen.is_place(river) and not worldgen.is_place(jet)


def test_with_story_worlds_catalog_picks_of_an_entity_become_stage_scenes():
    from fyt import visualplan
    kept, _ = visualplan.story_fit(FLIGHT_STORY, FLIGHT_MANIFEST, [visualplan.Reconstruction(scene=3, subject="ship", action="sail")])
    r = visualplan.as_stage(FLIGHT_STORY, FLIGHT_MANIFEST, kept[0], 0)
    assert r.subject == "stage" and r.subject_name == kept[0].subject_name and r.in_story


HUDSON_STORY = script("Geese slammed into a US Airways A320 just after takeoff.", "The twin engines failed in under four minutes.",
                      title="Miracle on the Hudson")
HUDSON_MANIFEST = Manifest(
    entities=[Entity(id="plane", name="US Airways Flight 1549", kind="light aircraft", search=["airbus a320"], look="Airbus A320, white with two black engines", certain=True, scenes=[1, 2]),
              Entity(id="geese", name="Canada geese", kind="animal", search=["canada goose"], look="large geese", certain=True, scenes=[1])],
    places=[Place(id="la", name="LaGuardia Airport", look="runway and control tower", scenes=[1])],
    moments=[Moment(scene=1, entity="geese", action="slam into aircraft", motion="present", cue="Geese slammed", documented=True),
             Moment(scene=2, entity="plane", action="engines fail", motion="present", cue="engines failed", documented=True)],
)


def test_a_model_drawn_airliner_keeps_the_airliner_outline_at_stage_scale():
    # from the US Airways test render: a model's box-and-plank aircraft, 37.6 long, read as nothing
    e = HUDSON_MANIFEST.entities[0]
    b = worldgen.Build(entity="plane", archetype="vehicle", size=37.6, primary="#ffffff", secondary="#000000", accent="#ff0000",
                       parts=[worldgen.Part(shape="box", at=[0, 1.5, 0], size=[4, 1.5, 4], color="#ffffff"), worldgen.Part(shape="box", at=[15, 1.5, 0], size=[30, 0.2, 6], color="#ffffff")])
    c = worldgen.checked_build(b, e, 1)
    assert c.size == worldgen.rule_build(e, 1).size < 20
    assert c.parts[0].shape == "capsule" and c.parts[0].color == "#ffffff"  # the fuselage, in the model's colours


def test_an_aircraft_not_brought_down_flies_and_its_flock_flies_with_it():
    builds = {e.id: worldgen.rule_build(e, 1) for e in HUDSON_MANIFEST.entities}
    sh = worldgen.Shot(scene=1, actors=[worldgen.Actor(entity="geese", verb="idle", count=1), worldgen.Actor(entity="plane", verb="present")], camera="establish", on="geese")
    c = worldgen.checked_shot(sh, HUDSON_STORY, HUDSON_MANIFEST, builds, 1)
    assert [(a.entity, a.verb) for a in c.actors] == [("geese", "fly"), ("plane", "fly")]
    assert c.actors[0].count == worldgen.group_size(HUDSON_MANIFEST.entities[1], "bird") > 1  # "Canada geese" is a flock


def test_set_dressing_is_pulled_to_stage_scale_and_slabs_lie_flat():
    runway = worldgen.Dressing(name="runway", build=worldgen.Build(entity="r", archetype="structure", size=400, primary="#f0f0f0", secondary="#a0a0a0", accent="#ffeb3b", parts=[worldgen.Part(shape="box", at=[0, 0, 0], size=[400, 5, 30], color="#f0f0f0")]))
    tower = worldgen.Dressing(name="tower", build=worldgen.Build(entity="t", archetype="structure", size=60, primary="#999999", secondary="#777777", accent="#ffffff", parts=[worldgen.Part(shape="box", at=[0, 0, 0], size=[20, 60, 20], color="#999999")]))
    s = worldgen.checked_setting(worldgen.Setting(place="la", kind="airfield", ground="#d2d2d2", sky="#a0c4ff", accent="#ffeb3b", dressing=[runway, tower]), HUDSON_MANIFEST.places[0])
    r, t = (d.build.parts[0] for d in s.dressing)
    assert r.size[0] < 50 and r.size[1] <= 0.08
    assert t.size[1] < 20


def test_a_thing_whose_kind_says_object_is_never_built_as_a_creature():
    # from the Cocaine Bear render: "plastic cocaine containers" came back from the model as a fish
    e = Entity(id="containers", name="plastic cocaine containers", kind="object", search=["container"], look="small white plastic boxes", certain=True, scenes=[1])
    b = worldgen.Build(entity="containers", archetype="fish", size=0.6, primary="#ffffff", secondary="#dddddd", accent="#000000")
    assert worldgen.checked_build(b, e, 1).archetype == "object"
    quokka = Entity(id="q", name="a quokka", kind="marsupial", search=["quokka"], look="small brown furry", certain=True, scenes=[1])
    q = worldgen.Build(entity="q", archetype="quadruped", size=0.5, primary="#6b4a2e", secondary="#a8835a", accent="#22201e")
    assert worldgen.checked_build(q, quokka, 1).archetype == "quadruped"  # a creature the words don't place keeps the model's body plan


def test_a_blood_vessel_place_is_drawn_as_a_vessel():
    vessel = Place(id="v", name="inside a blood vessel", look="microscopic inside of a blood vessel", scenes=[1])
    assert worldgen.rule_setting(vessel).backdrop == "vessel"
    model = worldgen.Setting(place="v", kind="micro", ground="#6a1c2c", sky="#3a0c18", accent="#ff9fb0", backdrop="none")
    assert worldgen.checked_setting(model, vessel).backdrop == "vessel"
    lab = Place(id="l", name="a laboratory", look="bright lab", scenes=[1])
    assert worldgen.checked_setting(model.model_copy(update={"backdrop": "vessel"}), lab).backdrop != "vessel"


def test_vehicle_and_cell_forms_name_the_detailed_model():
    assert worldgen.vehicle_form("the airbus a320 airliner") == "airliner"
    assert worldgen.vehicle_form("a small cessna plane") == "plane"
    assert worldgen.vehicle_form("a commuter ferry") == "boat"
    assert worldgen.vehicle_form("a police car") == "car"
    assert worldgen.vehicle_form("a delivery truck") == "truck"
    assert worldgen.vehicle_form("a steam locomotive") == ""
    assert worldgen.cell_form("a sickled red blood cell") == "sickle"
    assert worldgen.cell_form("a healthy red blood cell") == "rbc"
    assert worldgen.cell_form("a neuron") == ""


def test_a_set_too_bright_for_its_kind_is_toned_down():
    from fyt import worldgen as wg
    p = manifest.Place(id="body", name="inside the body", look="blood vessel", scenes=[1])
    micro = wg.checked_setting(wg.Setting(place="body", kind="micro", time="day", ground="#ffe0e0", sky="#ffffff", accent="#ffcccc", backdrop="vessel"), p)
    assert (micro.ground, micro.sky) == wg.SET_COLOURS["micro"][:2]  # deep red, not white
    lab = wg.checked_setting(wg.Setting(place="body", kind="lab", time="day", ground="#f0f0f0", sky="#ffffff", accent="#ffcc00", backdrop="none"), p)
    assert lab.sky != "#ffffff" and lab.ground != "#f0f0f0"
    ok = wg.checked_setting(wg.Setting(place="body", kind="lab", time="day", ground="#808890", sky="#a0aab4", accent="#ffcc00", backdrop="none"), p)
    assert (ok.ground, ok.sky) == ("#808890", "#a0aab4")


def test_cells_with_no_place_are_shown_in_the_bloodstream():
    from fyt import worldgen as wg
    p = manifest.Place(id="africa", name="sub-Saharan Africa", look="savanna", scenes=[6])
    savanna = wg.rule_setting(p)
    e = Entity(id="rbc", name="red blood cell", kind="cell", search=["red blood cell"], look="red disc", certain=True, scenes=[1])
    build = wg.rule_build(e, 1)
    shot = wg.Shot(scene=1, place="", actors=[wg.Actor(entity="rbc", verb="move")], camera="follow")
    world = wg.world_of("clinical", 1, shot, {"rbc": build}, {"africa": savanna}, {})
    assert world["set"]["kind"] == "micro"


TITAN_STORY = script(
    "In the novel the Titan steams across the Atlantic at full speed.",
    "On an April night the Titan strikes an iceberg and sinks within minutes.",
    title="The Wreck of the Titan", mood="tense",
)
TITAN_MANIFEST = Manifest(
    entities=[
        Entity(id="titan", name="the Titan", kind="ocean liner", search=["ocean liner", "ship"], look="huge four-funnel liner", certain=False, scenes=[1]),
        Entity(id="iceberg", name="an iceberg", kind="iceberg", search=["iceberg"], look="tall white iceberg", certain=False, scenes=[2]),
    ],
    places=[Place(id="atlantic", name="North Atlantic", look="dark open ocean at night", scenes=[1, 2])],
    moments=[Moment(scene=2, entity="iceberg", place="atlantic", action="the Titan strikes it", motion="present", cue="strikes an iceberg", documented=True)],
)


def test_every_entity_a_scene_names_is_in_it_even_if_the_model_left_it_out():
    m = manifest.checked(TITAN_MANIFEST, TITAN_STORY)
    assert {e.id for e in manifest.in_scene(m, 2)} == {"titan", "iceberg"}


def test_the_director_plays_a_scene_in_beats_on_the_narration_words(monkeypatch):
    m = manifest.checked(TITAN_MANIFEST, TITAN_STORY)
    plan = worldgen.Direction(shots=[worldgen.Shot(
        scene=2, place="atlantic", camera="establish",
        actors=[worldgen.Actor(entity="titan", verb="move"), worldgen.Actor(entity="iceberg", verb="present", at="right")],
        beats=[
            worldgen.Beat(cue="strikes an iceberg", actors=[worldgen.BeatActor(entity="titan", verb="crash")], camera="low_angle"),
            worldgen.Beat(cue="sinks within minutes", actors=[worldgen.BeatActor(entity="titan", verb="sink", state="damaged")], camera="reveal"),
            worldgen.Beat(cue="explodes in flames", actors=[worldgen.BeatActor(entity="titan", verb="fall")], camera="orbit"),  # not said: dropped
        ])])
    monkeypatch.setattr(worldgen.llm, "structured", lambda *a, **k: plan)
    builds = {e.id: worldgen.rule_build(e, 1) for e in m.entities}
    shots, how = worldgen.direct(Config(), TITAN_STORY, m, builds, [2], log=lambda x: None)
    sh = shots[2]
    assert how == "model" and {a.entity for a in sh.actors} == {"titan", "iceberg"}
    assert [(b.cue, b.actors[0].verb, b.camera) for b in sh.beats] == [("strikes an iceberg", "crash", "low_angle"), ("sinks within minutes", "sink", "reveal")]
    assert sh.beats[1].actors[0].state == "damaged"
    world = worldgen.world_of("lowpoly", 1, sh, builds, {}, {})
    assert world["beats"][1]["cast"][0]["verb"] == "sink"


def test_a_beat_cannot_act_out_what_its_words_dont_tell():
    builds = {e.id: worldgen.rule_build(e, 1) for e in TITAN_MANIFEST.entities}
    actors = [worldgen.Actor(entity="titan", verb="move")]
    beats = [worldgen.Beat(cue="steams across", actors=[worldgen.BeatActor(entity="titan", verb="crash")], camera="follow")]
    out = worldgen.checked_beats(beats, TITAN_STORY.scenes[0].narration, actors, builds)
    assert out[0].actors[0].verb == "present"


def test_beats_are_timed_on_their_words():
    from fyt.models import Word
    from fyt.timeline import timed_world
    words = [Word(word=w, start=i * 0.5, end=i * 0.5 + 0.4) for i, w in enumerate("On an April night the Titan strikes an iceberg and sinks within minutes.".split())]
    world = {"cast": [], "beats": [{"cue": "strikes an iceberg", "cast": []}, {"cue": "sinks within minutes", "cast": []}, {"cue": "never said", "cast": []}]}
    timed = timed_world(world, words, 0.0, 8.0)
    assert [b["from"] for b in timed["beats"]] == [0.375, 0.625]
