"""Sound effects, synthesised like the music (fyt.music), so there's nothing to license.

The renderer decides when each one plays (a whoosh on a scene change, a zip as the red thread is
pulled across, a pop when a pin drops or a prop appears, a tick as a chart point lands, a riser and a
hit for a big reveal, a boom for an explosion, a soft chime when a figure lands, a thud for a stamp);
this module only writes the sounds into the job.
"""

from __future__ import annotations

import wave
from pathlib import Path

import numpy as np

from fyt.music import RATE, _lowpass

NAMES = ("whoosh", "pop", "boom", "thunder", "chime", "thud", "flame", "sparkle", "hit", "tick", "zip", "riser")


def _t(seconds: float) -> np.ndarray:
    return np.arange(int(seconds * RATE)) / RATE


def _noise(n: int, rng: np.random.Generator) -> np.ndarray:
    return rng.uniform(-1, 1, n)


def whoosh(rng: np.random.Generator) -> np.ndarray:
    """Air rushing past: noise swelling and fading while its brightness sweeps up."""
    t = _t(0.55)
    n = len(t)
    noise = _noise(n, rng)
    low = _lowpass(noise, 500)
    high = noise - _lowpass(noise, 2500)
    sweep = np.clip(t / t[-1], 0, 1)
    body = low * (1 - sweep) + 0.6 * high * sweep
    env = np.sin(np.pi * np.clip(t / t[-1], 0, 1)) ** 2
    return body * env * 1.6


def pop(rng: np.random.Generator) -> np.ndarray:
    """A soft, round pop: a quick downward pitch blip."""
    t = _t(0.16)
    freq = 900 * np.exp(-t * 25) + 220
    phase = 2 * np.pi * np.cumsum(freq) / RATE
    return np.sin(phase) * np.exp(-t * 32) * 0.9


def boom(rng: np.random.Generator) -> np.ndarray:
    """An explosion: a deep thump with a long rumbling tail."""
    t = _t(2.2)
    n = len(t)
    thump = np.sin(2 * np.pi * (40 * t + 70 * (1 - np.exp(-t * 20)) / 20)) * np.exp(-t * 4)
    rumble = _lowpass(_lowpass(_noise(n, rng), 180), 180) * np.exp(-t * 1.6) * 6
    crack = (_noise(n, rng) - _lowpass(_noise(n, rng), 1500)) * np.exp(-t * 30) * 0.5
    return np.tanh((thump + rumble + crack) * 1.4) * 0.95


def thunder(rng: np.random.Generator) -> np.ndarray:
    """A crack of thunder rolling away."""
    t = _t(2.6)
    n = len(t)
    crack = _noise(n, rng) * np.exp(-t * 18) * 0.6
    roll = _lowpass(_lowpass(_noise(n, rng), 250), 250) * 7
    wobble = 0.6 + 0.4 * np.sin(2 * np.pi * 3.1 * t) * np.sin(2 * np.pi * 0.7 * t)
    return np.tanh((crack + roll * wobble * np.exp(-t * 1.3)) * 1.2) * 0.9


def chime(rng: np.random.Generator) -> np.ndarray:
    """A gentle bell for a figure landing: two soft partials, quickly settling."""
    t = _t(1.2)
    tone = sum(a * np.sin(2 * np.pi * f * t) for f, a in ((880, 1.0), (1320, 0.45), (2640, 0.15)))
    return tone * np.exp(-t * 4.5) * np.minimum(1, t / 0.004) * 0.45


def thud(rng: np.random.Generator) -> np.ndarray:
    """A rubber stamp or a heavy object set down."""
    t = _t(0.35)
    n = len(t)
    knock = np.sin(2 * np.pi * 110 * t) * np.exp(-t * 28)
    slap = _lowpass(_noise(n, rng), 1200) * np.exp(-t * 45) * 2.5
    return np.tanh((knock + slap) * 1.5) * 0.9


def flame(rng: np.random.Generator) -> np.ndarray:
    """Fire catching: a soft roar with crackles."""
    t = _t(1.8)
    n = len(t)
    roar = _lowpass(_noise(n, rng), 400) * 4 * np.minimum(1, t / 0.25) * np.exp(-t * 1.2)
    crackles = (rng.random(n) > 0.9985) * rng.uniform(0.3, 1, n)
    crackle = np.convolve(crackles, np.exp(-np.arange(200) / 25), mode="same") * np.exp(-t * 0.8)
    return np.tanh(roar + crackle * 0.6) * 0.8


def sparkle(rng: np.random.Generator) -> np.ndarray:
    """A shimmer of high bell notes."""
    t = _t(1.3)
    out = np.zeros(len(t))
    for i, f in enumerate((1568, 2093, 2637, 3136)):
        start = int(i * 0.07 * RATE)
        tt = t[: len(t) - start]
        out[start:] += np.sin(2 * np.pi * f * tt) * np.exp(-tt * 6)
    return out * 0.18


def hit(rng: np.random.Generator) -> np.ndarray:
    """The impact under a big reveal: a sub-bass drop with a short, bright transient on top."""
    t = _t(0.9)
    n = len(t)
    sub = np.sin(2 * np.pi * (45 * t + 90 * (1 - np.exp(-t * 14)) / 14)) * np.exp(-t * 5)
    snap = (_noise(n, rng) - _lowpass(_noise(n, rng), 3000)) * np.exp(-t * 60) * 0.7
    body = _lowpass(_noise(n, rng), 300) * np.exp(-t * 9) * 3
    return np.tanh((sub * 1.3 + snap + body) * 1.3) * 0.9


def tick(rng: np.random.Generator) -> np.ndarray:
    """A small, dry click, like a pen tapping paper: for chart points and steps landing."""
    t = _t(0.12)
    click = np.sin(2 * np.pi * 2200 * t) * np.exp(-t * 160)
    grit = _noise(len(t), rng) * np.exp(-t * 300) * 0.4
    return (click + grit) * 0.6


def zip(rng: np.random.Generator) -> np.ndarray:  # noqa: A001 - a sound, named for what it sounds like
    """A taut string pulled fast through the fingers: noise through a sweeping resonance."""
    t = _t(0.5)
    n = len(t)
    noise = _noise(n, rng)
    # A cheap band that sweeps up: filter the whole noise at a few centres, then step through them.
    centres = 600 + 2600 * np.linspace(0, 1, 10) ** 1.5
    bands = [_lowpass(noise, f) - _lowpass(noise, f * 0.6) for f in centres]
    which = np.minimum(9, (t / t[-1] * 10).astype(int))
    out = np.choose(which, bands)
    env = np.minimum(1, t / 0.05) * np.exp(-np.maximum(0, t - 0.3) * 18)
    return out * env * 3.2


def riser(rng: np.random.Generator) -> np.ndarray:
    """A short swell that leans into a reveal: a rising tone under rising noise."""
    t = _t(0.8)
    n = len(t)
    freq = 180 * 2 ** (t / t[-1] * 1.5)
    tone = np.sin(2 * np.pi * np.cumsum(freq) / RATE)
    air = (_noise(n, rng) - _lowpass(_noise(n, rng), 1800)) * 0.5
    env = (t / t[-1]) ** 2
    return (tone * 0.6 + air) * env * 0.7


def write_all(public: Path, seed: int = 3) -> str:
    """Write every effect into `public/sfx/`. Returns the folder name the renderer uses."""
    folder = public / "sfx"
    folder.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(seed)
    for name in NAMES:
        audio = globals()[name](rng)
        audio = np.clip(audio, -1, 1)
        fade = min(len(audio), int(0.01 * RATE))
        audio[-fade:] *= np.linspace(1, 0, fade)  # no click at the end
        pcm = (audio * 32767).astype("<i2")
        with wave.open(str(folder / f"{name}.wav"), "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(RATE)
            w.writeframes(pcm.tobytes())
    return "sfx"
