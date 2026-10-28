import pytest

from fyt import llm, media, pipeline, qa, wiki
from fyt.config import Config
from fyt.models import Media, Script
from fyt.store import Job
from fyt.timeline import build_props


def _script(*scenes) -> Script:
    return Script.model_validate(
        {
            "title": "t", "description": "d", "tags": [], "thumbnail_text": "x", "thumbnail_kicker": "y",
            "thumbnail_query": "z", "sources": [], "scenes": list(scenes),
        }
    )


def test_long_scenes_in_a_short_get_extra_photos(monkeypatch, tmp_path):
    images = [wiki.WikiImage(f"File:{n}.jpg", f"https://x/{n}.jpg", f"https://c/{n}", d, "", "CC0") for n, d in (("A", "Mayor's portrait"), ("B", "Flooded harbour"))]
    monkeypatch.setattr(wiki, "download_image", lambda im, dst: dst.write_bytes(b"jpg"))
    monkeypatch.setattr(wiki, "search_commons", lambda q: [wiki.WikiImage("File:Flood C.jpg", "https://x/C.jpg", "https://c/C", "", "", "CC0")])
    monkeypatch.setattr(media, "fetch_photo", lambda cfg, q, public, name, used: Media(src=f"media/{name}.jpg", kind="image"))
    monkeypatch.setattr(pipeline.storyboard, "review", lambda *a, **k: None)
    s = _script(
        {"narration": "The water filled the harbour.", "type": "title", "heading": "a"},
        {"narration": "b", "type": "stat", "value": 3, "heading": "h", "broll_query": "flood street"},
        {"narration": "c", "type": "map", "places": [{"name": "x", "lat": 1, "lon": 2}]},
    )
    job = Job(tmp_path / "job")
    job.public.mkdir(parents=True)
    cfg = Config(format="short")
    scene_media = {0: Media(src="media/wiki1.jpg", kind="image"), 1: Media(src="media/commons2.jpg", kind="image")}
    credits = ["1.jpg (CC0): https://c/1"]
    # Scene 1 runs 6s (two cuts at 2.5s), scene 2 runs 9s (capped at two extra), the map draws its own.
    shots = pipeline.extra_shots(cfg, job, s, images, [(0, 6), (6, 15), (15, 20)], scene_media, credits, set(), "Flood")
    assert [m.src for m in shots[0]] == ["media/shot1-1.jpg"]  # the spare article image about the harbour
    assert [m.src for m in shots[1]] == ["media/shot2-1.jpg", "media/shot2-2.jpg"]  # then Commons, then stock
    assert 2 not in shots
    assert len(credits) == 3  # the article image and the Commons photo are credited; stock needs none

    cfg.growth.shot_seconds = 0
    assert pipeline.extra_shots(cfg, job, s, images, [(0, 6), (6, 15), (15, 20)], scene_media, [], set()) == {}
    # A long video cuts every 5 seconds: the 6-second scene keeps its one photo, the 15-second one gets two more.
    long = pipeline.extra_shots(Config(format="long"), job, s, images, [(0, 6), (6, 21), (21, 30)], scene_media, [], set(), "Flood")
    assert list(long) == [1] and len(long[1]) == 2


def test_long_video_chapters_open_on_a_card():
    from fyt.models import Chapter

    s = _script(*[{"narration": "a", "type": "statement", "text": "a"} for _ in range(4)])
    s = s.model_copy(update={"chapters": [Chapter(title="Cold open", scene=0), Chapter(title="The storm", scene=2)]})
    spans = [(0.0, 5.0), (5.0, 10.0), (10.0, 15.0), (15.0, 20.0)]
    props = build_props(Config(format="long"), s, spans, [[]] * 4, {}, None, None)
    assert [(sc.chapterNumber, sc.chapter) for sc in props.scenes] == [(None, None), (None, None), (2, "The storm"), (None, None)]
    assert all(sc.chapter is None for sc in build_props(Config(format="short"), s, spans, [[]] * 4, {}, None, None).scenes)


def test_shots_reach_the_renderer():
    s = _script({"narration": "a", "type": "statement", "text": "a"})
    props = build_props(Config(), s, [(0.0, 6.0)], [[]], {}, None, None, None, {0: [Media(src="media/x.jpg", kind="image")]})
    assert props.scenes[0].shots[0].src == "media/x.jpg"
    assert build_props(Config(), s, [(0.0, 6.0)], [[]], {}, None, None).scenes[0].shots is None


def test_a_long_short_is_tightened(monkeypatch, tmp_path):
    long = _script(*[{"narration": " ".join(["word"] * 35), "type": "statement", "text": "x"} for _ in range(5)])
    calls = []

    def tighten(cfg, script, words=None):
        calls.append(len(script.scenes))
        return script.model_copy(update={"scenes": [sc.model_copy(update={"narration": "short line"}) for sc in script.scenes]})

    monkeypatch.setattr(llm, "tighten", tighten)
    job = Job(tmp_path / "job")
    job.public.mkdir(parents=True)
    out = pipeline.keep_short(Config(format="short"), job, long)
    assert calls == [5] and pipeline.narration_words(out) == 10
    assert pipeline.keep_short(Config(format="long"), job, long) is long  # long videos are left alone
    ok = _script({"narration": "just right", "type": "statement", "text": "x"})
    assert pipeline.keep_short(Config(format="short"), job, ok) is ok


def test_tighten_never_aims_longer_than_the_script(monkeypatch):
    seen = {}

    def structured(cfg, guide, user, model, max_tokens=0):
        seen["guide"] = guide
        return llm.Tightened(narrations=["one two three"])

    monkeypatch.setattr(llm, "structured", structured)
    s = _script({"narration": " ".join(["word"] * 101), "type": "statement", "text": "x"})
    llm.tighten(Config(format="short"), s)
    assert "about 90 words" in seen["guide"]


def test_a_short_that_loses_the_thread_is_fixed(monkeypatch, tmp_path):
    s = _script(
        {"narration": "A baron found dwarf dinosaurs.", "type": "statement", "text": "x"},
        {"narration": "Then he flew.", "type": "statement", "text": "x"},
    )
    job = Job(tmp_path / "job")
    job.public.mkdir(parents=True)

    def lost(cfg, guide, user, model, max_tokens=0):
        assert "Scene 2 (statement): Then he flew." in user
        return llm.Mended(problems=["the flight comes from nowhere"], narrations=["A baron found dwarf dinosaurs.", "They lived on an island."])

    monkeypatch.setattr(llm, "structured", lost)
    out = pipeline.make_sense(Config(format="short"), job, s)
    assert out.scenes[1].narration == "They lived on an island."
    assert pipeline.make_sense(Config(format="long"), job, s) is s

    monkeypatch.setattr(llm, "structured", lambda *a, **k: llm.Mended(problems=[], narrations=["x"]))
    assert pipeline.make_sense(Config(format="short"), job, s) is s  # nothing wrong: left as written

    monkeypatch.setattr(llm, "structured", lambda *a, **k: llm.Mended(problems=["p"], narrations=["only one"]))
    assert pipeline.make_sense(Config(format="short"), job, s) is s  # a broken fix is ignored


def test_a_thin_short_is_written_again_with_context(monkeypatch, tmp_path):
    drafts = [" ".join(["word"] * 60), " ".join(["word"] * 120)]
    notes = []

    def write_script(cfg, topic, n, from_wikipedia=False, images="", feedback="", news=False, lessons=""):
        notes.append(feedback)
        return _script({"narration": drafts[len(notes) - 1], "type": "statement", "text": "x"})

    monkeypatch.setattr(llm, "write_script", write_script)
    monkeypatch.setattr(pipeline.insights, "scene_lessons", lambda cfg: "")
    job = Job(tmp_path / "job")
    job.public.mkdir(parents=True)
    out = pipeline._short_enough(Config(format="short"), job, "t", "n", True, "")
    assert pipeline.narration_words(out) == 120 and "only 60 words" in notes[1]


def test_a_sentence_that_says_again_what_an_earlier_one_said_is_found():
    s = _script(
        {"narration": "A small god rises from a lotus inside a jar.", "type": "statement", "text": "x"},
        {"narration": "The carving is four palms tall.", "type": "statement", "text": "x"},
        {"narration": "Inside the jar, the small god rises from the lotus.", "type": "statement", "text": "x"},
        {"narration": "So the snake is a god, not a cable.", "type": "statement", "text": "x"},
    )
    assert qa.repeats(s) == ['scene 3 repeats scene 1: "Inside the jar, the small god rises from the lotus."']
    figures = _script(
        {"narration": "At five percent, a hundred dollars becomes eleven hundred in fifty years.", "type": "statement", "text": "x"},
        {"narration": "Watch a thousand dollars at five percent.", "type": "statement", "text": "x"},
    )
    assert qa.repeats(figures) == []  # the same figures, saying something new
    loop = _script(
        {"narration": "A bear ate a duffel bag of cocaine.", "type": "statement", "text": "x"},
        {"narration": "Smugglers had dropped it over the Georgia woods.", "type": "statement", "text": "x"},
        {"narration": "Which is how a bear ate a duffel bag of cocaine.", "type": "statement", "text": "x"},
    )
    assert qa.repeats(loop) == []  # the last line may lead back into the hook


def test_a_short_the_story_editor_finds_not_worth_watching_is_not_made(monkeypatch, tmp_path):
    s = _script({"narration": "A god rises from a lotus.", "type": "statement", "text": "x"})
    job = Job(tmp_path / "job")
    job.public.mkdir(parents=True)
    monkeypatch.setattr(llm, "structured", lambda *a, **k: llm.Mended(problems=[], narrations=["x"], takeaway="", worth=2))
    with pytest.raises(RuntimeError, match="not worth watching"):
        pipeline.make_sense(Config(format="short"), job, s)
    assert job.meta["status"] == "qa_failed"

    monkeypatch.setattr(llm, "structured", lambda *a, **k: llm.Mended(
        problems=[], narrations=["x"], takeaway="The bulbs are a lotus and a snake god.", worth=7))
    assert pipeline.make_sense(Config(format="short"), job, s) is s


def test_a_short_too_thin_after_its_checks_is_not_made(tmp_path):
    job = Job(tmp_path / "job")
    job.public.mkdir(parents=True)
    thin = _script({"narration": " ".join(["word"] * 70), "type": "statement", "text": "x"})
    with pytest.raises(RuntimeError, match="only 70 words"):
        pipeline.has_substance(Config(format="short"), job, thin)
    full = _script(*[{"narration": f"Fact number {i} " + " ".join(f"w{i}x{k}" for k in range(20)), "type": "statement", "text": "x"} for i in range(6)])
    pipeline.has_substance(Config(format="short"), job, full)
    pipeline.has_substance(Config(format="long"), job, thin)  # long videos have their own length checks


def test_a_repetitive_short_is_written_again(monkeypatch, tmp_path):
    circling = [{"narration": "The golden statue rises from the sacred lotus inside the temple jar." + " filler" * 50, "type": "statement", "text": "x"},
                {"narration": "Inside the temple jar, the golden statue rises from the sacred lotus." + " filler" * 50, "type": "statement", "text": "x"}]
    fresh = [{"narration": line + " more" * 15, "type": "statement", "text": "x"} for line in (
        "Carvings in an Egyptian temple look like giant light bulbs.",
        "They sit in a crypt under the temple of Hathor at Dendera.",
        "Fringe writers claim they prove ancient electricity.",
        "But the hieroglyphs beside them describe a myth.",
        "The bulb is a lotus flower and the filament is a snake.",
        "The snake is a young god being born at sunrise.")]
    drafts = [circling, fresh]
    notes = []

    def write_script(cfg, topic, n, from_wikipedia=False, images="", feedback="", news=False, lessons=""):
        notes.append(feedback)
        return _script(*drafts[len(notes) - 1])

    monkeypatch.setattr(llm, "write_script", write_script)
    monkeypatch.setattr(pipeline.insights, "scene_lessons", lambda cfg: "")
    job = Job(tmp_path / "job")
    job.public.mkdir(parents=True)
    out = pipeline._short_enough(Config(format="short"), job, "t", "n", True, "")
    assert len(out.scenes) == 6 and "scene 2 repeats scene 1" in notes[1]
