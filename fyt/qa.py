"""Automatic checks before anything is uploaded. Returns a list of problems."""

from __future__ import annotations

import re
import subprocess
from pathlib import Path

import imageio_ffmpeg
import numpy as np

from fyt.config import Config
from fyt.models import RenderProps, Script


def media_duration(path: Path) -> float | None:
    """Duration in seconds, parsed from ffmpeg's banner (no ffprobe in imageio-ffmpeg)."""
    proc = subprocess.run(
        [imageio_ffmpeg.get_ffmpeg_exe(), "-i", str(path)], capture_output=True, text=True, check=False
    )
    m = re.search(r"Duration: (\d+):(\d+):(\d+\.\d+)", proc.stderr)
    return int(m[1]) * 3600 + int(m[2]) * 60 + float(m[3]) if m else None


def check_script(cfg: Config, script: Script) -> list[str]:
    problems = []
    if not script.scenes:
        problems.append("script has no scenes")
    if len(script.title) > 100:
        problems.append(f"title is {len(script.title)} chars (YouTube max 100)")
    if len(script.description) > 5000:
        problems.append("description exceeds 5000 chars")
    if len(",".join(script.tags)) > 500:
        problems.append("tags exceed 500 chars in total")
    if "<" in script.title + script.description or ">" in script.title + script.description:
        problems.append("title/description contain '<' or '>', which YouTube rejects")
    for i, s in enumerate(script.scenes, 1):
        if not s.narration.strip():
            problems.append(f"scene {i} has no narration")
        if s.type == "bars" and not s.data:
            problems.append(f"scene {i} is a bar chart without data")
        if s.type == "list" and not s.items:
            problems.append(f"scene {i} is a list without items")
        if s.type == "quote" and not (s.text and s.author):
            problems.append(f"scene {i} is a quote without text/author")
        if s.type == "map" and not s.regions and not any(abs(p.lat) <= 80 and abs(p.lon) <= 180 for p in s.places or []):
            problems.append(f"scene {i} is a map without valid places or regions")
        if s.type == "process" and len(s.items or []) < 2:
            problems.append(f"scene {i} is a process diagram with fewer than 2 steps")
        if s.type == "document" and not s.text:
            problems.append(f"scene {i} is a document without text")
        if s.type == "story" and not s.actors:
            problems.append(f"scene {i} is a story scene with nothing on stage")
        if s.type == "dialogue" and not s.lines:
            problems.append(f"scene {i} is a transcript without lines")
        if s.type == "evidence" and len(s.items or []) < 2:
            problems.append(f"scene {i} is an evidence board with fewer than 2 clues")
        if s.type == "trend" and len(s.data or []) < 2:
            problems.append(f"scene {i} is a trend line with fewer than 2 points")
        if s.type == "scale" and len([d for d in s.data or [] if d.value > 0]) < 2:
            problems.append(f"scene {i} is a size comparison with fewer than 2 positive values")
        if s.type == "proportion" and not (s.value is not None and 0 < s.value <= 100):
            problems.append(f"scene {i} is a proportion without a share between 0 and 100")
        if s.type == "cycle" and len(s.items or []) < 3:
            problems.append(f"scene {i} is a cycle with fewer than 3 steps")
    return problems


def check_render(cfg: Config, props: RenderProps, video: Path, voiced: bool = True) -> list[str]:
    problems = []
    if not video.exists() or video.stat().st_size < 10_000:
        return ["rendered video is missing or empty"]
    dur = media_duration(video)
    if dur is None:
        problems.append("could not read rendered video duration")
    elif abs(dur - props.duration) > 1.0:
        problems.append(f"video is {dur:.1f}s but the timeline is {props.duration:.1f}s")
    if cfg.format == "short" and props.duration > 180:
        problems.append(f"short is {props.duration:.0f}s; Shorts must be 3 minutes or less")
    if cfg.format == "long" and props.duration < 0.5 * cfg.target_seconds:
        problems.append(f"video is {props.duration:.0f}s, far below the {cfg.target_seconds:.0f}s target")
    if voiced and props.voice is None:
        problems.append("no voice track")
    return problems


def static_spans(video: Path, min_seconds: float = 4.0, until: float | None = None, rate: float = 4.0) -> list[tuple[float, float]]:
    """Stretches where the picture barely changes for `min_seconds` or more: the places a viewer's
    eye has nothing new to follow. Samples small grey frames `rate` times a second up to `until`."""
    w, h = 64, 36
    cmd = [imageio_ffmpeg.get_ffmpeg_exe(), "-loglevel", "error", "-i", str(video)]
    if until:
        cmd += ["-t", f"{until:.2f}"]
    cmd += ["-vf", f"fps={rate},scale={w}:{h},format=gray", "-f", "rawvideo", "-"]
    raw = subprocess.run(cmd, capture_output=True, check=False).stdout
    frames = np.frombuffer(raw, dtype=np.uint8)[: len(raw) // (w * h) * w * h].reshape(-1, h, w).astype(np.float32)
    if len(frames) < 2:
        return []
    change = np.abs(np.diff(frames, axis=0)).mean(axis=(1, 2))  # mean grey-level change per step
    still = change < 0.6
    spans, start = [], None
    for i, s in enumerate(list(still) + [False]):
        if s and start is None:
            start = i
        elif not s and start is not None:
            if (i - start) / rate >= min_seconds:
                spans.append((round(start / rate, 1), round(i / rate, 1)))
            start = None
    return spans
