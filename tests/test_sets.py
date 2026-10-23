"""Set pieces (fyt/sets.py): each kind of place is built from the packs' own trees, buildings, roads and machines."""
import json

from fyt import sets, worldgen
from fyt.manifest import Place


def test_every_kind_of_place_the_packs_cover_has_its_pieces_on_disk():
    index = json.loads(sets.INDEX.read_text())
    assert all(s["licence"] == "CC0" for s in index["sources"].values())
    kinds = index["sets"]
    for kind in ("forest", "grassland", "mountain", "snow", "river", "lake", "swamp", "desert", "beach", "town", "city", "road", "railway", "factory", "lab"):
        assert kinds[kind], kind
    assert kinds["forest"]["tree"] and kinds["city"]["building"] and kinds["city"]["tall"] and kinds["city"]["street"] and kinds["railway"]["rail"]
    files = {f for roles in kinds.values() for fs in roles.values() for f in fs}
    assert all((sets.DIR.parent / f).is_file() for f in files)
    # every kind named there is one the story worlds know
    assert set(kinds) <= set(worldgen.G["sets"])


def test_a_place_gets_its_kinds_pieces_copied_beside_the_video(tmp_path):
    got = sets.stage("beach", tmp_path)
    assert {"tree", "rock"} <= set(got)
    assert all((tmp_path / f).is_file() for fs in got.values() for f in fs)
    assert sets.stage("space", tmp_path) == {}


def test_factories_railways_and_harbours_are_places_of_their_own_kind():
    def kind(name, look=""):
        return worldgen.rule_setting(Place(id="p", name=name, look=look, scenes=[1])).kind
    assert kind("the Ford assembly line") == "factory"
    assert kind("the old railway line", "tracks through fields") == "railway"
    assert kind("Southampton harbour", "docks and cranes") == "beach"
    assert "aerial" in worldgen.G["camera"] and "factory" in worldgen.G["sets"] and "railway" in worldgen.G["sets"]


def test_the_first_establishing_shot_of_each_new_place_is_aerial():
    from fyt.worldgen import Actor, Shot

    shots = {k: Shot(scene=k, place=p, actors=[Actor(entity="x", verb="idle")], camera=c, on="x")
             for k, (p, c) in enumerate([("forest", "establish"), ("forest", "establish"), ("town", "orbit"), ("river", "establish")], 1)}
    out = worldgen.vary_cameras(shots)
    assert [out[k].camera for k in sorted(out)] == ["aerial", "establish", "orbit", "aerial"]
