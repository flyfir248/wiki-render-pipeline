"""AI illustrations for the 2D story scenes, all in one flat house style.

Each story scene gets a background plate (the place, empty) and a cut-out for each prop (drawn
alone on white, then the white is removed), so the renderer can still move, tilt and layer them.
The style is deliberately flat and non-photographic, with faceless people: nobody real is
depicted, and clearly stylised art falls outside YouTube's synthetic-content disclosure.

Providers (the first with keys set is used):
- Cloudflare Workers AI, FLUX.1 schnell: CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN (free daily allowance)
- Together AI, FLUX.1 schnell Free: TOGETHER_API_KEY
Without keys, story scenes use the bundled emoji-style props (fyt.illustrate).
"""

from __future__ import annotations

import base64
import hashlib
import io
import re
import time
from pathlib import Path

import numpy as np
import requests
from PIL import Image, ImageDraw, ImageFilter

from fyt.config import Config, secret
from fyt.models import Script

# FLUX follows plain descriptive sentences better than lists of tags.
STYLE = (
    "Drawn as a polished flat vector illustration for an animated science and history explainer: clean "
    "geometric shapes with crisp edges, smooth soft gradients, gentle rim light and a fine grain texture, "
    "rich but harmonious colours built on deep navy, teal, warm mustard yellow, coral and cream, with "
    "accurate period details. Any people are simple stylised figures with no facial features. "
    "There is no text, lettering, logo or watermark anywhere in the image."
)
PROP = (
    "A single {thing}, shown whole and centred in a three-quarter view with a clear, readable silhouette, "
    "isolated on a plain pure white background with no ground, shadow or other objects."
)
PLATE = (
    "A wide, detailed establishing view of {scene}, seen from eye level, with a distinct foreground, middle "
    "ground and distant background for depth. The lower half is open ground where characters could stand, "
    "and there are no people or vehicles in the scene."
)
THUMB = (
    "A bold, dramatic poster-like scene of {scene}. One clear subject, large and close in the frame, with strong "
    "contrast between a bright subject and a darker background, and a sense of tension or mystery."
)
STEPS = 8  # the most Cloudflare allows for FLUX.1 schnell: noticeably sharper than 4, still well inside the free allowance
MAX_IMAGES = 40  # per video: keeps a long video inside the free daily allowance


def provider() -> str | None:
    if secret("CLOUDFLARE_ACCOUNT_ID") and secret("CLOUDFLARE_API_TOKEN"):
        return "cloudflare"
    if secret("TOGETHER_API_KEY"):
        return "together"
    return None


class Rejected(requests.RequestException):
    """The provider refused the request itself (bad key, bad input): retrying won't help."""


def _check(r: requests.Response) -> None:
    if r.ok:
        return
    detail = r.text[:300].replace("\n", " ")
    if 400 <= r.status_code < 500 and r.status_code != 429:
        raise Rejected(f"{r.status_code}: {detail}")
    raise requests.HTTPError(f"{r.status_code}: {detail}")


def generate(prompt: str, vertical: bool = False, seed: int = 7) -> Image.Image:
    """One image from the configured provider."""
    which = provider()
    for attempt in range(3):
        try:
            if which == "cloudflare":
                url = (
                    f"https://api.cloudflare.com/client/v4/accounts/{secret('CLOUDFLARE_ACCOUNT_ID')}"
                    "/ai/run/@cf/black-forest-labs/flux-1-schnell"
                )
                r = requests.post(
                    url,
                    headers={"Authorization": f"Bearer {secret('CLOUDFLARE_API_TOKEN')}"},
                    json={"prompt": prompt, "steps": STEPS},  # the model takes only these two
                    timeout=120,
                )
                _check(r)
                data = base64.b64decode(r.json()["result"]["image"])
            elif which == "together":
                w, h = (768, 1344) if vertical else (1344, 768)
                r = requests.post(
                    "https://api.together.xyz/v1/images/generations",
                    headers={"Authorization": f"Bearer {secret('TOGETHER_API_KEY')}"},
                    json={"model": "black-forest-labs/FLUX.1-schnell-Free", "prompt": prompt, "width": w, "height": h,
                          "steps": 4, "seed": seed, "response_format": "b64_json"},
                    timeout=120,
                )
                _check(r)
                data = base64.b64decode(r.json()["data"][0]["b64_json"])
            else:
                raise RuntimeError("no image provider configured")
            return Image.open(io.BytesIO(data)).convert("RGB")
        except (requests.RequestException, KeyError) as e:
            if attempt == 2 or isinstance(e, Rejected):
                raise RuntimeError(f"image generation failed: {e}") from e
            time.sleep(4 * (attempt + 1))
    raise AssertionError("unreachable")


def cut_out(img: Image.Image, tolerance: int = 38) -> Image.Image:
    """Remove the plain background a prop was drawn on: flood-fill from the edges, then soften
    the edge and crop to the prop."""
    rgb = img.convert("RGB")
    w, h = rgb.size
    marker = (255, 0, 255)
    work = rgb.copy()
    step = max(1, min(w, h) // 16)
    for x in list(range(0, w, step)) + [w - 1]:
        for y in (0, h - 1):
            if work.getpixel((x, y)) != marker:
                ImageDraw.floodfill(work, (x, y), marker, thresh=tolerance)
    for y in range(0, h, step):
        for x in (0, w - 1):
            if work.getpixel((x, y)) != marker:
                ImageDraw.floodfill(work, (x, y), marker, thresh=tolerance)
    background = (np.asarray(work) == marker).all(axis=-1)
    mask = Image.fromarray(np.where(background, 0, 255).astype(np.uint8), "L")
    mask = mask.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(1.2))
    out = rgb.convert("RGBA")
    out.putalpha(mask)
    box = mask.point(lambda v: 255 if v > 20 else 0).getbbox()
    return out.crop(box) if box else out


def _key(*parts: str) -> str:
    return hashlib.sha1("|".join(parts).encode()).hexdigest()[:12]


def illustrate(cfg: Config, script: Script, public: Path, log=print) -> int:
    """Generate plates and cut-outs for the story scenes. Returns how many images were made.
    Anything that fails keeps its emoji-style fallback."""
    if not provider():
        return 0
    vertical = cfg.format == "short"
    (public / "art").mkdir(parents=True, exist_ok=True)
    made = 0
    for i, scene in enumerate(script.scenes):
        if scene.type != "story" or made >= MAX_IMAGES:
            continue
        place = scene.backdrop or (scene.setting or "open sky")
        name = f"art/plate-{_key(place, str(vertical))}.jpg"
        try:
            if not (public / name).exists():
                generate(f"{PLATE.format(scene=place)} {STYLE}", vertical, seed=11 + i).save(public / name, quality=90)
                made += 1
            scene.backdrop_src = name
        except Exception as e:
            log(f"warning: no background art for scene {i + 1}: {e}")
        for actor in scene.actors or []:
            if made >= MAX_IMAGES:
                break
            thing = actor.look or actor.thing
            name = f"art/prop-{_key(thing)}.png"
            try:
                if not (public / name).exists():
                    cut_out(generate(f"{PROP.format(thing=re.sub(r'^(a|an|the|one) ', '', thing.strip(), flags=re.I))} {STYLE}", seed=23)).save(public / name)
                    made += 1
                actor.src = name
            except Exception as e:
                log(f"warning: no art for {thing!r}: {e}")
    return made


def thumbnail_art(scene: str, public: Path) -> str:
    """Draw the thumbnail picture in the house style. Returns its path inside `public`."""
    name = f"art/thumb-{_key(scene)}.jpg"
    (public / "art").mkdir(parents=True, exist_ok=True)
    if not (public / name).exists():
        generate(f"{THUMB.format(scene=scene.strip().rstrip('.'))} {STYLE}", seed=5).save(public / name, quality=92)
    return name
