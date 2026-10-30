"""Story-driven 3D: the story's manifest decides what 3D scenes show, each entity gets one model found
for it (or none), and a renderer's stock subject never stands in for something the story doesn't name
(fyt/manifest.py, fyt/visualplan.py, fyt/assetlib.py, fyt/relevance.py)."""
import json

import pytest
from PIL import Image

from fyt import assetlib, manifest, relevance, scenes3d, visualplan
from fyt.config import Config
from fyt.manifest import Entity, Manifest, Moment, Place
from fyt.models import Script, ScriptScene


def script(*lines: str, title: str = "Cocaine Bear") -> Script:
    return Script(
        title=title, description="D", tags=["a"], thumbnail_text="X", thumbnail_kicker="K", thumbnail_query="q",
        scenes=[ScriptScene(narration=t, type="statement", text="t") for t in lines], sources=["https://example.com"],
    )


BEAR_STORY = script(
    "In 1985 a smuggler dumped bags of cocaine from his Cessna over Georgia.",
    "Months later a black bear found the duffel bags in the forest.",
    "The bear tore the bags open and ate the cocaine.",
    "Investigators found the bear dead beside forty opened packages.",
)

BEAR = Entity(id="bear", name="the black bear", kind="animal", search=["american black bear", "black bear", "bear"],
              look="a young American black bear, glossy black fur, brown muzzle", certain=False, scenes=[2, 3, 4])
PLANE = Entity(id="smuggler-plane", name="the smuggler's Cessna", kind="light aircraft", search=["cessna 404", "light aircraft"],
               look="a twin-engine Cessna 404 Titan, white with a stripe", certain=False, scenes=[1])
FOREST = Place(id="forest", name="Chattahoochee National Forest", look="dense Appalachian woodland, autumn leaves, a creek", scenes=[2, 3, 4])


def bear_manifest(**kw) -> Manifest:
    return Manifest(
        entities=[BEAR, PLANE], places=[FOREST],
        moments=kw.get("moments", [
            Moment(scene=1, entity="smuggler-plane", action="dumped bags", motion="move", cue="dumped bags of cocaine", documented=True, priority=2),
            Moment(scene=3, entity="bear", place="forest", action="tore the bags open", motion="shake", cue="tore the bags open", documented=True, priority=1),
        ]),
    )


# The manifest is held to the script.

def test_manifest_keeps_entities_to_the_scenes_that_name_them():
    raw = Manifest(
        entities=[BEAR.model_copy(update={"scenes": [1, 2, 3, 4, 9]}),
                  Entity(id="airliner", name="a jumbo jet", kind="aircraft", search=["boeing 747"], look="x", certain=True, scenes=[1])],
        moments=[Moment(scene=2, entity="bear", action="ate", motion="move", cue="not in the narration", documented=True),
                 Moment(scene=1, entity="airliner", action="flew", motion="move", cue="", documented=False)],
    )
    m = manifest.checked(raw, BEAR_STORY)
    ids = [e.id for e in m.entities]
    assert ids == ["bear"]  # nothing in the script refers to a jumbo jet
    assert m.entities[0].scenes == [2, 3, 4]  # scene 1 names no bear; scene 9 doesn't exist
    # A moment whose cue isn't in the narration is not documented, and then does nothing on its own.
    mo = m.moments[0]
    assert (mo.documented, mo.motion, mo.cue) == (False, "present", "")


# The plan works from the story, not from the renderer's catalog.

def test_catalog_pick_without_a_matching_entity_is_dropped():
    recon = [visualplan.Reconstruction(scene=1, subject="aircraft", variant="airliner", action="cruise", priority=1)]
    kept, dropped = visualplan.story_fit(BEAR_STORY, bear_manifest(), recon)
    assert kept == [] and dropped[0]["subject"] == "aircraft"  # a Cessna is not the airliner module's


def test_catalog_pick_that_stands_for_an_entity_takes_its_name():
    s = script("The Boeing 747 lifted off from Heathrow at dawn.", title="A flight")
    jet = Entity(id="jumbo", name="the Boeing 747", kind="airliner", search=["boeing 747", "airliner", "airplane"], look="x", certain=True, scenes=[1])
    recon = [visualplan.Reconstruction(scene=1, subject="aircraft", variant="airliner", action="takeoff", priority=1)]
    kept, _ = visualplan.story_fit(s, Manifest(entities=[jet]), recon)
    assert kept[0].subject_name == "jumbo"


def test_story_entities_with_no_module_get_stage_scenes():
    recon = visualplan.stage_plan(BEAR_STORY, bear_manifest(), taken=set())
    by_scene = {r.scene: r for r in recon}
    assert by_scene[3].subject == "stage" and by_scene[3].subject_name == "bear" and by_scene[3].action == "shake"
    assert by_scene[3].backdrop.startswith("Chattahoochee") and by_scene[3].cue == "tore the bags open"
    # The Cessna has no module that stands for it either: it is the stage's job, with its own model.
    assert by_scene[1].subject_name == "smuggler-plane"


def test_a_moment_whose_entity_a_module_models_gets_that_module_when_the_planner_left_it_out():
    # Mary Celeste: the planner chose no 3D at all, and the ship module was never used for the ship.
    story = script("In 1872 the brigantine Mary Celeste left New York.", "A month later she was found adrift near the Azores, its sails half-raised.",
                   "No one was ever found.", "Her cargo was intact.", "The lifeboat was gone.", title="Mary Celeste")
    ship = Entity(id="mary-celeste", name="the Mary Celeste", kind="merchant brigantine", search=["mary celeste", "brigantine", "ship"],
                  look="a two-masted wooden brigantine", certain=True, scenes=[1, 2])
    m = Manifest(entities=[ship], moments=[Moment(scene=2, entity="mary-celeste", action="drifting", motion="present",
                                                  cue="its sails half-raised", documented=True, priority=1)])
    (r,) = visualplan.stage_plan(story, m, taken=set())
    assert (r.subject, r.variant, r.subject_name, r.action) == ("ship", "sailing", "mary-celeste", "sail")
    # The planner's own pick of the ship module is drawn as the entity is, not as the planner guessed.
    (kept,), _ = visualplan.story_fit(story, m, [visualplan.Reconstruction(scene=2, subject="ship", variant="cargo", action="sail")])
    assert kept.variant == "sailing" and kept.in_story
    wine = Entity(id="cargo-wine", name="the cargo of wine", kind="wine barrels", search=["wine barrels", "cargo", "barrels"],
                  look="oak barrels", certain=True, scenes=[4])
    assert not any(visualplan.stands_for(k, wine) for k in scenes3d.subjects())  # "cargo" is not a "car"
    boat = Entity(id="lifeboat", name="the lifeboat", kind="boat", search=["lifeboat", "boat", "small boat"], look="small wooden boat",
                  certain=True, scenes=[3])
    assert not visualplan.stands_for("ship", boat)  # the ship module would draw an ocean liner
    assert relevance.text_gate(story.model_copy(update={"scenes": [
        sc if i != 1 else sc.model_copy(update={"type": "world", "subject": "ship", "subject_name": "mary-celeste"})
        for i, sc in enumerate(story.scenes)]}), m) == {}


def test_plan_with_a_manifest_never_shows_an_unlisted_subject(monkeypatch):
    monkeypatch.setattr(visualplan, "_llm_plan", lambda *a: [
        visualplan.Reconstruction(scene=1, subject="aircraft", variant="airliner", action="cruise", priority=1),
        visualplan.Reconstruction(scene=2, subject="landscape", variant="forest", action="flyover", priority=2)
        if "forest" in scenes3d.VARIANTS else visualplan.Reconstruction(scene=2, subject="landscape", action="flyover", priority=2),
    ])
    planned, report = visualplan.plan(Config(format="short"), BEAR_STORY, "", log=lambda m: None, story=bear_manifest())
    world = [(i, s.subject, s.subject_name) for i, s in enumerate(planned.scenes, 1) if s.type == "world"]
    assert all(subj != "aircraft" for _, subj, _ in world)
    assert (3, "stage", "bear") in world
    assert any(d["subject"] == "aircraft" for d in report["off_story"])


def test_stage_event_rests_on_its_cue():
    scene = ScriptScene(narration="The bear tore the bags open and ate the cocaine.", type="world", subject="stage",
                        variant="model", action="shake", cue="tore the bags open", subject_name="bear")
    out = scenes3d.guard(scene)
    assert out.action == "shake" and not out.illustrative
    out = scenes3d.guard(scene.model_copy(update={"cue": None}))
    assert out.action == "present" and out.illustrative  # no words for it: the bear is only shown


# Finding models: by the entity's own noun, a licence that allows it, and a look the checker accepts.

def test_relevance_needs_the_entity_noun():
    assert assetlib.relevant("american black bear", "Black Bear (rigged)", ["animal"]) > 0.5
    assert assetlib.relevant("black bear", "Teddy", ["toy", "plush"]) == 0
    assert assetlib.relevant("bear", "Forest animals pack: bear, deer, fox", []) == 0  # a pack is not one bear
    assert assetlib.relevant("cessna 404", "Boeing 747-400", ["airliner"]) == 0


def test_licence_codes():
    assert assetlib.licence_code({"slug": "by"}) == "by"
    assert assetlib.licence_code("CC Attribution-NonCommercial") == "by-nc"
    assert assetlib.licence_code("CC0 1.0") == "cc0"


@pytest.fixture
def cache(tmp_path, monkeypatch):
    monkeypatch.setattr(assetlib, "CACHE", tmp_path / "models")
    monkeypatch.setattr(assetlib, "project_model", lambda e: None)
    monkeypatch.setattr(assetlib, "_download", lambda url, dest, headers=None, limit_mb=80: dest.write_bytes(b"jpg") or dest)
    monkeypatch.setattr(assetlib, "looks_right", lambda cfg, e, term, pic: (True, ""))
    return tmp_path


def fake_candidate(title: str, licence: str, raw: bytes = b"glb"):
    def fetch(dest):
        dest.write_bytes(raw)
        return dest
    return {"uid": f"test:{title}", "source": "sketchfab", "title": title, "tags": [], "author": "Ann", "licence": licence,
            "url": "https://example.com/m", "thumb": "https://example.com/t.jpg", "triangles": 5000, "animated": False, "score": 1.0, "fetch": fetch}


def test_resolve_skips_bad_licences_and_broken_models_then_caches(cache, monkeypatch):
    cands = [fake_candidate("Black Bear NC", "by-nc"), fake_candidate("Black Bear broken", "by", b"bad"), fake_candidate("Black Bear", "by")]
    monkeypatch.setattr(assetlib, "SOURCES", {"sketchfab": lambda cfg, term, log: cands if term == "american black bear" else []})

    def prepare(raw, out, triangles, texture=1024):
        if raw.read_bytes() == b"bad":
            return {"ok": False, "error": "not a glTF file"}
        out.write_bytes(b"prepared")
        return {"ok": True, "triangles": 4200, "bytes": 8, "size": [1.0, 0.8, 2.0], "clips": ["Walk"]}

    monkeypatch.setattr(assetlib, "prepare", prepare)
    cfg = Config(format="short")
    cfg.visuals.asset_sources = ["sketchfab"]
    hit = assetlib.resolve(cfg, BEAR, "medium", log=lambda m: None)
    assert hit["title"] == "Black Bear" and hit["licence"] == "by" and hit["clips"] == ["Walk"]
    meta = json.loads((cache / "models" / "american-black-bear" / "meta.json").read_text())
    assert meta["author"] == "Ann" and meta["source"] == "sketchfab"
    assert "test:Black Bear broken" in json.loads((cache / "models" / "_rejected.json").read_text())
    # The next video that needs a bear reuses it without searching.
    monkeypatch.setattr(assetlib, "SOURCES", {})
    assert assetlib.resolve(cfg, BEAR, "medium", log=lambda m: None)["title"] == "Black Bear"
    assert assetlib.credit(hit) == "Black Bear by Ann (CC BY 4.0) https://example.com/m"


def test_resolve_finds_nothing_rather_than_something_else(cache, monkeypatch):
    monkeypatch.setattr(assetlib, "SOURCES", {"sketchfab": lambda cfg, term, log: []})
    cfg = Config(format="short")
    cfg.visuals.asset_sources = ["sketchfab"]
    assert assetlib.resolve(cfg, PLANE, "medium", log=lambda m: None) is None
    assert assetlib._missed("cessna 404")  # not searched again for a while


def test_vision_check_rejects_the_wrong_thing(cache, monkeypatch):
    c = fake_candidate("Black Bear", "cc0")
    monkeypatch.setattr(assetlib, "SOURCES", {"sketchfab": lambda cfg, term, log: [c]})
    monkeypatch.setattr(assetlib, "looks_right", lambda cfg, e, term, pic: (False, "a teddy bear"))
    cfg = Config(format="short")
    cfg.visuals.asset_sources = ["sketchfab"]
    assert assetlib.resolve(cfg, BEAR, "medium", log=lambda m: None) is None


def test_no_vision_check_no_model(cache, monkeypatch):
    # Run 121 took a scan of a bear's jawbone for the bear when the preview check couldn't be made.
    monkeypatch.setattr(assetlib, "SOURCES", {"sketchfab": lambda cfg, term, log: [fake_candidate("Black Bear", "cc0")]})
    monkeypatch.setattr(assetlib, "looks_right", lambda cfg, e, term, pic: (None, ""))
    cfg = Config(format="short")
    cfg.visuals.asset_sources = ["sketchfab"]
    assert assetlib.resolve(cfg, BEAR, "medium", log=lambda m: None) is None
    # Run 124: the free vision allowance was spent. That is not a miss; the search runs again next time.
    assert not any(assetlib._missed(t) for t in BEAR.search)


def fake_prepare(raw, out, triangles, texture=1024):
    out.write_bytes(b"prepared")
    return {"ok": True, "triangles": 6000, "bytes": 8, "size": [1.0, 0.8, 2.0], "clips": []}


def generating(monkeypatch, made: list):
    """Generation through a fake GPU worker; `made` records each concept picture sent."""
    from fyt import artgen
    from PIL import Image

    monkeypatch.setattr(assetlib, "prepare", fake_prepare)
    monkeypatch.setattr(artgen, "provider", lambda: "test")
    monkeypatch.setattr(assetlib, "concept", lambda e, out: Image.new("RGB", (8, 8), "white").save(out) or out)

    def worker(url, picture, dest):
        made.append(picture.name)
        dest.write_bytes(b"glTF....")
        return dest

    monkeypatch.setattr(assetlib, "_from_worker", worker)
    cfg = Config(format="short")
    cfg.visuals.asset_sources = ["sketchfab", "image_to_3d"]
    cfg.visuals.image_to_3d_url = "https://gpu.example.com/trellis2"
    return cfg


def test_a_model_is_generated_only_when_no_library_has_one(cache, monkeypatch):
    made: list = []
    cfg = generating(monkeypatch, made)
    monkeypatch.setattr(assetlib, "SOURCES", {"sketchfab": lambda cfg, term, log: [fake_candidate("Black Bear", "cc0")]})
    assert assetlib.resolve(cfg, BEAR, "medium", log=lambda m: None)["source"] != "generated"
    assert made == []

    monkeypatch.setattr(assetlib, "SOURCES", {"sketchfab": lambda cfg, term, log: []})
    plane = assetlib.resolve(cfg, PLANE, "medium", log=lambda m: None)
    assert plane["source"] == "generated" and plane["illustrative"] and len(made) == 1
    assert assetlib.cached(assetlib.slug("cessna 404"))  # cached, so the next video reuses it


def test_generation_is_capped_per_video_and_a_failure_is_not_retried(cache, monkeypatch):
    made: list = []
    cfg = generating(monkeypatch, made)
    cfg.visuals.max_generated = 1
    monkeypatch.setattr(assetlib, "SOURCES", {"sketchfab": lambda cfg, term, log: []})
    got = assetlib.resolve_all(cfg, bear_manifest(), {"bear": "medium", "smuggler-plane": "medium"}, log=lambda m: None)
    assert list(got) == ["bear"] and len(made) == 1

    monkeypatch.setattr(assetlib, "looks_right", lambda cfg, e, term, pic: (False, "a dog"))  # a bad concept picture
    assert assetlib.resolve(cfg, PLANE, "medium", log=lambda m: None) is None
    assert assetlib._missed("generated-cessna 404") and len(made) == 1  # no GPU time spent on it, nor again tomorrow


def test_a_part_or_remains_is_not_the_thing():
    assert assetlib.relevant("american black bear", "MSCC007 Ursus americanus Left Mandible", ["bear", "black bear"]) == 0
    assert assetlib.relevant("black bear", "MSCC 007 U Americanus Left Femur Mesh", ["black bear"]) == 0
    assert assetlib.relevant("bear", "Bear skull", ["bear"]) == 0
    assert assetlib.relevant("human skull", "Human skull", ["anatomy"]) > 0  # unless the part is what's asked for


def test_sound_rejects_primitives_and_oversize():
    assert assetlib.sound({"ok": True, "triangles": 48, "bytes": 1, "size": [1, 1, 1]}, 12).startswith("only 48")
    assert "MB" in assetlib.sound({"ok": True, "triangles": 5000, "bytes": 40e6, "size": [1, 1, 1]}, 12)
    assert assetlib.sound({"ok": True, "triangles": 5000, "bytes": 1e6, "size": [1, 1, 1]}, 12) is None


# Continuity and the gate.

def stage_scene(n: str, cue: str | None, action="shake") -> ScriptScene:
    return scenes3d.guard(ScriptScene(narration=n, type="world", subject="stage", variant="model", action=action, cue=cue,
                                      subject_name="bear", fallback={"narration": n, "type": "statement", "text": "t"}))


def test_one_model_for_every_scene_of_an_entity_and_honest_labels():
    s = script("Months later a black bear found the duffel bags.", "The bear tore the bags open and ate the cocaine.")
    s.scenes[0] = stage_scene(s.scenes[0].narration, "found the duffel bags", "move")
    s.scenes[1] = stage_scene(s.scenes[1].narration, "tore the bags open")
    story = Manifest(entities=[BEAR.model_copy(update={"scenes": [1, 2]})])
    found = {"bear": {"key": "american-black-bear", "source": "sketchfab", "title": "Black Bear", "licence": "by", "url": "u", "clips": ["Walk"]}}
    out, back = assetlib.attach(s, story, found, {"bear": "models/american-black-bear.glb"})
    assert back == []
    assert {sc.model["src"] for sc in out.scenes} == {"models/american-black-bear.glb"}
    # The bear's exact look isn't documented: a reconstruction, said to be illustrative.
    assert {sc.label for sc in out.scenes} == {"RECONSTRUCTION · ILLUSTRATIVE"}
    # Without a model the scenes go back to 2D: no stand-in.
    out, back = assetlib.attach(s, story, {}, {})
    assert back == [0, 1] and all(sc.type == "statement" for sc in out.scenes)


def test_text_gate_drops_3d_the_story_does_not_list():
    s = script("The plane flew on over the trees.", "The bear tore the bags open.")
    s.scenes[0] = s.scenes[0].model_copy(update={"type": "world", "subject": "aircraft", "subject_name": "aircraft:airliner"})
    s.scenes[1] = stage_scene(s.scenes[1].narration, "tore the bags open")
    bad = relevance.text_gate(s, Manifest(entities=[BEAR.model_copy(update={"scenes": [2]})]))
    assert list(bad) == [0]
    assert relevance.apply(s, bad).scenes[0].type == "statement"


def test_clip_choice_follows_the_motion_by_name():
    stage = (scenes3d.CATALOG_PATH.parent / "stage.tsx").read_text()
    assert "walk|run" in stage and "idle|survey" in stage  # a walk for move, an idle for present, else none


def test_asset_check_passes_only_what_a_vision_model_saw_in_the_render(tmp_path, monkeypatch):
    from fyt import assetcheck, render, storyboard
    from fyt.storyboard import Verdict

    model = tmp_path / "m" / "model.glb"
    model.parent.mkdir()
    model.write_bytes(b"glTF")
    monkeypatch.setattr(assetlib, "generator_status", lambda cfg: "image-to-3D: off")
    monkeypatch.setattr(assetlib, "resolve", lambda cfg, e, fid, log=print, generate=True: (
        {"key": e.id, "file": str(model), "source": "sketchfab", "title": e.id, "licence": "cc0", "checked": "vision",
         "triangles": 5000, "clips": []} if e.id in ("bear", "ship") else None))

    def frames(props, public, out, at):
        out.mkdir(parents=True, exist_ok=True)
        files = [out / f"frame-{f:05d}.png" for f in at]
        for f in files:
            Image.new("RGB", (36, 64)).save(f)
        return files

    monkeypatch.setattr(render, "frames", frames)
    monkeypatch.setattr(storyboard, "review", lambda cfg, path, meant, rules=None: Verdict(matches="bear" in meant, problems="a box"))
    rows = assetcheck.run(Config(format="short"), tmp_path / "out", log=lambda m: None)
    assert [r["pass"] for r in rows] == [True, False, False, False, False]
    assert "1 of 5 passed" in (tmp_path / "out" / "report.md").read_text()
    assert (tmp_path / "out" / "sheet.png").is_file()


def test_a_model_the_render_check_failed_is_forgotten_and_never_taken_again(cache, monkeypatch):
    cands = [fake_candidate("Black Bear Calcanium", "cc0"), fake_candidate("Black Bear", "cc0")]
    cands[0]["title"] = "Black Bear"  # a title the part rules can't catch
    monkeypatch.setattr(assetlib, "SOURCES", {"sketchfab": lambda cfg, term, log: cands})
    monkeypatch.setattr(assetlib, "prepare", fake_prepare)
    cfg = Config(format="short")
    cfg.visuals.asset_sources = ["sketchfab"]
    first = assetlib.resolve(cfg, BEAR, "medium", log=lambda m: None)
    assetlib.forget(first["key"], "frame check: a white bone")
    assert assetlib.cached(first["key"]) is None
    second = assetlib.resolve(cfg, BEAR, "medium", log=lambda m: None)
    assert second["uid"] != first["uid"]


def test_without_a_vision_check_only_a_well_liked_full_match_is_used(cache, monkeypatch):
    # Run 213: no free vision model could look (Groq lists none, Cloudflare's allowance was spent), so
    # the Titan stayed a stack of boxes. A model naming every word of a specific term, that people liked,
    # is used; it is searched again (and seen) once a check can be made.
    liked = fake_candidate("American Black Bear", "cc0") | {"likes": 40}
    monkeypatch.setattr(assetlib, "SOURCES", {"sketchfab": lambda cfg, term, log: [liked] if term == "american black bear" else []})
    monkeypatch.setattr(assetlib, "looks_right", lambda cfg, e, term, pic: (None, ""))
    monkeypatch.setattr(assetlib, "prepare", fake_prepare)
    cfg = Config(format="short")
    cfg.visuals.asset_sources = ["sketchfab"]
    hit = assetlib.resolve(cfg, BEAR, "medium", log=lambda m: None)
    assert hit["checked"] == "text" and assetlib.cached("american-black-bear") is None
    assert not assetlib.sure_by_name("bear", liked | {"score": 1.0})  # one word could be any bear
    assert not assetlib.sure_by_name("american black bear", fake_candidate("American Black Bear", "cc0"))  # nobody liked it


def test_a_living_thing_takes_only_a_model_that_can_move(cache, monkeypatch):
    still = fake_candidate("American Black Bear statue pose", "cc0")
    moving = fake_candidate("American Black Bear walk cycle", "cc0", b"anim") | {"animated": True}
    monkeypatch.setattr(assetlib, "SOURCES", {"sketchfab": lambda cfg, term, log: [still, moving]})

    def prepare(raw, out, triangles, texture=1024):
        out.write_bytes(b"prepared")
        return {"ok": True, "triangles": 6000, "bytes": 8, "size": [1.0, 0.8, 2.0], "clips": ["Walk"] if raw.read_bytes() == b"anim" else []}

    monkeypatch.setattr(assetlib, "prepare", prepare)
    cfg = Config(format="short")
    cfg.visuals.asset_sources = ["sketchfab"]
    assert assetlib.resolve(cfg, BEAR, "medium", log=lambda m: None, animated=True)["title"] == "American Black Bear walk cycle"
    # a still model in the cache does for a thing, not for a creature
    monkeypatch.setattr(assetlib, "SOURCES", {"sketchfab": lambda cfg, term, log: [still]})
    for term in BEAR.search:
        (cache / "models" / assetlib.slug(term)).exists() and __import__("shutil").rmtree(cache / "models" / assetlib.slug(term))
    assert assetlib.resolve(cfg, BEAR, "medium", log=lambda m: None)["title"] == "American Black Bear statue pose"
    assert assetlib.resolve(cfg, BEAR, "medium", log=lambda m: None, animated=True) is None


def test_filler_3d_does_not_show_the_same_shot_over_and_over():
    lines = [f"The C-130 cargo plane flew another mission over the valley, number {k}." for k in range(1, 9)]
    plane = Entity(id="c130", name="the C-130 cargo plane", kind="aircraft", search=["c-130", "cargo aircraft"],
                   look="a grey four-engine transport", certain=True, scenes=list(range(1, 9)))
    story = Manifest(entities=[plane], places=[], moments=[])
    cfg = Config(format="long")
    cfg.visuals.world_share_long = 1.0
    out = visualplan.fill(cfg, script(*lines), story, [])
    shots = [(r.subject_name, r.action, r.setting) for r in out]
    assert out and max(shots.count(k) for k in shots) <= visualplan.MAX_SAME_FILL
