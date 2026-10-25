"""The character kit (fyt/kit.py): the bundled people and the farm animals in the project library."""
import json

from fyt import assetlib, kit
from fyt.manifest import Entity


def animal(name: str, *search: str) -> Entity:
    return Entity(id="a", name=name, kind="animal", search=list(search) or [name], look="", certain=True, scenes=[1])


def test_a_farm_animal_comes_from_the_project_library_with_its_own_walk():
    hit = assetlib.project_model(animal("the war horse", "horse"))
    assert hit and hit["key"] == "kit-horse" and hit["licence"] == "CC0"
    assert any("Walk" in c for c in hit["clips"])
    assert assetlib.project_model(animal("a calf", "calf"))["key"] == "kit-cow"


def test_a_word_that_only_starts_like_an_animal_is_not_one():
    assert assetlib.project_model(animal("the horsepower race", "horsepower engine")) is None
    assert assetlib.project_model(animal("a bulldozer", "bulldozer")) is None


def test_the_bundled_bodies_and_their_hair_are_staged_with_the_fetched_clips(tmp_path):
    root = tmp_path / "lib"
    (root / "ual2").mkdir(parents=True)
    # a clip library on the shared skeleton, as the kit fetch leaves it (a failed body fetch beside it)
    body = next((kit.BUNDLED / "bodies").glob("*Male_FullBody.glb"))
    (root / "ual2" / "clips.glb").write_bytes(body.read_bytes())
    inv = kit.inventory(kit._glb_json(body.read_bytes())) | {"clips": [{"name": "Idle_Loop", "seconds": 2}]}
    (root / "inventory.json").write_text(json.dumps({"ual2": {"models": {"clips.glb": inv}}, "bodies": {"error": "invalid key"}}))
    got = kit.stage(tmp_path / "public", root)
    assert got["bodies"]["m"].endswith("Superhero_Male_FullBody.glb") and got["bodies"]["f"].endswith("Superhero_Female_FullBody.glb")
    assert got["clips"] == ["kit/ual2-clips.glb"]
    assert {"long", "buns", "parted", "beard"} <= set(got["hair"])
    assert all((tmp_path / "public" / n).is_file() for n in [*got["bodies"].values(), *got["hair"].values()])


def test_a_person_wears_the_outfit_their_role_names_or_their_top_suggests():
    from fyt import people

    assert people.outfit_for("Captain Edward Smith, the ship's captain", "m") == "kit-person-m-suit"
    assert people.outfit_for("a coal miner", "m") == "kit-person-m-worker"
    assert people.outfit_for("an astronaut", "m") == "kit-person-m-spacesuit"
    assert people.outfit_for("a police officer", "f") == "kit-person-f-soldier"
    assert people.outfit_for("Margaret, a guest", "f", top="labcoat") == "kit-person-f-formal"
    assert people.outfit_for("a passenger", "m") in ("kit-person-m-male-longsleeve", "kit-person-m-smooth-male-longsleeve")
    assert people.outfit_for("a man", "m") in ("kit-person-m-male-casual", "kit-person-m-smooth-male-casual")
    assert people.outfit_for("someone", "m") == "kit-person-m-casual-2"


def test_library_people_and_models_carry_their_licence_and_file():
    from fyt import assets, people

    assert len(people.outfits()) == 39 and {e["sex"] for e in people.outfits().values()} == {"f", "m"}
    picked = [e for k, e in assets.registry().items() if k.startswith("kit-")]
    assert picked and all(assets.library_ready(e) and e["licence"] in ("CC0", "by", "supplied") for e in picked)
    # (packs the channel's owner supplied without a licence file are marked so)
    assert all(e["source"].startswith("supplied by") for e in picked if e["licence"] == "supplied")
    # the CC BY animals name who made them, for the video's credits
    assert all(e["author"] and e["source"].startswith("https://") for e in picked if e["licence"] == "by")


def test_a_story_vehicle_or_sea_creature_comes_from_the_library():
    assert assetlib.project_model(animal("the fire engine", "fire engine"))["key"] == "kit-fire-truck"
    assert assetlib.project_model(animal("a humpback whale", "humpback whale", "whale"))["key"] == "kit-whale"
    assert assetlib.project_model(animal("the steam locomotive", "steam locomotive"))["key"] == "kit-steam-locomotive"
    assert assetlib.project_model(animal("a ballpoint pen", "pen")) is None


def test_a_story_animal_is_that_animal_not_its_nearest_cousin():
    def key(name, *search):
        return assetlib.project_model(animal(name, *search))["key"]
    assert key("a grizzly bear", "grizzly bear") == "kit-grizzly"
    assert key("the black bear", "black bear") == "kit-bear"
    assert key("a polar bear", "polar bear") == "kit-polar-bear"
    assert key("a German shepherd", "german shepherd", "dog") == "kit-doberman"
    assert key("the dog", "dog") == "kit-dog"
    assert key("a pug", "pug") == "kit-pug"
    assert key("a wild boar", "wild boar") == "kit-boar"
    assert key("a field mouse", "mouse") == "kit-mouse"
    assert key("Canada geese", "canada goose") == "kit-goose"
    # the horse keeps its own animated walk
    assert key("the horse", "horse") == "kit-horse"


def test_a_library_animal_rigged_here_keeps_its_posing_and_credit():
    from fyt import worldgen

    hit = assetlib.project_model(animal("the elephant", "elephant"))
    # rigged from its shape (fyt/rigging.py): its own clips, and still laid on its side to sleep
    assert hit["posed"] and "Walk" in hit["clips"] and hit["licence"] == "by"
    build = worldgen.rule_build(animal("the elephant", "elephant"), 1)
    assert worldgen.shows(build, {"posed": True}) and not worldgen.shows(build, {"clips": []})
    assert any("David OReilly" in line for line in assetlib.credits({"e": hit}))
