"""Render inspection for 3D scenes: how rich the place looks and how alive the animation is, measured
separately from the finished video's own pixels (numpy only, no vision model, no cost).

Environment richness (0-100), from three moments of the scene: how much of the frame carries detail
(edges), and how little of it is empty (tiles with no texture: a bare ground sheet, a blank sky band
taking the whole frame). A figure on a grey plane scores low; a marsh with reeds, pools, posts and hills
behind it scores high.

Animation quality (0-100), from the scene sampled at 8 frames a second: each step is split into the
camera's own move (the whole picture shifting, found by phase correlation) and what moves inside the
picture (people, vegetation, water, particles): the picture is cut into blocks and each block's shift
is followed through time. A camera move changes smoothly, parallax and all; acting changes direction. A scene where only the
camera drifts round a statue has camera motion and almost no local motion; a frozen frame has neither.
Cuts between setups are counted, and the longest run where nothing inside the picture moves is noted.
"""

from __future__ import annotations

import subprocess
from pathlib import Path

import imageio_ffmpeg
import numpy as np

FPS = 8
# a block acts at a step when its shift jumps by JUMP pixels against the steps either side; a step
# moves when at least MOVING of the blocks do
JUMP = 1.5
MOVING = 0.1
# the caption and title bands a Short lays over its picture, left out of what is measured (top, bottom)
BANDS = {"short": (0.16, 0.66), "long": (0.08, 0.86)}


def frames(video: Path, start: float, seconds: float, w: int, h: int, fps: float = FPS, limit: int = 64) -> np.ndarray:
    """Grey frames of a stretch of the video, w x h, at fps (at most `limit`)."""
    n = max(2, min(limit, int(seconds * fps)))
    raw = subprocess.run(
        [imageio_ffmpeg.get_ffmpeg_exe(), "-loglevel", "error", "-ss", f"{start:.3f}", "-t", f"{seconds:.3f}", "-i", str(video),
         "-vf", f"fps={n / max(seconds, 1e-3):.4f},scale={w}:{h},format=gray", "-frames:v", str(n), "-f", "rawvideo", "-"],
        capture_output=True, check=False,
    ).stdout
    k = len(raw) // (w * h)
    if k == 0:
        return np.zeros((0, h, w), np.float32)
    return np.frombuffer(raw[: k * w * h], dtype=np.uint8).reshape(k, h, w).astype(np.float32)


def richness(img: np.ndarray) -> dict:
    """How much detail one grey frame holds: edge density and the share of empty tiles."""
    gy, gx = np.gradient(img)
    mag = np.hypot(gx, gy)
    edges = float((mag > 6.0).mean())
    h, w = img.shape
    th, tw = max(1, h // 12), max(1, w // 6)
    tiles = img[: th * 12, : tw * 6].reshape(12, th, 6, tw).swapaxes(1, 2).reshape(72, -1)
    empty = float((tiles.std(axis=1) < 3.5).mean())
    score = 100 * min(1.0, 0.55 * min(1.0, edges / 0.22) + 0.45 * (1 - empty))
    return {"edges": round(edges, 3), "empty": round(empty, 3), "score": round(score, 1)}


def shift(a: np.ndarray, b: np.ndarray) -> tuple[int, int]:
    """The whole-picture shift from a to b, in pixels, by phase correlation."""
    win = np.outer(np.hanning(a.shape[0]), np.hanning(a.shape[1]))
    fa, fb = np.fft.fft2((a - a.mean()) * win), np.fft.fft2((b - b.mean()) * win)
    r = fb * np.conj(fa)
    r /= np.abs(r) + 1e-9
    c = np.abs(np.fft.ifft2(r))
    dy, dx = np.unravel_index(int(np.argmax(c)), c.shape)
    h, w = a.shape
    return (dy - h if dy > h // 2 else dy, dx - w if dx > w // 2 else dx)


def _flow(a: np.ndarray, b: np.ndarray, size: int = 40, reach: int = 6) -> np.ndarray:
    """Each block's shift from a to b on a fixed grid, (rows, cols, 2), by block matching with a
    sub-pixel fit of the best match; NaN where a block has too little texture to follow, or no clear
    best match."""
    h, w = a.shape
    rows, cols = (h - 2 * reach) // size, (w - 2 * reach) // size
    out = np.full((rows, cols, 2), np.nan)
    pad = np.pad(b, reach, mode="edge")
    for i in range(rows):
        for j in range(cols):
            y, x = reach + i * size, reach + j * size
            pa = a[y: y + size, x: x + size]
            if pa.std() < 8.0:
                continue
            cost = np.empty((2 * reach + 1, 2 * reach + 1))
            for dy in range(-reach, reach + 1):
                for dx in range(-reach, reach + 1):
                    pb = pad[y + reach + dy: y + reach + dy + size, x + reach + dx: x + reach + dx + size]
                    cost[dy + reach, dx + reach] = np.abs(pb - pa).mean()
            k = np.unravel_index(int(np.argmin(cost)), cost.shape)
            if cost[k] > 0.6 * np.median(cost):
                continue  # no clear match: an edge sliding along itself, or a change of picture
            sub = []
            for ax in (0, 1):
                c0 = k[ax]
                if 0 < c0 < 2 * reach:
                    lo = cost[(c0 - 1, k[1]) if ax == 0 else (k[0], c0 - 1)]
                    hi = cost[(c0 + 1, k[1]) if ax == 0 else (k[0], c0 + 1)]
                    mid = cost[k]
                    den = lo - 2 * mid + hi
                    sub.append(c0 - reach + (0.5 * (lo - hi) / den if den > 1e-6 else 0.0))
                else:
                    sub.append(float(c0 - reach))
            out[i, j] = (sub[1], sub[0])
    return out


def motion(seq: np.ndarray, fps: float = FPS) -> dict:
    """Camera motion, motion inside the picture, cuts and the longest still run of a frame sequence.

    A camera move changes smoothly from one step to the next (eased dollies, cranes, push-ins, the
    parallax they make included); something acting (a stride, a turning head, reeds in the wind) changes
    direction. So each block's shift is followed through time, and a block moves on its own at a step
    where its shift jumps against its neighbours in time (a second difference of JUMP pixels or more)."""
    if len(seq) < 3:
        return {"camera": 0.0, "local": 0.0, "moving": 0.0, "cuts": 0, "still_run": 0.0, "score": 0.0}
    cut = [float(np.abs(b - a).mean()) > 28 for a, b in zip(seq[:-1], seq[1:])]
    flows = [_flow(a, b) if not c else None for (a, b), c in zip(zip(seq[:-1], seq[1:]), cut)]
    cams = [float(np.nanmedian(np.hypot(f[..., 0], f[..., 1]))) if f is not None and np.isfinite(f).any() else 0.0 for f in flows]
    locs = []
    for k in range(1, len(flows) - 1):
        f0, f1, f2 = flows[k - 1], flows[k], flows[k + 1]
        if f0 is None or f1 is None or f2 is None:
            continue
        d = np.hypot(*np.moveaxis(f2 - 2 * f1 + f0, -1, 0))
        ok = np.isfinite(d)
        locs.append(float((d[ok] >= JUMP).mean()) if ok.any() else 0.0)
    moving = [x >= MOVING for x in locs]
    run = best = 0
    for mv in moving:
        run = 0 if mv else run + 1
        best = max(best, run)
    frac = sum(moving) / max(1, len(moving))
    cam = sum(1 for c in cams if c >= 0.5) / max(1, len(cams))
    still = best / fps
    span = len(seq) / fps
    score = 100 * min(1.0, 0.6 * frac + 0.25 * min(1.0, cam * 1.5) + 0.15 * (1 - min(1.0, still / max(1.0, span))))
    return {"camera": round(cam, 3), "local": round(float(np.mean(locs)) if locs else 0.0, 3), "moving": round(frac, 3), "cuts": sum(cut),
            "still_run": round(still, 2), "score": round(score, 1)}


def scene(video: Path, start: float, seconds: float, fmt: str = "short") -> dict:
    """Both measures for one 3D scene of a rendered video."""
    w, h = (180, 320) if fmt == "short" else (320, 180)
    top, bottom = BANDS.get(fmt, BANDS["long"])
    seq = frames(video, start + 0.1, max(0.5, seconds - 0.2), w, h)
    if not len(seq):
        return {}
    band = seq[:, int(h * top): int(h * bottom)]
    picks = []
    for k in (0.25, 0.5, 0.75):
        f = frames(video, start + seconds * k, 0.04, w * 2, h * 2, fps=25, limit=1)
        if len(f):
            picks.append(f[0])
    rich = [richness(p[int(p.shape[0] * top): int(p.shape[0] * bottom)]) for p in picks]
    env = {"score": round(float(np.mean([r["score"] for r in rich])), 1), "edges": round(float(np.mean([r["edges"] for r in rich])), 3),
           "empty": round(float(np.mean([r["empty"] for r in rich])), 3)} if rich else {}
    return {"environment": env, "animation": motion(band)}


# Below these a scene is flagged: the place reads as empty, or nothing in the picture moves.
RICH_MIN = 40.0
ANIM_MIN = 40.0


def flags(row: dict) -> list[str]:
    """What a measured scene falls short on."""
    out = []
    env, anim = row.get("environment_richness"), row.get("animation_quality")
    if env is not None and env < RICH_MIN:
        out.append("bare place")
    if anim is not None and anim < ANIM_MIN:
        out.append("little moves")
    return out
