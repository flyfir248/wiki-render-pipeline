"""Turning viewers into subscribers: on-screen series badge and subscribe line, the long video's end
card, the subscribe link in descriptions, and subscribers gained fed back into topic and title choice."""

from fyt import pipeline, youtube
from fyt.cli import growth_report
from fyt.config import Config, GrowthConfig
from fyt.models import Script, ScriptScene, Word
from fyt.timeline import TAIL_SECONDS, build_props
from fyt.youtube import build_body


def script(series=None) -> Script:
    return Script(
        title="The town that moved",
        description="A whole town was moved two miles east.",
        tags=["history"],
        thumbnail_text="Moved",
        thumbnail_kicker="1900",
        thumbnail_query="town",
        sources=["https://en.wikipedia.org/wiki/Town"],
        scenes=[ScriptScene(type="statement", narration=f"Scene {i} words here.", text=f"Scene {i}") for i in range(3)],
        series=series,
    )


def cfg(fmt="short", **growth) -> Config:
    return Config(format=fmt, growth=GrowthConfig(**growth))


SPANS = [(0.0, 2.0), (2.0, 4.0), (4.0, 6.0)]
WORDS = [[Word(word="w", start=0.1, end=0.3)] for _ in SPANS]


def test_short_carries_the_series_badge_and_subscribe_line_without_getting_longer():
    c = cfg(subscribe_line="Subscribe for a strange true story every day", end_card_seconds=15)
    props = build_props(c, script("Weird History"), SPANS, WORDS, {}, None, None)
    assert props.badge == "Weird History"
    assert props.subscribe == "Subscribe for a strange true story every day"
    assert props.endCard == 0 and props.duration == 6.0 + TAIL_SECONDS  # a Short has no end card


def test_videos_vary_the_subscribe_line_and_keep_one_each(monkeypatch):
    lines = ["Subscribe for a strange true story every day", "Follow for more true stories", "One weird true story a day"]
    c = cfg(subscribe_line=lines[0], subscribe_lines=lines[1:])
    picked = {c.growth.subscribe_for(f"Story {i}") for i in range(30)}
    assert picked == set(lines)
    monkeypatch.setattr(youtube, "authorised", lambda: True)
    monkeypatch.setattr(youtube, "can_manage", lambda: True)
    monkeypatch.setattr(youtube, "channel_id", lambda: "UC123")
    s = script()
    on_screen = build_props(c, s, SPANS, WORDS, {}, None, None).subscribe
    assert f"{on_screen}: https://www.youtube.com" in build_body(c, s)["snippet"]["description"]


def test_long_video_holds_an_end_card_after_the_voice():
    props = build_props(cfg("long", end_card_seconds=15), script(), SPANS, WORDS, {}, None, None)
    assert props.endCard == 15
    assert props.duration == 6.0 + TAIL_SECONDS + 15
    assert props.scenes[-1].end == props.duration  # the last picture stays under the end card
    assert props.badge is None and props.subscribe is None


def test_badge_can_be_turned_off():
    props = build_props(cfg(series_badge=False), script("Weird History"), SPANS, WORDS, {}, None, None)
    assert props.badge is None


def test_description_gets_a_one_click_subscribe_link(monkeypatch):
    monkeypatch.setattr(youtube, "authorised", lambda: True)
    monkeypatch.setattr(youtube, "can_manage", lambda: True)
    monkeypatch.setattr(youtube, "channel_id", lambda: "UC123")
    c = cfg(subscribe_line="Subscribe for a strange true story every day")
    description = build_body(c, script())["snippet"]["description"]
    assert "Subscribe for a strange true story every day: https://www.youtube.com/channel/UC123?sub_confirmation=1" in description
    assert description.startswith("A whole town was moved")  # the story stays first


def test_no_subscribe_link_without_a_line_or_without_channel_access(monkeypatch):
    monkeypatch.setattr(youtube, "authorised", lambda: True)
    monkeypatch.setattr(youtube, "can_manage", lambda: False)
    assert "sub_confirmation" not in build_body(cfg(subscribe_line="Subscribe"), script())["snippet"]["description"]
    monkeypatch.setattr(youtube, "can_manage", lambda: True)
    monkeypatch.setattr(youtube, "channel_id", lambda: "UC123")
    assert "sub_confirmation" not in build_body(cfg(), script())["snippet"]["description"]


def test_performance_names_the_videos_that_won_subscribers(tmp_path, monkeypatch):
    from fyt.store import Uploads

    c = Config(jobs_dir=str(tmp_path))
    for v in "abc":
        Uploads(c).record("short", None, v, None)
    monkeypatch.setattr(youtube, "can_manage", lambda: True)
    monkeypatch.setattr(youtube, "can_analyze", lambda: True)
    views = {"a": 2000, "b": 400, "c": 50}
    monkeypatch.setattr(youtube, "stats", lambda ids: [{"id": v, "title": v.upper(), "views": views[v], "likes": 1} for v in sorted(ids)])
    monkeypatch.setattr(youtube, "retention", lambda ids: {})
    monkeypatch.setattr(youtube, "subscribers_gained", lambda ids: {"a": 2, "b": 4, "c": 3})
    pipeline._performance.clear()
    summary = pipeline.performance_summary(c)
    winners = summary.split("Won the most subscribers")[1]
    assert winners.index("- B:") < winners.index("- A:")  # 1% of viewers beats 0.1%
    assert "- C:" not in winners  # too few views to tell
    assert "2 new subscribers" in summary.split("Won the most")[0]


def test_subscriber_numbers_failing_leave_the_summary_alone(tmp_path, monkeypatch):
    from fyt.store import Uploads

    c = Config(jobs_dir=str(tmp_path))
    Uploads(c).record("short", None, "a", None)
    monkeypatch.setattr(youtube, "can_manage", lambda: True)
    monkeypatch.setattr(youtube, "can_analyze", lambda: True)
    monkeypatch.setattr(youtube, "stats", lambda ids: [{"id": "a", "title": "A", "views": 10, "likes": 1}])
    monkeypatch.setattr(youtube, "retention", lambda ids: {})
    monkeypatch.setattr(youtube, "subscribers_gained", lambda ids: (_ for _ in ()).throw(RuntimeError("no")))
    pipeline._performance.clear()
    assert pipeline.performance_summary(c) == "- A: 10 views, 1 likes"


def test_growth_report_shows_subscribers_per_thousand_views():
    report = growth_report([{"kind": "Shorts", "views": 12000, "gained": 6, "lost": 1}])
    assert "Shorts: 12000 views, +6 / -1 subscribers (0.5 per 1,000 views)" in report
