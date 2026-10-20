import json

import numpy as np
from PIL import Image

from fyt import thumbs
from fyt.config import Config
from fyt.models import Media
from fyt.storyboard import Verdict


def test_colour_cutout_keeps_the_subject_in_colour_and_crops_to_it():
    img = Image.new("RGB", (200, 200), (20, 20, 20))
    img.paste((200, 30, 30), (60, 60, 140, 140))
    mask = np.zeros((200, 200), dtype=np.float32)
    mask[60:140, 60:140] = 1.0
    cut = thumbs._colour_cutout(img, mask)
    assert cut.mode == "RGBA" and cut.width < 120 and cut.height < 120
    r, g, b, a = cut.getpixel((cut.width // 2, cut.height // 2))
    assert a == 255 and r > 150 and g < 80


def test_the_first_take_that_passes_is_used(tmp_path, monkeypatch):
    public = tmp_path / "public"
    public.mkdir()
    monkeypatch.setattr(thumbs, "cutout_take", lambda cfg, public, photo: (Media(src="b.jpg", kind="image"), Media(src="s.png", kind="image")))
    monkeypatch.setattr(thumbs, "_fits", lambda cfg, subject: True)
    monkeypatch.setattr(thumbs, "world_take", lambda props, job, public: Media(src="w.jpg", kind="image"))
    monkeypatch.setattr(thumbs.render, "render", lambda spec, public, out, still: out.write_bytes(spec.name.encode()))
    verdicts = {"thumbnail-cutout.png": Verdict(matches=False, problems="words cover the face"), "thumbnail-world.png": Verdict(matches=True)}
    monkeypatch.setattr(thumbs.storyboard, "review", lambda cfg, path, meant, rules: verdicts.get(path.name))
    out = thumbs.make(Config(format="short"), tmp_path, public, "IT ATE 40 KG", Media(src="p.jpg", kind="image"), object(), "a bear", log=lambda m: None)
    assert out.read_bytes() == b"thumbnail-world.json"
    choice = json.loads((tmp_path / "thumbnail-choice.json").read_text())
    assert choice["chosen"] == "world" and choice["takes"][0]["problems"] == "words cover the face"


def test_the_cut_out_tries_more_photos_until_one_has_a_subject(tmp_path, monkeypatch):
    public = tmp_path / "public"
    public.mkdir()
    seen = []

    def cut(cfg, public, photo):
        seen.append(photo.src)
        return (Media(src="b.jpg", kind="image"), Media(src="s.png", kind="image")) if photo.src == "stock.jpg" else None

    monkeypatch.setattr(thumbs, "cutout_take", cut)
    monkeypatch.setattr(thumbs, "_fits", lambda cfg, subject: True)
    monkeypatch.setattr(thumbs.render, "render", lambda spec, public, out, still: out.write_bytes(spec.name.encode()))
    monkeypatch.setattr(thumbs.storyboard, "review", lambda cfg, path, meant, rules: None)
    photos = [Media(src="a.jpg", kind="image"), Media(src="diagram.png", kind="image"), Media(src="b.jpg", kind="image")]
    out = thumbs.make(Config(format="short"), tmp_path, public, "IT ATE 40 KG", photos[0], None, "a bear",
                      log=lambda m: None, photos=photos, stock=lambda: Media(src="stock.jpg", kind="image"))
    assert seen == ["a.jpg", "b.jpg", "stock.jpg"]
    assert out.read_bytes() == b"thumbnail-cutout.json"


def test_a_wide_subject_is_no_cut_out_for_a_short(tmp_path):
    Image.new("RGBA", (600, 200)).save(tmp_path / "wide.png")
    Image.new("RGBA", (300, 400)).save(tmp_path / "tall.png")
    assert not thumbs._fits(Config(format="short"), tmp_path / "wide.png")
    assert thumbs._fits(Config(format="short"), tmp_path / "tall.png")
    assert thumbs._fits(Config(format="long"), tmp_path / "wide.png")


def test_a_diagram_is_no_photograph():
    mask = np.zeros((100, 100), dtype=np.float32)
    mask[20:80, 20:80] = 1.0
    drawing = Image.new("RGB", (100, 100), (255, 255, 255))
    drawing.paste((30, 140, 40), (30, 30, 70, 70))
    photo = Image.fromarray(np.random.default_rng(0).integers(0, 255, (100, 100, 3), dtype=np.uint8))
    assert thumbs._drawn(drawing, mask)
    assert not thumbs._drawn(photo, mask)


def test_an_empty_frame_has_little_detail():
    empty = Image.new("RGB", (1080, 1920), (200, 30, 80))
    busy = Image.fromarray(np.random.default_rng(0).integers(0, 255, (1920, 1080, 3), dtype=np.uint8))
    assert thumbs._detail(empty) < 2.5 < thumbs._detail(busy)
