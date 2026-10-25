"""Rigging and the catalogue (fyt/rigging.py, fyt/catalog.py): still library animals are rigged from their
shape so they walk, eat and lie down, and the catalogue records what every model can do."""
import json
import subprocess

from fyt import assets, catalog, rigging
from fyt.assetlib import RENDERER_DIR


def test_every_still_library_animal_is_rigged_or_says_why_not():
    reg = assets.registry()
    still = {k: e for k, e in reg.items() if e.get("posed")}
    assert len(still) >= 100
    rigged = {k: e for k, e in still.items() if e.get("rig") == "auto"}
    assert len(rigged) >= 90
    for k, e in still.items():
        assert e.get("rig") in ("auto", "none", "own"), k
        if e["rig"] == "own":  # a rigged farm animal with an idle but no walk: posed for its gait
            assert e["clips"], k
        elif e["rig"] == "auto":
            assert e["rig_type"] in ("quadruped", "bird", "serpent") and e["clips"], k
        else:
            assert e.get("rig_note") and not e["clips"], k
    assert reg["kit-bear"]["rig_type"] == "quadruped" and {"Walk", "Run", "Eat", "Sleep"} <= set(reg["kit-bear"]["clips"])
    assert reg["kit-eagle"]["rig_type"] == "bird" and "Fly" in reg["kit-eagle"]["clips"]
    assert reg["kit-worm"]["rig_type"] == "serpent"


def test_a_rigged_animal_records_how_fast_its_gaits_cover_ground():
    got = catalog.inspect([assets.MODELS_DIR / "kit-wolf.glb"])["kit-wolf.glb"]
    assert got["rig"] == "auto" and got["rigType"] == "quadruped" and got["bones"] >= 13
    # a run covers more ground per second than a walk
    assert 0 < got["gait"]["Walk"] < got["gait"]["Run"]


def test_rigging_an_already_rigged_model_changes_nothing(tmp_path):
    src = assets.MODELS_DIR / "kit-bear.glb"
    before = src.read_bytes()
    got = rigging.rig(src, tmp_path / "again.glb")
    assert not got["ok"] and "already rigged" in got["reason"]
    assert src.read_bytes() == before and not (tmp_path / "again.glb").exists()


def test_a_model_with_no_legs_wings_or_length_is_left_alone(tmp_path):
    # a set piece: a rock
    r = subprocess.run(["node", "rig-model.mjs", str(RENDERER_DIR / "public/sets/nature-rock-medium-1.glb"), str(tmp_path / "rock.glb")],
                       cwd=RENDERER_DIR, capture_output=True, text=True, timeout=120)
    got = json.loads(r.stdout.strip().splitlines()[-1])
    assert not got["ok"] and "quadruped" in got["reason"]


def test_actions_come_from_clips_wheels_and_posing():
    assert {"walk", "run", "eat", "lie"} <= set(catalog.actions({"posed": True}, {"clips": ["Walk", "Run", "Eat", "Sleep"]}))
    # a rigged bear does not fly; a still animal still travels and lies down
    assert "fly" not in catalog.actions({"posed": True}, {"clips": ["Walk", "Idle"]})
    assert {"walk", "lie"} <= set(catalog.actions({"posed": True}, {"clips": []}))
    assert "drive" in catalog.actions({}, {"wheels": 4}) and catalog.actions({}, {}) == ["present"]
