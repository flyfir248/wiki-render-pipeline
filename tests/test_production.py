"""The production layers around the renderer: which model a 3D scene uses and where it came from
(fyt/assets.py), each video's art direction (fyt/artdirect.py), the production storyboard
(fyt/shotlist.py) and the quality gate (fyt/qcheck.py)."""
import json
import math
from pathlib import Path

import numpy as np

from fyt import artdirect, assets, qcheck, scenes3d, shotlist
from fyt.config import Config
from fyt.models import Media, Script, ScriptScene, Word
from fyt.timeline import build_props


def script(*scenes: ScriptScene, title: str = "A true story", mood: str = "curious") -> Script:
    return Script(title=title, mood=mood, description="D", tags=["a"], thumbnail_text="X", thumbnail_kicker="K",
                  thumbnail_query="q", scenes=list(scenes), sources=["https://example.com"])


def world(narration: str, subject: str, action: str, variant: str | None = None, **kw) -> ScriptScene:
    return scenes3d.guard(ScriptScene(narration=narration, type="world", subject=subject, variant=variant, action=action, **kw))


def props_for(s: Script, cfg: Config | None = None, seconds: float = 3.0, look: str | None = None):
    cfg = cfg or Config(format="short")
    spans = [(i * seconds, (i + 1) * seconds) for i in range(len(s.scenes))]
    words = [[Word(word=w, start=j * 0.3, end=j * 0.3 + 0.25) for j, w in enumerate(sc.narration.split())] for sc in s.scenes]
    return build_props(cfg, s, spans, words, {}, None, None, look=look)


# Which model, from where.

def test_a_named_ship_gets_its_spec_in_every_scene():
    s = assets.resolve(script(
        world("The Titanic left Southampton.", "ship", "sail", "liner", subject_name="ship:liner"),
        world("At 11:40 she struck an iceberg.", "ship", "collide", "liner", subject_name="ship:liner"),
        title="The Night the Titanic Sank",
    ))
    first, second = s.scenes
    assert first.model["id"] == second.model["id"] == "titanic"
    assert first.model["level"] == "spec" and first.model["params"]["funnels"] == 4
    assert first.subject_name == second.subject_name == "titanic"  # one livery for both scenes
    assert first.label == "ILLUSTRATION" and second.label == "RECONSTRUCTION"


def test_an_unnamed_subject_is_generic_and_says_so():
    s = assets.resolve(script(world("The train derailed on the bend.", "train", "derail", "steam")))
    scene = s.scenes[0]
    assert scene.model["level"] == "generic"
    assert scene.label == "RECONSTRUCTION · SIMPLIFIED"


def test_the_story_names_the_aircraft_type():
    s = assets.resolve(script(world("Both engines failed after the bird strike, and the plane began to descend.", "aircraft", "descend"),
                              title="US Airways Flight 1549: the A320 that landed on the Hudson"))
    assert s.scenes[0].model["id"] == "airbus-a320"
    assert s.scenes[0].model["params"]["engines"] == 2


def test_two_named_rockets_in_one_story_are_not_guessed():
    s = assets.resolve(script(world("It climbed into the sky.", "rocket", "ascent"),
                              title="From Saturn V to Falcon 9"))
    assert s.scenes[0].model["level"] == "generic"


def test_a_library_model_needs_its_file_and_licence(tmp_path, monkeypatch):
    reg = dict(assets.registry())
    reg["titanic-glb"] = {"kind": "library", "subject": "ship", "variant": "liner", "names": ["titanic"], "src": "titanic.glb",
                          "source": "https://example.org/titanic", "licence": "CC0", "title": "RMS Titanic"}
    monkeypatch.setattr(assets, "registry", lambda: reg)
    monkeypatch.setattr(assets, "MODELS_DIR", tmp_path)
    s = script(world("The Titanic sailed.", "ship", "sail", "liner"))
    assert assets.resolve(s).scenes[0].model["level"] == "spec"  # no file yet: the spec
    (tmp_path / "titanic.glb").write_bytes(b"glTF")
    m = assets.resolve(s).scenes[0].model
    assert (m["level"], m["src"], m["licence"]) == ("library", "models/titanic.glb", "CC0")
    public = tmp_path / "public"
    assert assets.stage(assets.resolve(s), public) == [] and (public / "models" / "titanic.glb").exists()


def test_molecules_are_measured_geometry():
    water = assets.molecules()["water"]
    o, h1, h2 = (np.array(p) for _, p in water["atoms"])
    v1, v2 = h1 - o, h2 - o
    assert abs(np.linalg.norm(v1) - 0.9572) < 1e-3
    assert abs(math.degrees(math.acos(v1 @ v2 / np.linalg.norm(v1) / np.linalg.norm(v2))) - 104.52) < 0.05
    s = assets.resolve(script(world("A water molecule is one oxygen and two hydrogen atoms.", "science", "rotate", "molecule")))
    assert s.scenes[0].model["id"] == "water" and s.scenes[0].label == "SCIENTIFIC MODEL"


def test_unknown_compound_falls_back_to_an_illustration(monkeypatch):
    monkeypatch.setattr(assets, "fetch_molecule", lambda name: None)  # no network
    s = assets.resolve(script(world("The molecule has a curious shape.", "science", "rotate", "molecule", subject_name="caffeine")))
    assert s.scenes[0].model["level"] == "generic" and s.scenes[0].label == "ILLUSTRATION"


def test_pubchem_structure_is_used_when_reachable(monkeypatch):
    found = {"names": ["caffeine"], "formula": "", "atoms": [["C", [0, 0, 0]], ["O", [1.2, 0, 0]]], "bonds": [[0, 1, 2]],
             "source": "https://pubchem.ncbi.nlm.nih.gov/compound/caffeine", "notes": "PubChem 3D conformer"}
    monkeypatch.setattr(assets, "fetch_molecule", lambda name: found)
    s = assets.resolve(script(world("Its structure explains why it keeps you awake.", "science", "rotate", "molecule", subject_name="caffeine")))
    assert s.scenes[0].model["id"] == "caffeine" and s.scenes[0].model["sources"] == [found["source"]]


def test_technology_is_always_an_illustration():
    s = assets.resolve(script(world("The neural network was trained on millions of games.", "technology", "train", "network")))
    assert s.scenes[0].illustrative and s.scenes[0].label == "ILLUSTRATION"


def test_whole_word_keywords():
    assert scenes3d.find("The AI beat the champion", ["=ai"]) == "AI"
    assert scenes3d.find("The aircraft climbed", ["=ai"]) is None


# Art direction.

def test_art_direction_follows_the_story():
    titanic = script(ScriptScene(narration="In 1912 the liner sailed.", type="statement"), mood="somber")
    assert artdirect.choose(titanic) == "archival"
    space = script(world("The probe swung past Jupiter.", "space", "flyby", "probe"))
    assert artdirect.choose(space) == "cosmic"
    assert artdirect.choose(space, news=True) == "news"
    dark = script(ScriptScene(narration="Nobody knows who wrote the letters.", type="statement"), mood="tense")
    assert artdirect.choose(dark) == "noir"
    theme = artdirect.theme(Config().theme.model_dump(), "archival")
    assert theme["accent"] == Config().theme.accent  # the channel's accent stays
    assert theme["grade"].startswith("sepia") and theme["profile"] == "archival"


def test_art_direction_reaches_the_renderer():
    s = assets.resolve(script(world("The probe swung past Jupiter.", "space", "flyby", "probe")))
    props = props_for(s, look="cosmic")
    assert props.theme["profile"] == "cosmic" and props.theme["background"] == artdirect.PROFILES["cosmic"]["background"]
    assert props.scenes[0].label and props.scenes[0].model["id"]


# The production storyboard.

def test_shotlist_records_every_scene():
    s = assets.resolve(script(
        ScriptScene(narration="In 1912 the Titanic was the largest ship afloat.", type="statement", heading="RMS Titanic", purpose="how big she was"),
        world("At 11:40 the Titanic struck an iceberg.", "ship", "collide", "liner", cue="struck"),
    ))
    props = props_for(s)
    board = shotlist.build(s, props, "archival", {"planner": "rules"})
    first, second = board["shots"]
    assert first["purpose"] == "how big she was" and first["technique"] == "2D" and first["status"] == "documented"
    assert second["technique"] == "3D" and second["status"] == "reconstruction" and second["label"] == "RECONSTRUCTION"
    model = next(a for a in second["assets"] if a["kind"] == "model")
    assert model["id"] == "titanic" and model["sources"]
    assert second["start"] <= second["key_moment"] <= second["end"] and second["cue"] == "struck"
    assert second["audio"] and second["audio"][0]["sound"] == "boom"
    assert board["art_direction"] == "archival" and board["sources"]
    json.dumps(board)


# The quality gate.

def test_gate_passes_a_sound_script(tmp_path):
    s = assets.resolve(script(
        ScriptScene(narration="In 1883 Krakatoa erupted.", type="statement", text="t"),
        world("The volcano began to erupt, throwing ash miles high.", "landscape", "erupt", "volcano"),
    ))
    r = qcheck.before_render(Config(format="short"), s, props_for(s), tmp_path)
    assert r.problems == [], r.problems
    assert set(r.checks) == {"coverage", "assets", "timing", "readability", "continuity", "provenance"}


def test_gate_holds_missing_assets_and_undocumented_events(tmp_path):
    bad = ScriptScene(narration="The ship sailed on.", type="world", subject="ship", variant="liner", action="sink",
                      illustrative=False, label="RECONSTRUCTION", model={"id": "ship:liner", "level": "generic"})
    s = script(ScriptScene(narration="A photo.", type="broll"), bad)
    props = props_for(s)
    props.scenes[0].media = Media(src="photos/missing.jpg", kind="image")
    r = qcheck.before_render(Config(format="short"), s, props, tmp_path)
    text = " | ".join(r.problems)
    assert "missing asset: photos/missing.jpg" in text
    assert "which its narration doesn't describe" in text
    assert "generic model a reconstruction" in text
    assert r.checks["assets"] == r.checks["provenance"] == "fail"


def test_gate_holds_a_subject_drawn_two_ways(tmp_path):
    a = world("The Titanic sailed.", "ship", "sail", "liner", subject_name="liner")
    b = world("The liner sailed on.", "ship", "sail", "cargo", subject_name="liner")
    s = script(a.model_copy(update={"model": {"id": "titanic", "level": "spec"}}), b.model_copy(update={"model": {"id": "ship:cargo", "level": "generic"}}))
    r = qcheck.before_render(Config(format="short"), s, props_for(s), tmp_path)
    assert r.checks["continuity"] == "fail"


def test_gate_warns_on_unreadable_text_and_bare_runs(tmp_path):
    long = "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen"
    s = script(*[ScriptScene(narration="Words.", type="statement", heading="H", text=long) for _ in range(3)])
    r = qcheck.before_render(Config(format="short"), s, props_for(s, seconds=2.0), tmp_path)
    assert r.problems == []
    assert any("words on screen with no picture" in w for w in r.warnings)
    assert any("words in" in w for w in r.warnings)


def test_a_broken_3d_scene_goes_back_to_its_2d_scene():
    old = ScriptScene(narration="The ship struck the iceberg.", type="statement", heading="Impact")
    new = world("The ship struck the iceberg.", "ship", "collide", "liner").model_copy(update={"fallback": old.model_dump(exclude_none=True)})
    fixed = qcheck.repaired(script(new), [0])
    assert fixed.scenes[0].type == "statement" and fixed.scenes[0].heading == "Impact"


def test_frame_checks_on_a_real_video(tmp_path):
    """A black video fails the frame and sound checks; it must never pass as finished."""
    import subprocess

    import imageio_ffmpeg

    video = tmp_path / "v.mp4"
    subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), "-loglevel", "error", "-f", "lavfi", "-i", "color=c=black:s=1080x1920:r=30:d=6",
                    "-pix_fmt", "yuv420p", str(video)], check=True)
    s = script(ScriptScene(narration="A.", type="statement"), ScriptScene(narration="B.", type="statement"))
    r = qcheck.after_render(Config(format="short"), s, props_for(s), video, voiced=True)
    assert r.checks["technical"] == "fail" and any("no soundtrack" in p for p in r.problems)
    assert r.checks["frames"] == "fail" and any("is black" in p for p in r.problems)
    assert qcheck.probe(video)["width"] == 1080


# Faults found by the five-topic validation run, kept fixed.


def test_flight_numbers_and_counts_are_not_years():
    assert scenes3d.story_year("US Airways Flight 1549 took off in January 2009 with 155 on board.") == 2009
    assert scenes3d.story_year("Over 1,500 people died.") is None
    assert scenes3d.story_year("In July 1518 a woman began to dance.") == 1518


def test_trained_is_not_a_train():
    from fyt import visualplan

    s = script(ScriptScene(narration="AlphaGo used a neural network trained on human games, an AI that played itself.", type="statement"))
    plan = visualplan.rule_plan(s)
    assert all(r.subject != "train" for r in plan)


def test_a_city_in_1518_is_a_historic_city():
    assert scenes3d.variant_for("city", "the streets of the city of Strasbourg", 1518) == "historic"
    assert scenes3d.variant_for("city", "the streets of the city", 2009) == "modern"
    assert scenes3d.variant_for("city", "a medieval town", 2009) == "historic"


def test_a_story_told_in_numbers_takes_the_data_look():
    s = script(
        ScriptScene(narration="A.", type="trend"), ScriptScene(narration="B.", type="stat"),
        ScriptScene(narration="C.", type="bars"), world("A volcano.", "landscape", "flyover", "volcano"),
    )
    assert artdirect.choose(s) == "news"


def test_the_planner_keeps_what_the_scriptwriter_staged():
    from fyt import visualplan
    from fyt.visualplan import Reconstruction

    old = ScriptScene(narration="He set the airliner down on the freezing Hudson river.", type="aircraft", maneuver="land", setting="sea", shot="side")
    r = Reconstruction(scene=1, subject="aircraft", variant="airliner", action="cruise", shot="chase", setting="city", subject_name="aircraft:airliner")
    out, _ = visualplan.apply(script(old), [r])
    s = out.scenes[0]
    assert (s.type, s.action, s.setting, s.shot) == ("world", "land", "sea", "side")


def test_a_story_before_1900_gets_period_backdrops():
    old = script(ScriptScene(narration="In July 1518 a woman danced in the street.", type="statement"))
    new = script(ScriptScene(narration="In January 2009 an airliner took off.", type="statement"))
    assert artdirect.theme({}, "archival", old)["era"] == "historic"
    assert artdirect.era(new) == "modern"


def test_a_trend_point_lands_on_its_own_figure_not_a_neighbours():
    from fyt.models import DataPoint
    from fyt.timeline import land_times

    said = "In 1960 it was 317 . By 2000 it was 370 . In 2023 it passed 421 ."
    words = [Word(word=w, start=i * 0.5, end=i * 0.5 + 0.4) for i, w in enumerate(said.split())]
    pts = [DataPoint(label=y, value=v) for y, v in (("1960", 316.9), ("2000", 369.7), ("2020", 414.2), ("2023", 421.1))]
    t = land_times(ScriptScene(narration=said, type="trend", data=pts), words, 0)
    assert t[3] < 8.0 and t[1] < t[2] < t[3]  # 2023 lands on "2023", and 2020 sits between its neighbours
