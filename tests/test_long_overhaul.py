"""Long videos: no repeated narration, nothing after the close, a picture behind every scene, stock and 3D
only when they show what the story says."""
import json

from fyt import assetlib, freeimages, llm, pipeline, relevance, wiki
from fyt.config import Config, LLMConfig
from fyt.manifest import Entity
from fyt.models import Chapter, ScriptScene
from fyt.store import Job


def scene(text: str, **kw) -> ScriptScene:
    return ScriptScene(narration=text, type="statement", **kw)


def test_a_scene_that_says_it_all_again_is_dropped_and_chapters_move():
    scenes = [
        scene("In 2003 the US Air Force tested the largest conventional bomb ever built."),
        scene("It weighed over twenty one thousand pounds and was pushed out of a cargo plane."),
        scene("The bomb weighed over twenty one thousand pounds and was pushed from a cargo plane."),
        scene("Engineers at Eglin had built it in just nine weeks."),
    ]
    chapters = [Chapter(title="Start", scene=0), Chapter(title="Build", scene=2)]
    kept, moved = llm.drop_repeats(scenes, chapters)
    assert [s.narration[:12] for s in kept] == ["In 2003 the ", "It weighed o", "Engineers at"]
    assert [(c.title, c.scene) for c in moved] == [("Start", 0), ("Build", 2)]


def test_a_repeated_sentence_is_cut_from_a_scene_that_also_says_something_new():
    scenes = [
        scene("The test took place at Eglin Air Force Base in Florida."),
        scene("The test took place at Eglin Air Force Base in Florida. A mushroom cloud rose twenty miles away. "
              "Locals heard it in their kitchens."),
    ]
    kept, _ = llm.drop_repeats(scenes)
    assert kept[1].narration == "A mushroom cloud rose twenty miles away. Locals heard it in their kitchens."


def test_more_scenes_for_the_last_chapter_go_before_the_subscribe_close(monkeypatch):
    close = scene("Subscribe for the next untold story.")
    asked = []

    def answer(cfg, system, user, schema, max_tokens=0):
        asked.append(user)
        return llm.ChapterScenes(scenes=[scene("A new detail.")])

    monkeypatch.setattr(llm, "_openai_structured", answer)
    out = llm._extend_chapter(Config(), "", "write", [scene("The end of the story."), close], 40, None)
    assert [s.narration for s in out] == ["The end of the story.", "A new detail.", close.narration]
    assert "Subscribe for the next" in asked[0] and "the ending stays last" in asked[0]


def test_each_chapter_is_shown_what_earlier_chapters_said(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "test")
    cfg = Config(format="long", target_minutes=3, long_min_minutes=0, llm=LLMConfig(provider="openai"))
    n = llm.chapter_count(cfg)
    words = int(llm.long_words(cfg) / n)
    asks = []

    def answer(cfg, system, user, schema, max_tokens=0):
        asks.append(user)
        if schema is llm.Outline:
            return llm.Outline(title="t", description="d", tags=[], thumbnail_text="x", thumbnail_kicker="y",
                               thumbnail_query="z", sources=[], chapters=[llm.ChapterPlan(heading=f"P{i}", angle="a") for i in range(n)])
        k = len(asks)
        return llm.ChapterScenes(scenes=[scene(f"Fact number {k} " + " ".join([f"w{k}x{j}" for j in range(words)]))])

    monkeypatch.setattr(llm, "_openai_structured", answer)
    llm.write_long_script(cfg, "MOAB", "notes", "guide")
    assert "<said>" not in asks[1] and "Fact number 2" in asks[2] and "must not repeat" in asks[2]


def test_a_strict_writer_never_hands_the_script_to_another_model(monkeypatch):
    seen = []

    def answer(cfg, system, user, schema, max_tokens=0):
        seen.append((cfg.llm.model, cfg.llm.fallback_models, cfg.llm.backup, cfg.llm.last_resort))
        raise llm.ClaudeError("out for the day")

    monkeypatch.setattr(llm, "_openai_structured", answer)
    cfg = Config(format="long", llm=LLMConfig(provider="openai", model="flash", fallback_models=["lite"], strict_writer=True))
    try:
        llm.write_long_script(cfg, "MOAB", "notes", "guide")
    except llm.ClaudeError:
        pass
    assert seen == [("flash", [], None, [])]


def test_a_cargo_plane_is_not_cast_as_a_cargo_crate():
    plane = Entity(id="p", name="a modified cargo plane", kind="light aircraft", search=["mc-130", "cargo aircraft", "airplane"],
                   look="", certain=True, scenes=[1])
    hit = assetlib.project_model(plane)
    assert hit is None or hit["key"] != "kit-crate"
    crate = Entity(id="c", name="a cargo crate", kind="object", search=["wooden crate"], look="", certain=True, scenes=[1])
    assert assetlib.project_model(crate)["key"] == "kit-crate"


def test_long_video_3d_nobody_could_check_goes_back_to_2d_unless_vetted(monkeypatch, tmp_path):
    from fyt.models import Script

    found = {"type": "world", "subject": "stage", "subject_name": "b", "model": {"level": "found", "checked": "vision"}}
    vetted = {"type": "world", "subject": "stage", "subject_name": "c", "model": {"level": "found", "checked": "vetted"}}
    s = Script(title="t", description="d", tags=[], thumbnail_text="x", thumbnail_kicker="y", thumbnail_query="z", sources=[],
               scenes=[ScriptScene(narration="a", **found), ScriptScene(narration="b", **vetted)])
    monkeypatch.setattr(relevance, "key_frames", lambda props, script, only=None: {0: 1, 1: 2})
    monkeypatch.setattr(relevance.render, "frames", lambda *a: [tmp_path / "f1.png", tmp_path / "f2.png"])
    bad = relevance.picture_gate(Config(), s, None, None, tmp_path / "p.json", tmp_path, tmp_path, log=lambda m: None, strict=True)
    assert list(bad) == [0]
    assert relevance.picture_gate(Config(), s, None, None, tmp_path / "p.json", tmp_path, tmp_path, log=lambda m: None) == {}


def test_long_video_stock_goes_in_only_when_a_checker_saw_it(monkeypatch, tmp_path):
    job = Job(tmp_path / "job")
    job.public.mkdir(parents=True)
    photo = job.public / "p1.jpg"
    photo.write_bytes(b"jpg")
    monkeypatch.setattr(pipeline.storyboard, "review", lambda *a, **k: None)
    s = scene("The bomb fell.")
    assert pipeline._photo_fits(Config(format="short"), job, photo, s, "MOAB", stock=True)
    assert pipeline._photo_fits(Config(format="long"), job, photo, s, "MOAB")  # an archive photo, filtered by subject
    assert not pipeline._photo_fits(Config(format="long"), job, photo, s, "MOAB", stock=True)
    clip = job.public / "s1.mp4"
    clip.write_bytes(b"mp4")
    assert not pipeline._photo_fits(Config(format="long"), job, clip, s, "MOAB", stock=True)


def test_long_video_scenes_reuse_photos_instead_of_empty_cards(tmp_path):
    from fyt.models import Media, Script

    images = [wiki.WikiImage("File:A.jpg", "u", "p", "MOAB on its trailer", "", "PD"),
              wiki.WikiImage("File:B.jpg", "u", "p", "MC-130 Hercules cargo plane", "", "PD")]
    s = Script(title="t", description="d", tags=[], thumbnail_text="x", thumbnail_kicker="y", thumbnail_query="z", sources=[],
               scenes=[scene("intro"), scene("x"), scene("The Hercules cargo plane took off."), scene("y"), scene("z")])
    media = {0: Media(src="media/wiki1.jpg", kind="image"), 4: Media(src="media/wiki2.jpg", kind="image")}
    job = Job(tmp_path / "job")
    job.public.mkdir(parents=True)
    pipeline.refill(job, s, images, media)
    assert media[2].src == "media/wiki2.jpg"  # the photo the scene names
    assert media[3].src == "media/wiki1.jpg"  # not the photo of the scenes either side
    assert 1 not in media  # its neighbours show the only two photos: better a card than the same photo twice


def test_photos_of_what_the_story_links_to(monkeypatch):
    article = wiki.Article("GBU-43/B MOAB", "u", "The MOAB was dropped from an MC-130 Hercules. The Hercules flew from Eglin.")
    calls = []

    def api(cfg, **params):
        calls.append(params)
        if params.get("generator") == "links":
            return {"query": {"pages": [
                {"title": "Lockheed MC-130", "pageimage": "MC-130H.jpg"},
                {"title": "Hercules", "pageimage": "C-130_Hercules.jpg"},
                {"title": "Belgium", "pageimage": "Flag.jpg"},  # never mentioned in the text
            ]}}
        return {"query": {"pages": [
            {"title": "File:C-130 Hercules.jpg", "imageinfo": [{"mime": "image/jpeg", "width": 1200, "height": 800, "url": "c", "descriptionurl": "d",
                                                               "extmetadata": {"ImageDescription": {"value": "A C-130 in flight"}}}]},
        ]}}

    monkeypatch.setattr(wiki, "_api", api)
    got = wiki.linked_images(Config(), article)
    assert [(im.description, im.source) for im in got] == [("Hercules: A C-130 in flight", "linked")]
    assert "File:Flag.jpg" not in calls[-1]["titles"]


def test_an_image_archive_that_keeps_failing_is_not_asked_again(monkeypatch):
    tries = []

    def slow(q, n):
        tries.append(q)
        raise TimeoutError("read timed out")

    monkeypatch.setitem(freeimages.SOURCES, "openverse", slow)
    cfg = Config()
    cfg.growth.image_sources = ["openverse"]
    for q in ("a", "b", "c", "d"):
        freeimages.search(cfg, q, log=lambda m: None)
    assert tries == ["a", "b"]


def test_gemini_and_nvidia_vision_models_check_pictures(monkeypatch):
    from fyt import storyboard
    from fyt.config import BackupLLM

    monkeypatch.setenv("GEMINI_API_KEY", "g")
    monkeypatch.setenv("NVIDIA_API_KEY", "n")
    monkeypatch.delenv("CLOUDFLARE_ACCOUNT_ID", raising=False)
    monkeypatch.delenv("HF_TOKEN", raising=False)
    monkeypatch.setattr(storyboard, "secret", lambda name: None)
    cfg = Config(llm=LLMConfig(
        provider="openai", base_url="https://generativelanguage.googleapis.com/v1beta/openai", api_key_env="GEMINI_API_KEY",
        model="gemini-3-flash", helper_models=["gemini-3-flash-lite"],
        backup=BackupLLM(base_url="https://integrate.api.nvidia.com/v1", api_key_env="NVIDIA_API_KEY",
                         models=["nvidia/nemotron-3.5-super-vl-120b-a12b", "newest:deepseek-v4-flash"])))
    assert [n for n, _ in storyboard._checkers(cfg)] == ["gemini-3-flash-lite", "gemini-3-flash", "nvidia/nemotron-3.5-super-vl-120b-a12b"]


def test_gemini_gets_room_to_think_and_a_cut_off_reply_gets_more(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "g")
    sent = []

    class R:
        status_code = 200
        headers = {}
        text = ""

        def __init__(self, content, finish):
            self._j = {"choices": [{"message": {"content": content}, "finish_reason": finish}]}

        def json(self):
            return self._j

    replies = [R('{"scenes": [{"narr', "length"), R(json.dumps({"scenes": [{"narration": "Done.", "type": "statement"}]}), "stop")]

    def post(url, headers, json, timeout):
        sent.append(dict(json))
        return replies.pop(0)

    monkeypatch.setattr(llm.requests, "post", post)
    cfg = Config(llm=LLMConfig(provider="openai", base_url="https://generativelanguage.googleapis.com/v1beta/openai",
                               api_key_env="GEMINI_API_KEY", model="gemini-3-flash"))
    got = llm._openai_structured_once(cfg, "gemini-3-flash", "s", "u", llm.ChapterScenes, 3000)
    assert got.scenes[0].narration == "Done."
    assert [b["max_tokens"] for b in sent] == [16000, 32000] and sent[0]["reasoning_effort"] == "low"
