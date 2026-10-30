"""The Animation Director and Spatial Director (fyt/animation.py, fyt/sizes.py), across different kinds of story."""

from fyt import animation, manifest, sizes, worldgen
from fyt.manifest import Entity, Manifest, Moment
from fyt.models import Script, ScriptScene
from fyt.worldgen import Actor, Beat, BeatActor, Shot


def _story(narration: str, ents: list[tuple[str, str, str, list[str]]], moment: str, motion: str = "move") -> tuple[Script, Manifest]:
    sc = Script(title="t", description="d", tags=[], thumbnail_text="x", thumbnail_kicker="x", thumbnail_query="x", sources=["s"],
                scenes=[ScriptScene(type="statement", narration=narration)])
    m = Manifest(
        entities=[Entity(id=i, name=n, kind=k, search=s, look=n, certain=True, scenes=[1]) for i, n, k, s in ents],
        moments=[Moment(scene=1, entity=moment, action=narration[:40], motion=motion, cue=narration.split(",")[0], documented=True)],
    )
    return sc, m


def _run(sc: Script, m: Manifest, shot: Shot | None = None):
    builds = {e.id: worldgen.rule_build(e, 1) for e in m.entities}
    builds, resized = animation.fix_scale(builds, m)
    shot = shot or worldgen.rule_shot(sc, m, builds, 1, 0)
    shots, report, how = animation.plan(None, sc, m, builds, {1: shot}, log=lambda x: None)
    return builds, shots[1], report[1], how


def _actor(sh: Shot, eid: str) -> Actor:
    return next(a for a in sh.actors if a.entity == eid)


# --- the Spatial Director -------------------------------------------------------------------------------

def test_reference_sizes_most_specific_first():
    assert sizes.lookup("AC-130 gunship")[0] == 29.8
    assert sizes.lookup("C-130 cargo plane")[0] == 29.8
    assert sizes.lookup("GBU-43/B MOAB bomb")[0] == 9.2
    assert sizes.lookup("B52 bomber")[0] == 48.5
    assert sizes.lookup("red blood cell")[0] < 1e-4
    assert sizes.lookup("a thing nobody has heard of") is None


def test_stated_sizes_beat_the_table():
    text = "The GBU-43/B is 30 ft 1.75 in (9.188 m) long. The C-130 Hercules has a wingspan of 40.4 m."
    assert abs(sizes.stated(text, ["GBU-43/B"]) - 9.188) < 1e-6
    assert sizes.stated(text, ["C-130"]) == 40.4
    assert sizes.stated("It weighs 21,600 lb.", ["GBU"]) is None


def test_plane_designed_smaller_than_its_bomb_is_rescaled():
    # the MOAB video: the C-130 was designed 7.35 m long beside a 9.18 m bomb
    _, m = _story("x", [("c130", "a C-130", "military transport aircraft", ["c-130 hercules"]), ("moab", "the MOAB", "bomb", ["gbu-43 moab"])], "c130")
    builds = {e.id: worldgen.rule_build(e, 1) for e in m.entities}
    builds["c130"] = builds["c130"].model_copy(update={"size": 7.35})
    before = builds["c130"].parts[0].size[:]
    fixed, log = animation.fix_scale(builds, m)
    assert fixed["c130"].size == 29.8 and fixed["c130"].size > fixed["moab"].size * 3
    assert abs(fixed["c130"].parts[0].size[1] / before[1] - 29.8 / 7.35) < 1e-6  # the shape grows with it
    assert any("c130" in x for x in log)


def test_titanic_dwarfs_its_iceberg_tip_and_people_keep_their_build():
    _, m = _story("x", [("ship", "the Titanic", "ocean liner", ["rms titanic"]), ("captain", "Captain Smith", "person", ["ship captain"])], "ship")
    builds = {e.id: worldgen.rule_build(e, 1) for e in m.entities}
    fixed, _ = animation.fix_scale(builds, m)
    assert fixed["ship"].size == 269.0
    assert fixed["captain"].size == builds["captain"].size


# --- the Animation Director, one story per kind -------------------------------------------------------

MOAB = [("c130", "a C-130", "military transport aircraft", ["lockheed c-130 hercules", "airplane"]),
        ("moab", "a twenty-one-thousand-pound bomb", "bomb", ["gbu-43 moab", "aerial bomb", "bomb"]),
        ("blu82", "BLU-82 Daisy Cutter", "bomb", ["blu-82 daisy cutter", "aerial bomb", "bomb"])]


def test_disaster_bomb_rolls_out_of_its_aircraft_falls_and_detonates():
    sc, m = _story("A twenty-one-thousand-pound bomb rolls out of a C-130 over Afghanistan toward a tunnel complex.", MOAB, "moab")
    # the blocking the MOAB video had: the bomb moving along the ground
    shot = Shot(scene=1, actors=[Actor(entity="moab", verb="move", at="center", to="front"), Actor(entity="c130", verb="fly", at="back"),
                                 Actor(entity="blu82", verb="present", at="far")], camera="aerial", on="moab",
                beats=[Beat(cue="rolls out of a C-130", actors=[BeatActor(entity="moab", verb="move", to="front")], camera="follow", on="moab")])
    builds, sh, rep, how = _run(sc, m, shot)
    assert how == "rules"
    bomb = _actor(sh, "moab")
    assert bomb.attached == "c130" and bomb.mount == "under" and bomb.verb == "present" and not bomb.to
    assert bomb.impact == "explode"  # an explosive that falls detonates where it lands (inferred)
    assert _actor(sh, "c130").verb == "fly"  # the carrier flies on
    assert sh.on == "c130" and sh.actors[0].entity == "c130"  # the opening frames the aircraft, not its bomb
    assert len(sh.beats) == 1
    bt = sh.beats[0]
    assert bt.cue.startswith("rolls out of") and bt.actors[0].release and bt.actors[0].verb == "fall"
    assert bt.camera == "follow" and bt.on == "moab"  # the camera follows it down
    assert all(a.entity != "blu82" for a in sh.actors)  # 'bomb' here names the MOAB, not the other bomb


def test_release_cue_in_a_later_sentence_finds_the_carrier_named_before():
    sc, m = _story("A C-130 flies over Afghanistan. Its rear ramp opens. A twenty-one-thousand-pound bomb rolls out toward a tunnel complex.", MOAB[:2], "c130")
    _, sh, _, _ = _run(sc, m)
    assert _actor(sh, "moab").attached == "c130"
    assert any(x.release and x.entity == "moab" for bt in sh.beats for x in bt.actors)


def test_told_explosion_is_its_own_beat_with_the_camera_on_it():
    sc, m = _story("The bomber dropped the bomb over the ridge, and seconds later it detonated above the tunnels.",
                   [("bomber", "the bomber", "bomber aircraft", ["b-52 stratofortress", "airplane"]), ("bomb", "the bomb", "bomb", ["bomb"])], "bomber")
    _, sh, rep, _ = _run(sc, m)
    cues = [bt.cue for bt in sh.beats]
    assert any(c.startswith("dropped") for c in cues) and any("detonated" in c for c in cues)
    boom = next(bt for bt in sh.beats if "detonated" in bt.cue)
    assert boom.actors[0].verb == "explode" and boom.on == "bomb"
    assert _actor(sh, "bomb").impact == ""  # the told explosion, not an inferred one


def test_technology_crate_pushed_out_of_a_cargo_plane_falls_without_exploding():
    sc, m = _story("The crew pushed the supply crate out of the cargo plane over the camp.",
                   [("plane", "the cargo plane", "cargo plane", ["cargo plane", "airplane"]), ("crate", "the supply crate", "crate", ["wooden crate"])], "plane")
    _, sh, _, _ = _run(sc, m)
    crate = _actor(sh, "crate")
    assert crate.attached == "plane" and crate.impact == ""


def test_wildlife_chase_has_no_attachments_and_keeps_its_runners():
    sc, m = _story("The cheetah chased the gazelle across the dry plain.",
                   [("cheetah", "the cheetah", "animal", ["cheetah"]), ("gazelle", "a gazelle", "animal", ["gazelle"])], "cheetah")
    _, sh, rep, _ = _run(sc, m)
    assert all(not a.attached for a in sh.actors)
    assert _actor(sh, "cheetah").verb in ("run", "walk")


def test_biography_a_carried_sword_is_held_by_its_smith():
    sc, m = _story("The blacksmith carried the sword to the forge.",
                   [("smith", "the blacksmith", "person", ["blacksmith"]), ("sword", "the sword", "object", ["sword"])], "smith")
    _, sh, _, _ = _run(sc, m)
    # in the smith's hands, either way the blocking puts it: held as a prop, or riding as an attachment
    smith = _actor(sh, "smith")
    sword = next((a for a in sh.actors if a.entity == "sword"), None)
    assert smith.holding == "sword" or (sword and sword.attached == "smith" and sword.mount == "held")
    assert sword is None or sword.verb == "present"


def test_mystery_an_object_never_slides_by_itself():
    sc, m = _story("Her backpack was found beside the trail.",
                   [("pack", "her backpack", "object", ["backpack"]), ("hiker", "the hiker", "person", ["hiker"])], "pack")
    shot = Shot(scene=1, actors=[Actor(entity="pack", verb="move", at="left", to="right")], camera="push_in", on="pack")
    _, sh, rep, _ = _run(sc, m, shot)
    assert _actor(sh, "pack").verb == "present"
    assert any("can't move by itself" in x for x in rep["revised"])


def test_science_microscopic_sizes_and_no_invented_events():
    sc, m = _story("An antibody locks onto the virus.",
                   [("antibody", "an antibody", "protein", ["antibody"]), ("virus", "the virus", "virus", ["virus"])], "antibody")
    builds, sh, rep, _ = _run(sc, m)
    # magnified by one lens: drawn at a visible size, the antibody still ten times smaller than the virus
    assert 0.5 <= builds["virus"].size and abs(builds["virus"].size / builds["antibody"].size - 10) < 1e-6
    assert not sh.beats and all(not a.attached for a in sh.actors)


def test_biblical_ark_is_ship_sized_and_carries_nothing_it_isnt_told_to():
    sc, m = _story("The animals walked two by two toward the great ark.",
                   [("ark", "the ark", "wooden ship", ["noah's ark", "ship"]), ("animals", "the animals", "animal", ["animals"])], "animals")
    builds, sh, _, _ = _run(sc, m)
    assert builds["ark"].size == 137.0
    assert all(not a.attached for a in sh.actors)


def test_historical_something_too_big_never_rides_on_something_smaller():
    p = animation.Plan(scene=1, subjects=[animation.Subject(entity="ship", start="attached", attached_to="boat"), animation.Subject(entity="boat")],
                       actions=[animation.Act(subject="ship", action="present"), animation.Act(subject="boat", action="sail")])
    _, m = _story("The lifeboat rowed away from the liner.", [("ship", "the liner", "ocean liner", ["ocean liner"]), ("boat", "the lifeboat", "lifeboat", ["lifeboat"])], "boat")
    builds = {e.id: worldgen.rule_build(e, 1) for e in m.entities}
    builds, _ = animation.fix_scale(builds, m)
    q, notes = animation.feasible(p, "The lifeboat rowed away from the liner.", m, builds)
    assert next(s for s in q.subjects if s.entity == "ship").start == "ground"
    assert any("can't ride" in x for x in notes)


def test_nothing_acts_after_it_is_destroyed_and_unsaid_cues_are_dropped():
    _, m = _story("x", MOAB[:2], "moab")
    builds = {e.id: worldgen.rule_build(e, 1) for e in m.entities}
    narration = "The bomb exploded over the valley."
    p = animation.Plan(scene=1, subjects=[animation.Subject(entity="moab")],
                       actions=[animation.Act(subject="moab", action="explode", cue="exploded"), animation.Act(subject="moab", action="rise", cue="over the valley"),
                                animation.Act(subject="moab", action="spin", cue="words nobody said")])
    q, notes = animation.feasible(p, narration, m, builds)
    assert [a.action for a in q.actions] == ["explode"]
    assert any("after it was destroyed" in x for x in notes) and any("not in the narration" in x for x in notes)


def test_summary_and_shot_survive_world_of():
    sc, m = _story("A twenty-one-thousand-pound bomb rolls out of a C-130 over Afghanistan.", MOAB[:2], "moab")
    builds, sh, rep, _ = _run(sc, m)
    w = worldgen.world_of("lowpoly", 1, sh, builds, {}, {})
    cast = {c["entity"]: c for c in w["cast"]}
    assert cast["moab"]["attached"] == "c130" and w["beats"][0]["cast"][0]["release"] is True
    assert "moab on c130" in animation.summary({1: rep})
