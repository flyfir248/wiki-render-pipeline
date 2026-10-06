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


def test_every_mood_composes_and_somber_is_darker_slower_and_quieter():
    for mood in music.MOODS:
        a = music.compose(4, energetic=True, seed=5, mood=mood)
        assert a.shape == (int(5 * music.RATE), 2) and np.abs(a).max() <= 0.86
    somber = music.compose(8, energetic=True, seed=5, mood="somber")
    upbeat = music.compose(8, energetic=True, seed=5, mood="playful")
    assert np.abs(somber).max() < np.abs(upbeat).max()

    def brightness(a):  # share of the energy above 1.5 kHz
        spec = np.abs(np.fft.rfft(a[:, 0])) ** 2
        freqs = np.fft.rfftfreq(len(a), 1 / music.RATE)
        return spec[freqs > 1500].sum() / spec.sum()

    assert brightness(somber) < brightness(upbeat)
    assert music.STYLES["somber"].bpm[1] < music.STYLES["playful"].bpm[0]


def test_mood_reaches_the_music(tmp_path, monkeypatch):
    from fyt import media
    from fyt.config import Config

    seen = {}
    monkeypatch.setattr(music, "write", lambda path, seconds, energetic=False, seed=None, mood="": seen.update(mood=mood))
    cfg = Config(format="short")
    cfg.music_dir = str(tmp_path / "none")
    assert media.pick_music(cfg, tmp_path, 5, seed=1, mood="somber") == "music.wav"
    assert seen["mood"] == "somber"
