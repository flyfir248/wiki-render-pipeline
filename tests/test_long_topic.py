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
    monkeypatch.setattr(youtube, "stats", lambda ids: [{"id": i, "title": i, "views": views[i]} for i in ids])
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
