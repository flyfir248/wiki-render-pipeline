"""Stock footage/photos from Pexels and background music from a local folder."""

from __future__ import annotations

import random
import shutil
import time
from pathlib import Path

import requests

from fyt.config import ROOT, Config, secret
from fyt.models import Media

PEXELS = "https://api.pexels.com"


def _get(path: str, params: dict) -> dict | None:
    key = secret("PEXELS_API_KEY")
    if not key:
        return None
    for attempt in range(3):  # ride out rate limits, server errors and dropped connections
        try:
            r = requests.get(f"{PEXELS}{path}", params=params, headers={"Authorization": key}, timeout=30)
        except requests.RequestException:
            if attempt == 2:
                raise
        else:
            if r.status_code != 429 and r.status_code < 500 or attempt == 2:
                r.raise_for_status()
                return r.json()
        time.sleep(5 * 2**attempt)
    return None


def _download(url: str, dst: Path) -> None:
    with requests.get(url, stream=True, timeout=120) as r:
        r.raise_for_status()
        with dst.open("wb") as f:
            for chunk in r.iter_content(1 << 16):
                f.write(chunk)


def _best_file(files: list[dict], vertical: bool) -> dict | None:
    """Pick an mp4 close to 1080p in the right orientation (smaller = faster render)."""
    target = 1920 if not vertical else 1080
    mp4s = [f for f in files if f.get("file_type") == "video/mp4" and f.get("width")]
    oriented = [f for f in mp4s if (f["height"] > f["width"]) == vertical] or mp4s
    return min(oriented, key=lambda f: abs(f["width"] - target), default=None)


def fetch_broll(cfg: Config, query: str, public: Path, name: str, used: set[str]) -> Media | None:
    """Download a stock clip (or photo fallback) for a scene. Returns None when unavailable."""
    if not cfg.stock_footage or not query:
        return None
    vertical = cfg.format == "short"
    orientation = "portrait" if vertical else "landscape"
    (public / "media").mkdir(parents=True, exist_ok=True)

    data = _get("/videos/search", {"query": query, "orientation": orientation, "per_page": 10, "size": "medium"})
    for video in (data or {}).get("videos", []):
        if str(video["id"]) in used or video.get("duration", 0) < 4:
            continue
        f = _best_file(video.get("video_files", []), vertical)
        if not f:
            continue
        rel = f"media/{name}.mp4"
        _download(f["link"], public / rel)
        used.add(str(video["id"]))
        return Media(src=rel, kind="video")
    return fetch_photo(cfg, query, public, name, used)


def fetch_photo(cfg: Config, query: str, public: Path, name: str, used: set[str]) -> Media | None:
    orientation = "portrait" if cfg.format == "short" else "landscape"
    data = _get("/v1/search", {"query": query, "orientation": orientation, "per_page": 10})
    for photo in (data or {}).get("photos", []):
        if f"p{photo['id']}" in used:
            continue
        rel = f"media/{name}.jpg"
        (public / "media").mkdir(parents=True, exist_ok=True)
        _download(photo["src"]["large2x"], public / rel)
        used.add(f"p{photo['id']}")
        return Media(src=rel, kind="image")
    return None


def pick_music(cfg: Config, public: Path, seconds: float = 60.0, seed: int | None = None) -> str | None:
    """Copy a random track from music_dir into the job (use only music you are licensed to use),
    or, with no tracks there, compose an original one (see fyt.music)."""
    folder = (ROOT / cfg.music_dir).resolve()
    tracks = [p for p in folder.glob("*") if p.suffix.lower() in {".mp3", ".wav", ".m4a", ".ogg"}]
    if not tracks:
        if not cfg.generate_music:
            return None
        from fyt import music

        music.write(public / "music.wav", seconds, energetic=cfg.format == "short", seed=seed)
        return "music.wav"
    track = random.choice(tracks)
    dst = public / f"music{track.suffix.lower()}"
    shutil.copy(track, dst)
    return dst.name
