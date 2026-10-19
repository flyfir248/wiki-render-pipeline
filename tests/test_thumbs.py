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
    monkeypatch.setattr(thumbs, "world_take", lambda props, job, public: Media(src="w.jpg", kind="image"))
    monkeypatch.setattr(thumbs.render, "render", lambda spec, public, out, still: out.write_bytes(spec.name.encode()))
    verdicts = {"thumbnail-cutout.png": Verdict(matches=False, problems="words cover the face"), "thumbnail-world.png": Verdict(matches=True)}
    monkeypatch.setattr(thumbs.storyboard, "review", lambda cfg, path, meant, rules: verdicts.get(path.name))
    out = thumbs.make(Config(format="short"), tmp_path, public, "IT ATE 40 KG", Media(src="p.jpg", kind="image"), object(), "a bear", log=lambda m: None)
    assert out.read_bytes() == b"thumbnail-world.json"
    choice = json.loads((tmp_path / "thumbnail-choice.json").read_text())
    assert choice["chosen"] == "world" and choice["takes"][0]["problems"] == "words cover the face"
