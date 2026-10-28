"""Playlists: one per series and format, so a viewer who finishes a story finds the next one.

Long videos go in "<series>" and Shorts in "<series> Shorts": a Shorts playlist plays in the vertical
Shorts player, and a long playlist isn't interrupted by Shorts. Each playlist gets a description.
New uploads are filed when they go up (newest first); `organise` files everything else on the channel,
a few videos per run, so it never eats into the upload quota.
"""

from __future__ import annotations

from pydantic import BaseModel, Field

from fyt import llm, youtube
from fyt.config import Config
from fyt.store import Uploads

SHORT_MAX_SECONDS = 180  # YouTube treats vertical videos up to 3 minutes as Shorts
ABOUT = {
    "Weird History": "Strange but true stories from history, told in minutes.",
    "Strange Science": "Odd experiments, bizarre discoveries and the science behind them.",
    "Bizarre Places": "The world's strangest places, and how they got that way.",
    "Unbelievable People": "Real people who did things that are hard to believe.",
    "News Explained": "Calm, factual explainers on recent incidents: what happened, and why.",
}
# Each write (adding, removing, creating, describing) costs 50 quota units.
WRITES_PER_FILL = 8


def all_series(cfg: Config) -> list[str]:
    return [*cfg.growth.series, *([cfg.growth.news_series] if cfg.growth.news_series else [])]


def name_for(series: str, fmt: str) -> str:
    return f"{series} Shorts" if fmt == "short" else series


def about(cfg: Config, series: str, fmt: str) -> str:
    base = ABOUT.get(series, f"Every {series} video from {cfg.channel.name}.")
    more = "Short versions, under a minute each." if fmt == "short" else "The full stories, newest first."
    return f"{base} {more}"


def file_upload(cfg: Config, video_id: str, series: str) -> None:
    """File a new upload at the top of its series playlist for its format."""
    youtube.add_to_playlist(video_id, name_for(series, cfg.format), about(cfg, series, cfg.format))


class Filing(BaseModel):
    number: int
    series: str = Field(description="One of the listed series, exactly as written.")


class Filings(BaseModel):
    videos: list[Filing]


def classify(cfg: Config, videos: list[dict]) -> dict[str, str]:
    """video id -> series, for videos the channel never filed (asked of the model in batches)."""
    names = all_series(cfg)
    out: dict[str, str] = {}
    for i in range(0, len(videos), 40):
        batch = videos[i : i + 40]
        menu = "\n".join(f"{n}. {v['title']} | {v['description'][:150]!r}" for n, v in enumerate(batch, 1))
        answer = llm.structured(
            llm.helping(cfg),
            f"File each video of a YouTube channel under the series that fits it best: {', '.join(names)}. "
            f"Use {cfg.growth.news_series!r} only for explainers of a recent news incident.",
            menu,
            Filings,
            max_tokens=2000,
        )
        for f in answer.videos:
            if 1 <= f.number <= len(batch) and f.series in names:
                out[batch[f.number - 1]["id"]] = f.series
    return out


def organise(cfg: Config, max_writes: int = WRITES_PER_FILL) -> int:
    """File the channel's videos into the series playlists for their format, describe the playlists,
    and move Shorts out of the long playlists. Stops after `max_writes` changes; returns how many it made."""
    if not youtube.can_manage() or not all_series(cfg):
        return 0
    uploads = Uploads(cfg)
    videos = youtube.recent_uploads(limit=200)  # newest first
    existing = youtube.playlists()
    names = all_series(cfg)
    # What's already filed where, in either format's playlist of any series.
    contents: dict[str, dict[str, str]] = {}
    series_of: dict[str, str] = {}
    for s in names:
        for fmt in ("long", "short"):
            name = name_for(s, fmt)
            if name in existing:
                contents[name] = youtube.playlist_items(existing[name]["id"])
                for vid in contents[name]:
                    series_of.setdefault(vid, s)
    for v in videos:  # remembered from an earlier run, or written in the description
        known = uploads.note(f"series:{v['id']}")
        line = next((ln[8:].strip() for ln in v["description"].splitlines() if ln.startswith("Series: ")), "")
        if v["id"] not in series_of and (known or line) in names:
            series_of[v["id"]] = known or line
    unfiled = [v for v in videos if v["id"] not in series_of]
    if unfiled:
        try:
            found = classify(cfg, unfiled)
        except Exception as e:
            print(f"warning: could not sort videos into series: {e}")
            found = {}
        for vid, s in found.items():
            uploads.set_note(f"series:{vid}", s)
        series_of.update(found)

    writes = 0

    def playlist(name: str, s: str, fmt: str) -> str:
        nonlocal writes
        if name not in existing:
            existing[name] = {"id": youtube.create_playlist(name, about(cfg, s, fmt)), "description": about(cfg, s, fmt)}
            contents[name] = {}
            writes += 1
        elif not existing[name]["description"]:
            youtube.describe_playlist(existing[name]["id"], name, about(cfg, s, fmt))
            existing[name]["description"] = about(cfg, s, fmt)
            writes += 1
        return existing[name]["id"]

    # Newest first, each appended at the end: the playlist ends up newest to oldest.
    for v in videos:
        s = series_of.get(v["id"])
        if not s or writes >= max_writes:
            continue
        fmt = "short" if 0 < v["seconds"] <= SHORT_MAX_SECONDS else "long"
        target, other = name_for(s, fmt), name_for(s, "long" if fmt == "short" else "short")
        try:
            if v["id"] not in contents.get(target, {}):
                pid = playlist(target, s, fmt)
                youtube.add_playlist_item(pid, v["id"], top=False)
                contents[target][v["id"]] = ""
                writes += 1
            if v["id"] in contents.get(other, {}) and writes < max_writes:
                youtube.remove_playlist_item(contents[other].pop(v["id"]))
                writes += 1
        except Exception as e:  # quota or a deleted video: carry on next run
            print(f"warning: could not file https://youtu.be/{v['id']}: {e}")
            break
    for s in names:  # describe playlists that have no description yet
        for fmt in ("long", "short"):
            name = name_for(s, fmt)
            if name in existing and not existing[name]["description"] and writes < max_writes:
                playlist(name, s, fmt)
    return writes
