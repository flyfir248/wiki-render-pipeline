import numpy as np
from PIL import Image

from fyt import depth
from fyt.models import RenderBeat


class FakeModel:
    """Depth Anything's interface: nearer is larger. This one says the lower half is near."""

    class _In:
        name = "pixel_values"

    def get_inputs(self):
        return [self._In()]

    def run(self, _, feeds):
        x = feeds["pixel_values"]
        assert x.shape[0] == 1 and x.shape[1] == 3 and x.shape[2] % 14 == 0 and x.shape[3] % 14 == 0
        h, w = x.shape[2:]
        d = np.zeros((1, h, w), dtype=np.float32)
        d[:, h // 2 :, w // 4 : w // 2] = 10.0
        return [d]


def test_model_input_is_patch_sized_with_the_pictures_shape():
    assert depth._size(768, 1344) == (294, 518)
    assert depth._size(1344, 768) == (518, 294)


def test_depth_maps_sit_next_to_their_pictures_with_the_near_subject_as_focus(tmp_path, monkeypatch):
    (tmp_path / "art").mkdir()
    Image.new("RGB", (768, 1344), "navy").save(tmp_path / "art" / "beat-1-2.jpg")
    monkeypatch.setattr(depth, "session", lambda log=print: FakeModel())
    monkeypatch.setattr(depth, "_session", FakeModel())
    out = depth.add(tmp_path, ["art/beat-1-2.jpg"], log=lambda m: None)
    got = out["art/beat-1-2.jpg"]
    assert got["depth"] == "art/beat-1-2.depth.png"
    im = Image.open(tmp_path / got["depth"])
    assert im.mode == "L" and im.size == (384, 672)
    x, y = got["focus"]
    assert 0.25 < x < 0.5 and y > 0.5
    beat = RenderBeat(at=0, src="art/beat-1-2.jpg").model_copy(update=got)
    assert beat.depth.endswith(".depth.png")


def test_without_the_model_nothing_gets_depth(tmp_path, monkeypatch):
    monkeypatch.setattr(depth, "session", lambda log=print: None)
    assert depth.add(tmp_path, ["art/x.jpg"], log=lambda m: None) == {}
