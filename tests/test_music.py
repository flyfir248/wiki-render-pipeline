import wave

import numpy as np

from fyt import music


def test_compose_is_stereo_full_length_and_never_clips():
    a = music.compose(6, energetic=True, seed=1)
    assert a.shape == (int(7 * music.RATE), 2)
    assert np.abs(a).max() <= 0.86 and np.abs(a).mean() > 0.01
    assert not np.allclose(music.compose(6, energetic=True, seed=1), music.compose(6, energetic=True, seed=2))


def test_write_makes_a_wav(tmp_path):
    p = music.write(tmp_path / "m.wav", 3, energetic=False, seed=3)
    with wave.open(str(p)) as w:
        assert w.getnchannels() == 2 and w.getframerate() == music.RATE
