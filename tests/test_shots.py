from fyt import llm, media, pipeline, wiki
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
    images = [wiki.WikiImage(f"File:{n}.jpg", f"https://x/{n}.jpg", f"https://c/{n}", "", "", "CC0") for n in "AB"]
    monkeypatch.setattr(wiki, "download_image", lambda im, dst: dst.write_bytes(b"jpg"))
    monkeypatch.setattr(wiki, "search_commons", lambda q: [wiki.WikiImage("File:C.jpg", "https://x/C.jpg", "https://c/C", "", "", "CC0")])
    monkeypatch.setattr(media, "fetch_photo", lambda cfg, q, public, name, used: Media(src=f"media/{name}.jpg", kind="image"))
    s = _script(
        {"narration": "a", "type": "title", "heading": "a"},
        {"narration": "b", "type": "stat", "value": 3, "heading": "h"},
        {"narration": "c", "type": "map", "places": [{"name": "x", "lat": 1, "lon": 2}]},
    )
    job = Job(tmp_path / "job")
    job.public.mkdir(parents=True)
    cfg = Config(format="short")
    scene_media = {0: Media(src="media/wiki1.jpg", kind="image"), 1: Media(src="media/commons2.jpg", kind="image")}
    credits = ["1.jpg (CC0): https://c/1"]
    # Scene 1 runs 6s (two cuts at 2.5s), scene 2 runs 9s (capped at two extra), the map draws its own.
    shots = pipeline.extra_shots(cfg, job, s, images, [(0, 6), (6, 15), (15, 20)], scene_media, credits, set(), "Flood")
    assert [m.src for m in shots[0]] == ["media/shot1-1.jpg"]  # a spare article image first
    assert [m.src for m in shots[1]] == ["media/shot2-1.jpg", "media/shot2-2.jpg"]  # then Commons, then stock
    assert 2 not in shots
    assert len(credits) == 3  # the article image and the Commons photo are credited; stock needs none

    cfg.growth.shot_seconds = 0
    assert pipeline.extra_shots(cfg, job, s, images, [(0, 6), (6, 15), (15, 20)], scene_media, [], set()) == {}
    assert pipeline.extra_shots(Config(format="long"), job, s, images, [(0, 6), (6, 15), (15, 20)], scene_media, [], set()) == {}


def test_shots_reach_the_renderer():
    s = _script({"narration": "a", "type": "statement", "text": "a"})
    props = build_props(Config(), s, [(0.0, 6.0)], [[]], {}, None, None, None, {0: [Media(src="media/x.jpg", kind="image")]})
    assert props.scenes[0].shots[0].src == "media/x.jpg"
    assert build_props(Config(), s, [(0.0, 6.0)], [[]], {}, None, None).scenes[0].shots is None


def test_a_long_short_is_tightened(monkeypatch, tmp_path):
    long = _script(*[{"narration": " ".join(["word"] * 30), "type": "statement", "text": "x"} for _ in range(5)])
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
