from datetime import datetime, timezone

import pytest

from fyt import pipeline, wiki, youtube
from fyt.config import Config, LLMConfig
from fyt.store import Topics, Uploads

NOW = datetime(2026, 10, 29, 12, 0, tzinfo=timezone.utc)


@pytest.fixture
def cfg(tmp_path, monkeypatch):
    monkeypatch.setattr(youtube, "can_manage", lambda: True)
    c = Config(jobs_dir=str(tmp_path), format="long")
    c.growth.long_from_shorts = True
    return c


def short(cfg, topic, youtube_id, published="2026-10-22T14:00:00+00:00", kind="short"):
    topics = Topics(cfg)
    topics.add([topic])
    topics.set(topics.find(topic)[0], "done", f"job-{youtube_id}")
    Uploads(cfg).record(kind, f"job-{youtube_id}", youtube_id, published, at=published)


@pytest.fixture
def channel(monkeypatch):
    views = {}
    monkeypatch.setattr(youtube, "stats", lambda ids: [{"id": i, "title": i, "views": views[i], "likes": 0, "comments": 0} for i in ids])
    texts = {}
    monkeypatch.setattr(wiki, "fetch_article", lambda cfg, title: wiki.Article(title=title, url="", text=texts.get(title, "x" * 20000)))
    return views, texts


def test_the_long_video_retells_the_short_with_the_most_views(cfg, channel):
    views, _ = channel
    short(cfg, "wiki:MOAB", "a")
    short(cfg, "wiki:Trawler", "b")
    short(cfg, "wiki:Burger", "c")
    views.update(a=1125, b=1031, c=40)
    topics = Topics(cfg)
    assert pipeline.proven_topic(cfg, topics, NOW)[1] == "wiki:MOAB"
    # Each Short gets one long video: next week it's the next best.
    assert pipeline.proven_topic(cfg, topics, NOW)[1] == "wiki:Trawler"
    assert pipeline.proven_topic(cfg, topics, NOW) is None  # 40 views proves nothing


def test_only_settled_wiki_shorts_with_enough_material_count(cfg, channel):
    views, texts = channel
    short(cfg, "wiki:Too new", "new", published="2026-10-28T22:00:00+00:00")
    short(cfg, "cut:some-long-video-1", "cut")
    short(cfg, "news:An incident", "news")
    short(cfg, "wiki:Long one", "long", kind="long")
    short(cfg, "wiki:Thin", "thin")
    short(cfg, "wiki:Old", "old", published="2026-09-01T14:00:00+00:00")
    views.update(new=5000, cut=4000, news=3000, long=2000, thin=1500, old=9000)
    texts["Thin"] = "x" * 3000
    assert pipeline.proven_topic(cfg, Topics(cfg), NOW) is None


def test_off_or_without_stats_it_picks_a_fresh_article(cfg, channel, monkeypatch):
    views, _ = channel
    short(cfg, "wiki:MOAB", "a")
    views["a"] = 1125
    cfg.growth.long_from_shorts = False
    assert pipeline.proven_topic(cfg, Topics(cfg), NOW) is None
    cfg.growth.long_from_shorts = True
    monkeypatch.setattr(youtube, "can_manage", lambda: False)
    assert pipeline.proven_topic(cfg, Topics(cfg), NOW) is None


def test_long_videos_use_their_own_model_once_its_key_is_set(monkeypatch):
    cfg = Config(format="long", long_llm=LLMConfig(provider="anthropic", model="claude-sonnet-5-5"))
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    assert pipeline.for_format(cfg).llm == cfg.llm
    monkeypatch.setenv("ANTHROPIC_API_KEY", "k")
    assert pipeline.for_format(cfg).llm.model == "claude-sonnet-5-5"
    assert pipeline.for_format(cfg.model_copy(update={"format": "short"})).llm == cfg.llm


def test_a_long_video_that_didnt_get_made_is_tried_again_with_its_script(cfg, channel, monkeypatch):
    from fyt import growth
    from fyt.pipeline import load_script

    views, _ = channel
    short(cfg, "wiki:MOAB", "a")
    views["a"] = 1125
    topics = Topics(cfg)
    assert pipeline.long_topic(cfg, topics)[1] == "wiki:MOAB"
    script = load_script(pipeline.Path(__file__).resolve().parent.parent / "fixtures" / "demo_script_long.json")
    pipeline.save_long_script(cfg, "wiki:MOAB", script)
    pipeline.save_long_script(cfg, "wiki:Other", script)  # only the long video being made keeps its script
    # The run failed after the script was written: the next run takes the same topic and script back.
    monkeypatch.setattr(growth, "pick_topics", lambda *a, **k: pytest.fail("a fresh topic was picked"))
    assert pipeline.long_topic(cfg, topics)[1] == "wiki:MOAB"
    assert pipeline.saved_long_script(cfg, "wiki:MOAB").title == script.title
    assert pipeline.saved_long_script(cfg, "wiki:Other") is None
    assert pipeline.saved_long_script(cfg.model_copy(update={"format": "short"}), "wiki:MOAB") is None
    for _ in range(pipeline.LONG_TRIES - 2):
        assert pipeline.long_topic(cfg, topics)[1] == "wiki:MOAB"
    # After LONG_TRIES runs it is given up and a new topic is picked.
    monkeypatch.setattr(growth, "pick_topics", lambda *a, **k: ["Trawler"])
    assert pipeline.long_topic(cfg, topics)[1] == "wiki:Trawler"
    assert pipeline.saved_long_script(cfg, "wiki:MOAB") is None


def test_models_running_out_dont_burn_more_long_topics(cfg, monkeypatch):
    from fyt import llm

    tried = []
    monkeypatch.setattr(pipeline, "next_topic", lambda cfg, topics: (len(tried) + 1, f"wiki:T{len(tried)}"))

    def make(cfg, topic):
        tried.append(topic)
        raise llm.RateLimited("429: out of tokens for the day")

    monkeypatch.setattr(pipeline, "make_topic", make)
    assert pipeline.make_next(cfg, Topics(cfg)) is None
    assert tried == ["wiki:T0"]
    tried.clear()
    assert pipeline.make_next(cfg.model_copy(update={"format": "short"}), Topics(cfg)) is None
    assert len(tried) == 3  # a Short still tries other topics


def test_the_newest_listed_model_is_used(monkeypatch):
    from fyt import llm

    listed = ["models/gemini-2.5-flash", "models/gemini-3.1-flash", "models/gemini-3.1-flash-lite", "models/gemini-3.5-flash-preview-11-2026",
              "models/gemini-3.1-pro", "models/gemini-3.1-flash-image", "models/text-embedding-004"]

    class Resp:
        def raise_for_status(self):
            pass

        def json(self):
            return {"data": [{"id": i} for i in listed]}

    monkeypatch.setattr(llm.requests, "get", lambda url, headers, timeout: Resp())
    monkeypatch.setenv("GEMINI_API_KEY", "k")
    alt = LLMConfig(provider="openai", base_url="https://g/v1beta/openai", model="newest:flash", api_key_env="GEMINI_API_KEY",
                    fallback_models=["newest:flash-lite"], helper_models=["newest:flash-lite"])
    cfg = Config(format="long", long_llm=alt)
    used = pipeline.for_format(cfg).llm
    assert (used.model, used.fallback_models) == ("gemini-3.1-flash", ["gemini-3.1-flash-lite"])  # stable over preview
    assert used.helper_models == ["gemini-3.1-flash-lite"]
    assert llm.newest_model(alt, "gemini-2.5-flash") == "gemini-2.5-flash"  # a fixed name stays as written
    listed[:] = ["models/gemini-3.5-flash-preview-11-2026"]
    assert llm.newest_model(alt, "newest:flash") == "gemini-3.5-flash-preview-11-2026"  # a preview when that's all


def test_a_long_video_drops_a_few_unbacked_scenes_and_a_thumbnail_claim():
    from fyt.models import Chapter, Script, ScriptScene

    scenes = [ScriptScene(narration=f"line {i}.", type="statement", text="t") for i in range(1, 41)]
    long = Script(title="The heaviest bomb ever dropped", description="D", tags=["a"], thumbnail_text="BUILT IN 9 WEEKS",
                  thumbnail_kicker="K", thumbnail_query="q", scenes=scenes, sources=[],
                  chapters=[Chapter(title="One", scene=0), Chapter(title="Two", scene=20)])
    problems = ['scene 0: unsupported claim "BUILT IN 9 WEEKS"', 'scene 11: unsupported claim "nine weeks"',
                'scene 23: wrong claim "One bomb replaced a squadron." (source says: ...)']
    cut = pipeline.without_failed_scenes(long, problems)
    assert len(cut.scenes) == 38 and "line 11." not in [s.narration for s in cut.scenes]
    assert cut.thumbnail_text == "The heaviest bomb ever"
    assert [(c.title, c.scene) for c in cut.chapters] == [("One", 0), ("Two", 19)]
    assert cut.scenes[19].narration == "line 21."  # chapter two still starts where it did
    # A claim in the title itself, or in the opening scene, still stops the video; so does a Short losing three.
    assert pipeline.without_failed_scenes(long, ['scene 0: unsupported claim "heaviest bomb"']) is None
    assert pipeline.without_failed_scenes(long, ['scene 1: wrong claim "x"']) is None
    short = long.model_copy(update={"chapters": [], "scenes": scenes[:12]})
    assert pipeline.without_failed_scenes(short, ['scene 3: x', 'scene 4: x', 'scene 5: x']) is None


def test_made_up_choices_are_dropped_instead_of_costing_a_retry():
    import json

    from fyt import llm
    from fyt.llm import ChapterScenes

    reply = {"scenes": [{"narration": "The bomb fell.", "type": "story", "setting": "mountain",
                         "actors": [{"thing": "airplane", "action": "cruise"}]}]}
    try:
        ChapterScenes.model_validate(reply)
        raise AssertionError("expected the made-up values to fail")
    except llm.ValidationError as e:
        saved = llm._salvage(ChapterScenes, json.dumps(reply), e)
    assert saved.scenes[0].setting is None and saved.scenes[0].narration == "The bomb fell."
    assert saved.scenes[0].actors[0].thing == "airplane" and saved.scenes[0].actors[0].action == "none"
    # A missing narration can't be saved: that still asks again.
    bad = {"scenes": [{"type": "stat", "value": 3}]}
    try:
        ChapterScenes.model_validate(bad)
    except llm.ValidationError as e:
        assert llm._salvage(ChapterScenes, json.dumps(bad), e) is None


def test_backup_models_are_looked_up_by_name(monkeypatch):
    from fyt import llm
    from fyt.config import BackupLLM

    monkeypatch.setattr(llm, "_resolved", {})
    monkeypatch.setattr(llm, "newest_model", lambda b, m: {"newest:deepseek-v4-flash": "deepseek-ai/deepseek-v4-flash"}.get(m))
    b = BackupLLM(base_url="https://integrate.api.nvidia.com/v1", api_key_env="NVIDIA_API_KEY",
                  models=["newest:nemotron-9", "newest:deepseek-v4-flash", "fixed/model"])
    assert llm._models(b) == ["deepseek-ai/deepseek-v4-flash", "fixed/model"]
