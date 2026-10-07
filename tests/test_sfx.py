import wave

from fyt import sfx
from fyt.config import Config
from fyt.timeline import build_props
from tests.test_pipeline import script


def test_every_effect_is_written_as_a_short_clean_clip(tmp_path):
    assert sfx.write_all(tmp_path) == "sfx"
    for name in sfx.NAMES:
        with wave.open(str(tmp_path / "sfx" / f"{name}.wav")) as w:
            assert 0.1 < w.getnframes() / w.getframerate() < 3


def test_props_carry_the_effects_only_when_written():
    s = script(1)
    on = build_props(Config(), s, [(0.0, 2.0)], [[]], {}, None, None, "sfx")
    off = build_props(Config(), s, [(0.0, 2.0)], [[]], {}, None, None)
    assert on.sfx and on.sfx.dir == "sfx" and on.sfx.volume == Config().sfx_volume
    assert off.sfx is None
