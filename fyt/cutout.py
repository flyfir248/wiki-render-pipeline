"""Collage look for real photos (Vox style), made locally and free.

Each Wikipedia/Commons/stock photo gets two companions the renderer layers over each other:
- `<name>-bg.jpg`: the photo as a duotone halftone print on paper, in the channel's colours;
- `<name>-cut.png`: the main subject cut out (black and white, punchy contrast, a white sticker edge),
  on a transparent canvas the size of the photo, so it sits exactly over its place in the print and
  can lift off it.

The subject is found by ISNet (the "isnet-general-use" model from rembg, ~170 MB, downloaded once)
run on the CPU with onnxruntime, which the Kokoro voice already installs. No API, no cost. Photos
without a clear subject (landscapes, documents, crowds) get only the print.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import requests
from PIL import Image, ImageFilter, ImageOps

from fyt.config import ROOT, Config

MODEL_URL = "https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx"
MODEL_FILE = "isnet-general-use.onnx"
SIZE = 1024  # the model's input
_session = None


def _load(cfg: Config):
    """The ISNet model, loaded once per process and downloaded on first use."""
    global _session
    if _session is None:
        import onnxruntime as ort

        d = ROOT / cfg.collage.model_dir
        d.mkdir(parents=True, exist_ok=True)
        path = d / MODEL_FILE
        if not path.exists():
            print(f"downloading cut-out model {MODEL_FILE} ...", flush=True)
            tmp = path.with_suffix(".part")
            with requests.get(MODEL_URL, stream=True, timeout=60) as r:
                r.raise_for_status()
                with open(tmp, "wb") as f:
                    for chunk in r.iter_content(1 << 20):
                        f.write(chunk)
            tmp.rename(path)
        _session = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
    return _session


def subject_mask(cfg: Config, img: Image.Image) -> np.ndarray:
    """0..1 per pixel: how surely it belongs to the photo's main subject."""
    sess = _load(cfg)
    x = np.asarray(img.convert("RGB").resize((SIZE, SIZE), Image.LANCZOS), dtype=np.float32)
    x = x / max(float(x.max()), 1.0) - 0.5  # rembg's normalisation for ISNet: mean 0.5, std 1
    x = x.transpose(2, 0, 1)[None]
    out = sess.run(None, {sess.get_inputs()[0].name: x})[0][0, 0]
    out = (out - out.min()) / max(float(out.max() - out.min()), 1e-6)
    m = Image.fromarray((out * 255).astype(np.uint8)).resize(img.size, Image.LANCZOS)
    return np.asarray(m, dtype=np.float32) / 255


def has_subject(mask: np.ndarray) -> bool:
    """A cut-out only looks good when there is one clear thing in front: not too small or too big,
    mostly decided pixels, and not running off most of the frame's edges (that's scenery)."""
    fg = mask > 0.5
    share = fg.mean()
    unsure = ((mask > 0.15) & (mask < 0.85)).mean()
    edges = np.concatenate([fg[0], fg[-1], fg[:, 0], fg[:, -1]])
    return 0.06 <= share <= 0.7 and unsure < 0.08 and edges.mean() < 0.3


def _hex(c: str) -> np.ndarray:
    c = c.lstrip("#")
    return np.array([int(c[i : i + 2], 16) for i in (0, 2, 4)], dtype=np.float32)


def _paper(size: tuple[int, int], seed: int) -> np.ndarray:
    """Paper grain: soft blotches plus fine fibre noise, around 1.0."""
    rng = np.random.default_rng(seed)
    w, h = size
    coarse = Image.fromarray((rng.random((h // 24 + 1, w // 24 + 1)) * 255).astype(np.uint8)).resize(size, Image.BICUBIC)
    fine = rng.random((h, w))
    return 1 + (np.asarray(coarse, dtype=np.float32) / 255 - 0.5) * 0.08 + (fine - 0.5) * 0.06


def print_style(img: Image.Image, dark: str, light: str, cell: int = 7, seed: int = 0) -> Image.Image:
    """The photo as a duotone halftone print: ink dots sized by darkness, between two colours."""
    g = ImageOps.autocontrast(img.convert("L"), cutoff=2)
    lum = np.asarray(g, dtype=np.float32) / 255
    h, w = lum.shape
    # One dot per cell on a 45° screen, sized by the cell's average darkness.
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    u, v = (xx + yy) / np.sqrt(2), (xx - yy) / np.sqrt(2)
    cu, cv = np.floor(u / cell) * cell + cell / 2, np.floor(v / cell) * cell + cell / 2
    dist = np.hypot(u - cu, v - cv) / (cell * 0.72)
    blur = np.asarray(g.filter(ImageFilter.BoxBlur(cell / 2)), dtype=np.float32) / 255
    ink = np.clip((np.sqrt(1 - blur) - dist) * 3 + 0.5, 0, 1)
    # Keep a little of the continuous tone so faces and text stay readable under the dots.
    t = np.clip(0.65 * ink + 0.35 * (1 - lum), 0, 1)[..., None]
    out = _hex(light) * (1 - t) + _hex(dark) * t
    out *= _paper((w, h), seed)[..., None]
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))


def sticker(img: Image.Image, mask: np.ndarray, edge: int = 10) -> Image.Image:
    """The subject in punchy black and white with a white sticker border and a soft shadow,
    on a transparent canvas the size of the photo."""
    a = Image.fromarray((np.clip((mask - 0.35) / 0.3, 0, 1) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1))
    bw = ImageOps.autocontrast(img.convert("L"), cutoff=1)
    bw = Image.fromarray(np.clip((np.asarray(bw, dtype=np.float32) - 128) * 1.25 + 128, 0, 255).astype(np.uint8))
    border = a.filter(ImageFilter.MaxFilter(edge * 2 + 1)).filter(ImageFilter.GaussianBlur(1.2))
    shadow = border.filter(ImageFilter.GaussianBlur(edge * 1.6))
    canvas = Image.new("RGBA", img.size, (0, 0, 0, 0))
    dark = Image.new("RGBA", img.size, (0, 0, 0, 255))
    canvas.paste(dark, (edge // 2, edge), shadow.point(lambda p: int(p * 0.55)))
    canvas.paste(Image.new("RGBA", img.size, (255, 255, 255, 255)), (0, 0), border)
    canvas.paste(bw.convert("RGBA"), (0, 0), a)
    return canvas


def stylize(cfg: Config, public: Path, src: str, seed: int = 0) -> tuple[str, str | None, float]:
    """Make the print (and the cut-out, when the photo has a clear subject) for one photo in the
    job's public dir. Returns their paths relative to it, and the photo's width / height."""
    path = public / src
    img = ImageOps.exif_transpose(Image.open(path)).convert("RGB")
    img.thumbnail((1600, 1600))
    styled = f"{Path(src).with_suffix('')}-bg.jpg"
    print_style(img, cfg.theme.background, cfg.collage.paper, seed=seed).save(public / styled, quality=88)
    cut = None
    mask = subject_mask(cfg, img)
    if has_subject(mask):
        cut = f"{Path(src).with_suffix('')}-cut.png"
        sticker(img, mask, edge=max(6, round(min(img.size) / 90))).save(public / cut, optimize=True)
    return styled, cut, round(img.width / img.height, 4)
