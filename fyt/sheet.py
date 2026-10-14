"""Contact sheets: a grid of a video's frames on one image, to check a render by eye.

Every frame is a pure function of time, so any frame can be drawn on its own and looked at. Use it
while building or changing a scene template: render, look at the sheet, fix what is wrong, repeat.

    python -m fyt sheet jobs/<id>/video.mp4             # frames from a finished video
    python -m fyt sheet jobs/<id>/props.json --every 0.5 # frames drawn straight from the props, no video
"""

from __future__ import annotations

import json
import subprocess
import tempfile
from pathlib import Path

import imageio_ffmpeg
from PIL import Image, ImageDraw

from fyt import render
from fyt.config import RENDERER_DIR

TILE_WIDTH = 480
COLUMNS = 4


def frame_times(duration: float, every: float, limit: int = 60) -> list[float]:
    """Evenly spaced times across the video, at most `limit` of them."""
    if duration <= 0:
        return [0.0]
    step = max(every, duration / limit)
    times, t = [], 0.0
    while t < duration - 1e-6:
        times.append(round(t, 3))
        t += step
    return times


def from_video(video: Path, times: list[float], into: Path) -> list[tuple[float, Path]]:
    out = []
    for i, t in enumerate(times):
        f = into / f"f{i:04}.png"
        subprocess.run(
            [imageio_ffmpeg.get_ffmpeg_exe(), "-loglevel", "error", "-y", "-ss", str(t), "-i", str(video),
             "-frames:v", "1", "-vf", f"scale={TILE_WIDTH}:-1", str(f)],
            check=True,
        )
        if f.exists():
            out.append((t, f))
    return out


def from_props(props: Path, public: Path, times: list[float], into: Path) -> list[tuple[float, Path]]:
    fps = json.loads(props.read_text()).get("fps", 30)
    frames = sorted({round(t * fps) for t in times})
    render.ensure_renderer()
    subprocess.run(
        ["node", "render.mjs", "--props", str(props.resolve()), "--public", str(public.resolve()), "--out", str(into.resolve()),
         "--frames", ",".join(map(str, frames))],
        cwd=RENDERER_DIR, check=True, env=render._env(),
    )
    return [(f / fps, into / f"frame-{f:05}.png") for f in frames]


def tile(shots: list[tuple[float, Path]], out: Path) -> Path:
    """Lay the frames out in a grid, each stamped with its time."""
    images = []
    for t, f in shots:
        im = Image.open(f).convert("RGB")
        im = im.resize((TILE_WIDTH, round(im.height * TILE_WIDTH / im.width)))
        d = ImageDraw.Draw(im)
        label = f"{int(t // 60)}:{t % 60:05.2f}"
        d.rectangle((0, 0, 8 + 9 * len(label), 22), fill=(0, 0, 0))
        d.text((5, 5), label, fill=(255, 255, 255))
        images.append(im)
    if not images:
        raise RuntimeError("no frames to put on the sheet")
    w, h = images[0].size
    rows = -(-len(images) // COLUMNS)
    sheet = Image.new("RGB", (w * COLUMNS + 4 * (COLUMNS - 1), h * rows + 4 * (rows - 1)), (40, 40, 40))
    for i, im in enumerate(images):
        sheet.paste(im, ((i % COLUMNS) * (w + 4), (i // COLUMNS) * (h + 4)))
    sheet.save(out)
    return out


def contact_sheet(source: Path, out: Path | None = None, every: float = 1.0, public: Path | None = None) -> Path:
    from fyt.qa import media_duration

    out = out or source.with_name(source.stem + "-sheet.png")
    with tempfile.TemporaryDirectory() as tmp:
        if source.suffix == ".json":
            duration = float(json.loads(source.read_text())["duration"])
            shots = from_props(source, public or source.parent / "public", frame_times(duration, every), Path(tmp))
        else:
            duration = media_duration(source) or 0.0
            shots = from_video(source, frame_times(duration, every), Path(tmp))
        return tile(shots, out)
