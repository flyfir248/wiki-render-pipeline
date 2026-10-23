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
