"""Thumbnails people click: a few takes on one video, the best of them chosen.

Each take puts one subject big in the frame with 2-4 words that add to the title:
- cutout: the subject's own photo, cut out in colour, over a dark blurred copy of that photo
- world: the story's 3D world at its key moment, rendered clean (no captions or labels)
- photo: the photo full-bleed under the words (the old look, kept as the safe last choice)

A vision model judges each take at phone size; the first one in that order that passes is used.
Without a vision model, the first take made is used. Every take is kept beside the video.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageEnhance, ImageFilter, ImageOps

from fyt import render, storyboard
from fyt.config import Config
from fyt.models import Media, RenderProps, ThumbnailProps

THUMB_REVIEW = """You judge a YouTube thumbnail as a viewer would see it: small, on a phone, among many others.
Pass it only if all of these hold: one clear subject that fills a good part of the frame and is easy to
recognise; the words are large, fully visible and readable; nothing important is cut off, covered by the
words or lost in a dark or washed-out area; it is not cluttered. It is an illustration or photo for a
documentary, so the style is fine. Fail it, naming the problem in a few words, if any of these fails."""


def _colour_cutout(img: Image.Image, mask: np.ndarray) -> Image.Image:
    """The subject in colour, a little punchier, with a soft light rim, on a transparent canvas."""
    alpha = Image.fromarray((np.clip((mask - 0.35) / 0.3, 0, 1) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1))
    pop = ImageOps.autocontrast(img, cutoff=1, preserve_tone=True)  # stretch brightness, keep the colours
    rim = alpha.filter(ImageFilter.MaxFilter(9)).filter(ImageFilter.GaussianBlur(6))
    canvas = Image.new("RGBA", img.size, (0, 0, 0, 0))
    canvas.paste(Image.new("RGBA", img.size, (255, 240, 200, 255)), (0, 0), rim.point(lambda p: int(p * 0.7)))
    canvas.paste(pop.convert("RGBA"), (0, 0), alpha)
    box = alpha.getbbox()
    return canvas.crop(box) if box else canvas


def _drawn(img: Image.Image, mask: np.ndarray) -> bool:
    """Whether the subject is a drawing (a diagram's flat fills) rather than a photograph: in a photo
    almost no neighbouring pixels are exactly equal."""
    a = np.asarray(img.convert("L"), dtype=np.int16)
    flat = (np.abs(np.diff(a, axis=1))[:-1, :] + np.abs(np.diff(a, axis=0))[:, :-1]) == 0
    inside = mask[:-1, :-1] > 0.5
    return bool(inside.any()) and float(flat[inside].mean()) > 0.45


def cutout_take(cfg: Config, public: Path, photo: Media) -> tuple[Media, Media] | None:
    """(background, subject) for the cut-out take, or None when the photo has no clear subject."""
    from fyt import cutout

    img = ImageOps.exif_transpose(Image.open(public / photo.src)).convert("RGB")
    img.thumbnail((1600, 1600))
    mask = cutout.subject_mask(cfg, img)
    if not cutout.has_subject(mask) or _drawn(img, mask):
        return None
    _colour_cutout(img, mask).save(public / "thumb-subject.png", optimize=True)
    back = img.filter(ImageFilter.GaussianBlur(max(8, img.width // 60)))
    back = Image.fromarray((np.asarray(back, dtype=np.float32) * 0.45).astype(np.uint8))
    back.save(public / "thumb-back.jpg", quality=88)
    return Media(src="thumb-back.jpg", kind="image"), Media(src="thumb-subject.png", kind="image")


def _detail(img: Image.Image) -> float:
    """How much is in a frame below its top (where the words go): an empty sky or fog scores near 0."""
    a = np.asarray(img.convert("L").resize((270, 480)), dtype=np.float32)[120:]
    return float(np.abs(np.diff(a, axis=1)).mean() + np.abs(np.diff(a, axis=0)).mean())


def world_take(props: RenderProps, job_dir: Path, public: Path) -> Media | None:
    """A clean frame of the story's 3D world at its key moment: a few moments of the two longest world
    scenes, with captions, labels and badges off; the first that isn't empty is kept."""
    worlds = sorted((s for s in props.scenes if s.type == "world" and s.world), key=lambda s: s.end - s.start, reverse=True)
    if not worlds:
        return None
    clean = props.model_dump()
    clean.update({"showCaptions": False, "showVisualizer": False, "badge": None, "subscribe": None, "captions": []})
    for s in clean["scenes"]:
        s["label"] = ""  # no "RECONSTRUCTION" tag
        s["heading"] = None  # nor the scene's title card under the thumbnail's words
        s["text"] = None
        if s.get("world"):
            s["world"]["callouts"] = []
    path = job_dir / "thumb-world-props.json"
    path.write_text(json.dumps(clean))
    # the key moment first, then others in case it caught an empty sky or the gap between cells
    at = list(dict.fromkeys(round((k.start + (k.end - k.start) * t) * props.fps) for k in worlds[:2] for t in (0.6, 0.35, 0.85)))
    shots = render.frames(path.resolve(), public.resolve(), (job_dir / "thumb-world").resolve(), at)
    img = next((i for i in (Image.open(p).convert("RGB") for p in shots) if _detail(i) >= 2.5), None)
    if img is None:
        return None
    img = ImageOps.autocontrast(img, cutoff=1, preserve_tone=True)  # a dim night set still reads at phone size
    img = ImageEnhance.Color(img).enhance(1.15)
    img.save(public / "thumb-world.jpg", quality=92)
    return Media(src="thumb-world.jpg", kind="image")


def art_take(props: RenderProps) -> Media | None:
    """The storyboard's hook shot: the first painted picture, which the storyboard draws as the most
    striking image of the story."""
    beat = next((b for s in props.scenes for b in (s.beats or [])), None)
    return Media(src=beat.src, kind="image") if beat else None


def _fits(cfg: Config, subject: Path) -> bool:
    """Whether a cut-out fills the frame: a wide subject (a plane side-on) shrinks to a strip in a Short."""
    w, h = Image.open(subject).size
    return cfg.format != "short" or w <= 1.3 * h


def make(cfg: Config, job_dir: Path, public: Path, title: str, photo: Media | None, props: RenderProps | None,
         meant: str, log=print, photos: list[Media] = (), stock=None) -> Path:
    """Render the takes, judge them and copy the chosen one to thumbnail.png. Returns its path.
    Takes in order: a cut-out (from `photo`, then each of `photos`, then the photo `stock()` finds: the first
    photograph with a clear subject that fills the frame), the storyboard's hook picture, the 3D world, the
    plain photo."""
    base = {"format": cfg.format, "title": title, "kicker": "", "theme": cfg.theme.model_dump()}
    takes: list[tuple[str, ThumbnailProps]] = []

    def cut_from(candidates) -> ThumbnailProps | None:
        for p in candidates:
            try:
                p = p() if callable(p) else p
                # photographs only: an article's diagrams and maps are JPEG-less and make poor subjects
                if p is None or p.kind != "image" or not p.src.lower().endswith((".jpg", ".jpeg")) or p.src in tried:
                    continue
                tried.append(p.src)
                cut = cutout_take(cfg, public, p)
                if cut and _fits(cfg, public / cut[1].src):
                    return ThumbnailProps(**base, background=cut[0], subject=cut[1])
            except Exception as e:  # the cut-out model is optional
                log(f"warning: no cut-out thumbnail: {str(e)[:160]}")
                return None
        return None

    tried: list[str] = []
    cut = cut_from([photo, *photos, stock])  # the story's own photographs first, then a stock one
    if cut:
        takes.append(("cutout", cut))
    painted = art_take(props) if props is not None else None
    if painted:
        takes.append(("painted", ThumbnailProps(**base, background=painted)))
    if props is not None:
        try:
            frame = world_take(props, job_dir, public)
            if frame:
                takes.append(("world", ThumbnailProps(**base, background=frame)))
        except Exception as e:
            log(f"warning: no 3D thumbnail: {str(e)[:160]}")
    takes.append(("photo", ThumbnailProps(**base, background=photo)))

    chosen, notes = None, []
    for name, thumb in takes:
        spec = job_dir / f"thumbnail-{name}.json"
        out = job_dir / f"thumbnail-{name}.png"
        spec.write_text(thumb.model_dump_json(indent=2))
        render.render(spec.resolve(), public.resolve(), out.resolve(), still=True)
        verdict = storyboard.review(cfg, out, f"a YouTube thumbnail about {meant} with the words \"{title}\"", THUMB_REVIEW)
        notes.append({"take": name, "passed": None if verdict is None else verdict.matches, "problems": "" if verdict is None else verdict.problems})
        if verdict is None or verdict.matches:
            chosen = out
            break
    if chosen is None:  # every take failed: the first one, which is usually the strongest
        chosen = job_dir / f"thumbnail-{takes[0][0]}.png"
    final = job_dir / "thumbnail.png"
    final.write_bytes(chosen.read_bytes())
    (job_dir / "thumbnail-choice.json").write_text(json.dumps({"chosen": chosen.stem.removeprefix("thumbnail-"), "takes": notes}, indent=2))
    log(f"thumbnail: {chosen.stem.removeprefix('thumbnail-')} take" + "".join(f"; {n['take']} failed: {n['problems']}" for n in notes if n["passed"] is False))
    return final
