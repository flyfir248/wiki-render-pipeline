"""Depth for the storyboard's pictures, so the camera can move through a painting like a 3D shot.

Each illustration gets a depth map from Depth Anything V2 (small, ONNX, on the CPU in about a second):
white is near, black far. The renderer (renderer/src/scenes/depthshot.tsx) shifts every pixel by its
depth as the camera moves, so the foreground slides past the background, the way the "3D photo" shots
of documentary channels do. The nearest part of the picture is also where a cut-in crops to.

The model is fetched once per run from Hugging Face (about 100 MB; HF_TOKEN is used when set). Without
it, pictures get no depth and keep the flat camera move: a wrong depth warps a picture, no depth never does.
"""

from __future__ import annotations

import os
from pathlib import Path

import numpy as np
import requests
from PIL import Image, ImageFilter

from fyt.config import ROOT, secret

MODEL_URL = "https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/main/onnx/model.onnx"
MODEL = ROOT / "assets" / "depth" / "depth-anything-v2-small.onnx"
SIDE = 518  # the model's training size; both sides must be multiples of its 14 px patch
MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)
NEAR = 0.12  # the nearest share of a picture: what a cut-in frames

_session = None
_failed = False


def _fetch(log=print) -> Path | None:
    if MODEL.is_file() and MODEL.stat().st_size > 10_000_000:
        return MODEL
    MODEL.parent.mkdir(parents=True, exist_ok=True)
    headers = {"Authorization": f"Bearer {secret('HF_TOKEN')}"} if secret("HF_TOKEN") else {}
    tmp = MODEL.with_suffix(".part")
    try:
        with requests.get(MODEL_URL, headers=headers, stream=True, timeout=60) as r:
            r.raise_for_status()
            with open(tmp, "wb") as f:
                for chunk in r.iter_content(1 << 20):
                    f.write(chunk)
        os.replace(tmp, MODEL)
        return MODEL
    except Exception as e:
        log(f"depth: no model ({str(e)[:120]}); pictures keep the flat camera move")
        tmp.unlink(missing_ok=True)
        return None


def session(log=print):
    """The depth model, loaded once; None when it can't be had (then nothing gets depth)."""
    global _session, _failed
    if _session is None and not _failed:
        path = _fetch(log)
        try:
            import onnxruntime as ort

            _session = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"]) if path else None
        except Exception as e:
            log(f"depth: model would not load ({str(e)[:120]})")
            _session = None
        _failed = _session is None
    return _session


def _size(w: int, h: int) -> tuple[int, int]:
    """The model's input size for a w x h picture: its long side at SIDE, both sides multiples of 14."""
    scale = SIDE / max(w, h)
    return max(14, round(w * scale / 14) * 14), max(14, round(h * scale / 14) * 14)


def estimate(img: Image.Image, sess) -> np.ndarray:
    """Relative depth, 0 (far) to 1 (near), at the picture's own size."""
    w, h = _size(*img.size)
    x = (np.asarray(img.convert("RGB").resize((w, h), Image.BICUBIC), dtype=np.float32) / 255.0 - MEAN) / STD
    x = x.transpose(2, 0, 1)[None].astype(np.float32)
    name = sess.get_inputs()[0].name
    d = np.asarray(sess.run(None, {name: x})[0], dtype=np.float32).reshape(h, w)  # larger is nearer
    lo, hi = np.percentile(d, 2), np.percentile(d, 98)
    d = np.clip((d - lo) / max(1e-6, hi - lo), 0, 1)
    return np.asarray(Image.fromarray((d * 255).astype(np.uint8)).resize(img.size, Image.BICUBIC), dtype=np.float32) / 255.0


def to_png(d: np.ndarray, path: Path) -> None:
    """The depth map as the renderer reads it. Near regions are grown a few pixels first, so an object's
    edge moves with the object and not with what is behind it, then softened so nothing tears."""
    im = Image.fromarray((np.clip(d, 0, 1) * 255).astype(np.uint8), "L")
    im = im.resize((max(1, im.width // 2), max(1, im.height // 2)), Image.BILINEAR)
    im = im.filter(ImageFilter.MaxFilter(5)).filter(ImageFilter.GaussianBlur(2))
    im.save(path)


def focus(d: np.ndarray) -> tuple[float, float]:
    """Where the nearest part of the picture is, as fractions of its width and height."""
    cut = np.quantile(d, 1 - NEAR)
    ys, xs = np.nonzero(d >= cut)
    if not len(xs):
        return 0.5, 0.5
    return round(float(xs.mean()) / d.shape[1], 3), round(float(ys.mean()) / d.shape[0], 3)


def add(public: Path, srcs: list[str], log=print) -> dict[str, dict]:
    """Depth maps next to the pictures (art/beat-1-2.jpg gets art/beat-1-2.depth.png): {src: {"depth": path,
    "focus": [x, y]}} for those that got one."""
    if not srcs or session(log) is None:
        return {}
    out = {}
    for src in srcs:
        try:
            img = Image.open(public / src)
            d = estimate(img, _session)
            name = str(Path(src).with_suffix("")) + ".depth.png"
            to_png(d, public / name)
            out[src] = {"depth": name, "focus": list(focus(d))}
        except Exception as e:  # that picture keeps its flat move
            log(f"depth: none for {src} ({str(e)[:100]})")
    log(f"depth: {len(out)} of {len(srcs)} pictures can be moved through in 3D")
    return out
