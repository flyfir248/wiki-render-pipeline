"""AI illustrations in the channel's house style: story scene plates and props, and storyboard pictures.

Each story scene gets a background plate (the place, empty) and a cut-out for each prop (drawn
alone on white, then the white is removed), so the renderer can still move, tilt and layer them.
The style is deliberately flat and non-photographic, with faceless people: nobody real is
depicted, and clearly stylised art falls outside YouTube's synthetic-content disclosure.

Providers (the first with keys set is used):
- Cloudflare Workers AI: CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN (free daily allowance). FLUX.2 [klein]
  draws at the video's own shape (a Short's pictures are tall, not squares in a band) and can take earlier
  pictures as references, so a recurring ship or person keeps its look; FLUX.1 schnell, square only, is
  the fallback when it refuses
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

# The channel's house style: an illustrated documentary look, shared by the storyboard pictures
# (fyt.storyboard) and the story scenes' plates and props. FLUX follows plain descriptive sentences
# better than lists of tags.
LOOK = (
    "painterly editorial illustration with confident ink linework and gouache texture on warm paper grain, "
    "a limited palette of deep navy, warm amber, cream and muted brick red, accurate period details"
)
SAFE = (
    "Any people are stylised figures with simplified features, never a real person's likeness. "
    "There is no text, lettering, sign, logo or watermark anywhere in the image. Nothing gory: no blood or wounds."
)
STYLE = f"Drawn as a {LOOK} for an animated documentary. {SAFE}"
SCENE_STYLE = (
    f"A full-frame {LOOK}, cinematic lighting with strong shadows, composed like a film still with the main "
    f"subject large in the centre, layered in depth: something in the foreground, the subject in the middle "
    f"ground, a distant background. {SAFE}"
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
STEPS = 8  # the most Cloudflare allows for FLUX.1 schnell: noticeably sharper than 4
KLEIN = "@cf/black-forest-labs/flux-2-klein-4b"
SCHNELL = "@cf/black-forest-labs/flux-1-schnell"
# The picture's shape by use: a Short's full-screen picture is tall, a long video's wide, a prop square.
SIZES = {"tall": (768, 1344), "wide": (1344, 768), "square": (1024, 1024)}
REF_SIDE = 448  # reference pictures must be under 512 px a side
# Cloudflare's free allowance is 10,000 neurons a day: about 60 tall FLUX.2 [klein] pictures (6 tiles
# at 26 neurons each), or 30 square FLUX.1 schnell ones at 8 steps. Three Shorts a day plus a few test
# renders fit when a Short draws at most this many (story scenes and storyboard).
ART_PER_SHORT = 14
# A long video is made on a day that also makes two Shorts, so it gets a modest share too; once the
# allowance runs out, everything still renders, with photos and graphics instead of pictures.
ART_PER_LONG = 16
_spent = False  # the free daily allowance ran out during this run


def out_of_allowance() -> bool:
    return _spent


def provider() -> str | None:
    if secret("CLOUDFLARE_ACCOUNT_ID") and secret("CLOUDFLARE_API_TOKEN"):
        return "cloudflare"
    if secret("TOGETHER_API_KEY"):
        return "together"
    return None


class Rejected(requests.RequestException):
    """The provider refused the request itself (bad key, bad input): retrying won't help."""


def _check(r: requests.Response) -> None:
    global _spent
    if r.ok:
        return
    detail = r.text[:300].replace("\n", " ")
    if "daily free allocation" in detail:  # resets at midnight UTC; asking again today only wastes time
        _spent = True
        raise Rejected(f"{r.status_code}: the free daily image allowance is used up")
    if 400 <= r.status_code < 500 and r.status_code != 429:
        raise Rejected(f"{r.status_code}: {detail}")
    raise requests.HTTPError(f"{r.status_code}: {detail}")


def _jpeg(path: Path) -> bytes:
    im = Image.open(path).convert("RGB")
    im.thumbnail((REF_SIDE, REF_SIDE))
    out = io.BytesIO()
    im.save(out, "JPEG", quality=88)
    return out.getvalue()


_klein_ok = True  # FLUX.2 [klein] answered (or hasn't been asked yet) in this run


def _cloudflare(prompt: str, shape: str, seed: int, refs: list[Path]) -> bytes:
    global _klein_ok
    base = f"https://api.cloudflare.com/client/v4/accounts/{secret('CLOUDFLARE_ACCOUNT_ID')}/ai/run/"
    auth = {"Authorization": f"Bearer {secret('CLOUDFLARE_API_TOKEN')}"}
    if _klein_ok:
        w, h = SIZES[shape]
        fields = {"prompt": (None, prompt), "width": (None, str(w)), "height": (None, str(h)), "seed": (None, str(seed))}
        for n, ref in enumerate(refs[:4]):
            fields[f"input_image_{n}"] = (f"ref{n}.jpg", _jpeg(ref), "image/jpeg")
        r = requests.post(base + KLEIN, headers=auth, files=fields, timeout=120)
        try:
            _check(r)
            return base64.b64decode(r.json()["result"]["image"])
        except (Rejected, KeyError, TypeError, ValueError) as e:
            if _spent:
                raise
            _klein_ok = False  # refused outright (not the allowance): the older model for the rest of the run
            print(f"FLUX.2 [klein] refused ({e}); drawing with FLUX.1 schnell, square")
    r = requests.post(base + SCHNELL, headers=auth, json={"prompt": prompt, "steps": STEPS}, timeout=120)  # takes only these two
    _check(r)
    return base64.b64decode(r.json()["result"]["image"])


def generate(prompt: str, vertical: bool = False, seed: int = 7, shape: str | None = None, refs: list[Path] | None = None) -> Image.Image:
    """One image from the configured provider: tall for a Short's full-screen picture (`vertical`), wide
    for a long video's, square for a prop (`shape="square"`). `refs` are earlier pictures whose subjects
    it should draw the same way (FLUX.2 [klein] only; others ignore them)."""
    which = provider()
    shape = shape or ("tall" if vertical else "wide")
    if which == "cloudflare" and _spent:
        raise RuntimeError("image generation failed: the free daily image allowance is used up")
    for attempt in range(3):
        try:
            if which == "cloudflare":
                data = _cloudflare(prompt, shape, seed, [r for r in refs or [] if Path(r).is_file()])
            elif which == "together":
                w, h = SIZES[shape]
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
    # Story scenes leave a few pictures of the video's budget for its storyboard.
    limit = ART_PER_SHORT - 4 if vertical else ART_PER_LONG - 4
    for i, scene in enumerate(script.scenes):
        if scene.type != "story" or made >= limit:
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
            if made >= limit:
                break
            thing = actor.look or actor.thing
            name = f"art/prop-{_key(thing)}.png"
            try:
                if not (public / name).exists():
                    cut_out(generate(f"{PROP.format(thing=re.sub(r'^(a|an|the|one) ', '', thing.strip(), flags=re.I))} {STYLE}", seed=23, shape="square")).save(public / name)
                    made += 1
                actor.src = name
            except Exception as e:
                log(f"warning: no art for {thing!r}: {e}")
    return made
