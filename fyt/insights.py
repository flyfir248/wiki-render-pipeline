"""What the channel's own viewers respond to, read from YouTube Analytics retention curves.

Each uploaded video's scenes are kept in state.db (Uploads.outlines). For every video with enough
views, the curve of how many viewers are still watching is split at the scene boundaries, and each
scene is scored by how fast it lost viewers compared with the rest of its video. Averaged over many
videos, that says which scene types hold attention and which lose it, plus how well the openings of
Shorts keep people from swiping away. The summary goes into the script writer's instructions.
"""

from __future__ import annotations

import json
import re
import statistics
from collections import defaultdict
from datetime import datetime, timedelta, timezone

from fyt import youtube
from fyt.config import Config
from fyt.store import Uploads

MIN_VIEWS = 50  # a curve from fewer views is mostly noise
MIN_SCENES = 5  # a scene type needs this many scored scenes before it counts
MAX_VIDEOS = 40  # most recent videos read per run (one Analytics query each)
CACHE_HOURS = 20  # curves are re-read at most about once a day

_lessons: dict[str, str] = {}


def _at(curve: list[tuple[float, float]], x: float) -> float:
    """The curve's value at elapsed fraction x, interpolated."""
    if not curve:
        return 0.0
    if x <= curve[0][0]:
        return curve[0][1]
    for (x0, y0), (x1, y1) in zip(curve, curve[1:]):
        if x0 <= x <= x1:
            return y0 + (y1 - y0) * ((x - x0) / (x1 - x0) if x1 > x0 else 0)
    return curve[-1][1]


def scene_losses(outline: dict, curve: list[tuple[float, float]]) -> list[tuple[str, float]]:
    """(scene type, relative loss) per scene: the share of viewers the scene lost per second,
    divided by the video's average. 1 is typical, 0.5 held twice as well, 2 lost twice as fast.
    The first scene is skipped; the opening is judged separately."""
    duration = outline["duration"]
    scenes = outline["scenes"]
    if not curve or duration <= 0 or len(scenes) < 3:
        return []
    start, end = _at(curve, scenes[1][1] / duration), _at(curve, min(1.0, scenes[-1][2] / duration))
    span = max(1.0, scenes[-1][2] - scenes[1][1])
    average = max(1e-4, (start - end) / span)  # share lost per second over the video
    out = []
    for kind, s, e in scenes[1:]:
        if e - s < 1.5:
            continue
        lost = _at(curve, s / duration) - _at(curve, min(1.0, e / duration))
        out.append((kind, max(0.0, lost / (e - s)) / average))
    return out


def opening_hold(outline: dict, curve: list[tuple[float, float]], seconds: float = 3.0) -> float | None:
    """Share of viewers still there a few seconds in (for Shorts, the swipe-away test).

    YouTube's curve is a watch ratio, not a head count: a Short that loops is watched more than once,
    so the curve can start above 1 and a raw reading said "122% still watching". Measured against the
    curve's own start, it is the share of the opening audience that stays, at most 100%."""
    if not curve or outline["duration"] <= seconds:
        return None
    first = curve[0][1]
    if first <= 0:
        return None
    return min(1.0, _at(curve, seconds / outline["duration"]) / first)


def _curves(uploads: Uploads, video_ids: list[str]) -> dict[str, list[tuple[float, float]]]:
    stamp = uploads.note("curves_read")
    cached = json.loads(uploads.note("curves") or "{}")
    fresh = stamp and (datetime.now(timezone.utc) - datetime.fromisoformat(stamp)).total_seconds() < CACHE_HOURS * 3600
    if fresh:
        return {v: [tuple(p) for p in cached[v]] for v in video_ids if v in cached}
    views = youtube.retention(video_ids)
    curves = {}
    for vid in video_ids:
        if views.get(vid, {}).get("views", 0) < MIN_VIEWS:
            continue
        try:
            curves[vid] = youtube.retention_curve(vid)
        except Exception as e:  # one bad video shouldn't stop the rest
            print(f"warning: no retention curve for {vid}: {e}")
    uploads.set_note("curves", json.dumps(curves))
    uploads.set_note("curves_read", datetime.now(timezone.utc).isoformat(timespec="seconds"))
    return curves


def summarise(outlines: dict[str, dict], curves: dict[str, list[tuple[float, float]]], fmt: str) -> str:
    by_type: dict[str, list[float]] = defaultdict(list)
    holds = []
    for vid, curve in curves.items():
        outline = outlines.get(vid)
        if not outline or outline.get("format") not in (fmt, None):
            continue
        for kind, loss in scene_losses(outline, curve):
            by_type[kind].append(loss)
        hold = opening_hold(outline, curve)
        if hold is not None:
            holds.append(hold)
    rated = sorted((sum(v) / len(v), k, len(v)) for k, v in by_type.items() if len(v) >= MIN_SCENES)
    lines = []
    if len(rated) >= 2:
        describe = lambda r: f"{r[1]} (lost viewers {abs(1 - r[0]) * 100:.0f}% {'slower' if r[0] < 1 else 'faster'} than average, {r[2]} scenes)"  # noqa: E731
        good = [describe(r) for r in rated if r[0] < 0.9]
        bad = [describe(r) for r in rated if r[0] > 1.1]
        if good:
            lines.append("Scene types that held viewers best (use them more): " + "; ".join(good) + ".")
        if bad:
            lines.append("Scene types that lost viewers fastest (use them less, or keep them short): " + "; ".join(bad) + ".")
    if fmt == "short" and len(holds) >= 5:
        lines.append(
            f"On average {sum(holds) / len(holds) * 100:.0f}% of viewers are still watching 3 seconds in. "
            "The opening line decides this: start on the most surprising concrete detail."
        )
    return "\n".join(lines)


def scene_lessons(cfg: Config) -> str:
    """Lessons for the script writer from the channel's watch-time curves, or "" without enough data
    or without Analytics access."""
    key = f"{cfg.jobs_path}:{cfg.format}"
    if key in _lessons:
        return _lessons[key]
    _lessons[key] = ""
    try:
        if not youtube.authorised() or not youtube.can_analyze():
            return ""
        uploads = Uploads(cfg)
        outlines = uploads.outlines()
        recent = [v for v in uploads.video_ids() if v in outlines][-MAX_VIDEOS:]
        if recent:
            _lessons[key] = summarise(outlines, _curves(uploads, recent), cfg.format)
    except Exception as e:  # lessons are a nice-to-have
        print(f"warning: could not read watch-time curves: {e}")
    return _lessons[key]


# --- Timely vs evergreen topics ------------------------------------------------------

TIMELY_KINDS = {
    "short": "Scheduled Shorts (evergreen pick)",
    "long": "Scheduled long videos (evergreen pick)",
    "bonus-short": "Trending Shorts",
    "bonus-long": "Trending long videos",
    "bonus-news": "News explainers",
}
SPIKE = 2.0  # an article read this many times more than usual right before publishing was "in the news"
ARTICLE = re.compile(r'Based on the Wikipedia article "(.+?)"')


def spike_ratio(daily: list[int]) -> float | None:
    """How much more an article was read in the 3 days before publishing than its usual day
    (the median of the weeks before that). `daily` is oldest first and ends the day before publishing."""
    if len(daily) < 14:
        return None
    usual = statistics.median(daily[:-7]) or 1
    return sum(daily[-3:]) / 3 / usual


def _median(values: list[float]) -> float:
    return statistics.median(values) if values else 0.0


def _rank_corr(xs: list[float], ys: list[float]) -> float | None:
    """Spearman's rank correlation (no tie correction), or None for too few points."""
    if len(xs) < 6:
        return None
    rank = lambda v: {i: r for r, i in enumerate(sorted(range(len(v)), key=v.__getitem__))}  # noqa: E731
    rx, ry = rank(xs), rank(ys)
    n = len(xs)
    d2 = sum((rx[i] - ry[i]) ** 2 for i in range(n))
    return 1 - 6 * d2 / (n * (n * n - 1))


def compare_groups(rows: list[dict]) -> str:
    """Markdown tables comparing first-days views, watch share, subscribers and (when YouTube gives it)
    thumbnail click rate between groups of videos. rows: dicts with group, format, views, percent,
    gained and optionally ctr and spike."""
    lines = []
    for fmt in ("short", "long"):
        mine = [r for r in rows if r["format"] == fmt]
        if not mine:
            continue
        ctr = any(r.get("ctr") is not None for r in mine)
        lines += [
            f"\n**{'Shorts' if fmt == 'short' else 'Long videos'}**\n",
            "| Group | Videos | Median views | Mean views | Median % watched | Subs per 1k views |" + (" Median CTR |" if ctr else ""),
            "|---|---|---|---|---|---|" + ("---|" if ctr else ""),
        ]
        by: dict[str, list[dict]] = defaultdict(list)
        for r in mine:
            by[r["group"]].append(r)
            if r.get("spike") is not None:
                by["Any kind, article spiking (≥%.0fx usual readers)" % SPIKE if r["spike"] >= SPIKE else "Any kind, article not spiking"].append(r)
        for group, rs in sorted(by.items(), key=lambda kv: -_median([r["views"] for r in kv[1]])):
            views = sum(r["views"] for r in rs)
            row = (
                f"| {group} | {len(rs)} | {_median([r['views'] for r in rs]):.0f} | {views / len(rs):.0f} | "
                f"{_median([r['percent'] for r in rs]):.0f}% | {sum(r['gained'] for r in rs) / views * 1000 if views else 0:.1f} |"
            )
            if ctr:
                cs = [r["ctr"] for r in rs if r.get("ctr") is not None]
                row += f" {_median(cs):.1f}% |" if cs else " – |"
            lines.append(row)
        spiked = [r for r in mine if r.get("spike") is not None]
        corr = _rank_corr([r["spike"] for r in spiked], [r["views"] for r in spiked])
        if corr is not None:
            lines.append(
                f"\nRank correlation between how much the article was being read right before publishing and views: "
                f"{corr:+.2f} over {len(spiked)} videos (+1: the more topical, the more views; 0: no link)."
            )
    return "\n".join(lines)


def timeliness_report(cfg: Config, days: int = 7, limit: int = 200) -> str:
    """Whether topics that were in the news when they went out got more views than evergreen ones:
    each video's views in its first `days` days, grouped by how its topic was picked (the upload kind in
    state.db) and by whether its Wikipedia article was being read far more than usual right then."""
    from fyt import growth

    uploads = Uploads(cfg)
    kinds = dict(uploads.db.execute("select youtube_id, kind from uploads where youtube_id is not null and problem is null"))
    today = datetime.now(timezone.utc).date()
    yta = youtube._analytics()
    use_ctr = True
    rows, listing = [], []
    for v in youtube.recent_uploads(limit=limit):
        published = v["publish_at"] or v["uploaded"]
        if not published:
            continue
        start = datetime.fromisoformat(published.replace("Z", "+00:00")).date()
        if start + timedelta(days=days + 2) > today:  # Analytics runs about two days behind
            continue
        end = start + timedelta(days=days - 1)
        metrics = "views,averageViewPercentage,subscribersGained"
        query = dict(ids="channel==MINE", startDate=start.isoformat(), endDate=end.isoformat(), filters=f"video=={v['id']}")
        got = None
        if use_ctr:
            try:
                got = yta.reports().query(metrics=metrics + ",videoThumbnailImpressions,videoThumbnailImpressionsClickRate", **query).execute()
            except Exception as e:
                print(f"thumbnail click rate isn't available through the API ({str(e)[:120]}); comparing views only")
                use_ctr = False
        if got is None:
            got = yta.reports().query(metrics=metrics, **query).execute()
        values = (got.get("rows") or [[0, 0, 0, 0, None]])[0]
        row = {
            "id": v["id"],
            "title": v["title"],
            "format": "short" if 0 < v["seconds"] <= 180 else "long",
            "group": TIMELY_KINDS.get(kinds.get(v["id"], ""), "Earlier uploads (kind not recorded)"),
            "views": int(values[0]),
            "percent": float(values[1]),
            "gained": int(values[2]),
            "ctr": float(values[4]) if use_ctr and len(values) > 4 and values[4] is not None else None,
            "spike": None,
        }
        found = ARTICLE.search(v["description"] or "")
        if found:
            try:
                daily = growth.daily_pageviews(cfg, found.group(1), start - timedelta(days=60), start - timedelta(days=1))
                row["spike"] = spike_ratio(daily)
            except Exception as e:
                print(f"no Wikipedia readership for {found.group(1)}: {e}")
        rows.append(row)
        listing.append(
            f"| {row['title'][:60]} | {row['group']} | {row['views']} | {row['percent']:.0f}% | "
            + (f"{row['spike']:.1f}x" if row["spike"] is not None else "–")
            + " |"
        )
    if not rows:
        return f"No videos old enough to compare yet (each needs {days + 2} days since publishing)."
    return (
        f"### Timely vs evergreen topics: views in each video's first {days} days\n"
        + compare_groups(rows)
        + "\n\n<details><summary>Every video</summary>\n\n| Video | Group | Views | % watched | Article readers vs usual |\n|---|---|---|---|---|\n"
        + "\n".join(listing)
        + "\n\n</details>\n"
    )
