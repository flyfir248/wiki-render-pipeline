"""Background music made from scratch for each video: soft chords, a bass note, a plucked
arpeggio and (in Shorts) a light pulse, in a random minor key and tempo.

It's synthesised here, note by note, so there are no licences, no Content ID claims and no
AI-generated music to disclose. A track you put in `music_dir` is used instead when there is one.
"""

from __future__ import annotations

import random
import wave
from pathlib import Path

import numpy as np

RATE = 44100
# Minor-key progressions as semitone offsets of each chord's root from the key's root.
PROGRESSIONS = [
    [0, 8, 3, 10],  # i VI III VII
    [0, 5, 8, 7],  # i iv VI V
    [0, 10, 8, 10],  # i VII VI VII
    [0, 3, 8, 7],  # i III VI V
]
MINOR = [0, 3, 7]  # root, minor third, fifth
MAJOR = [0, 4, 7]
MAJOR_DEGREES = {3, 8, 10}  # III, VI and VII are major in a minor key


def _hz(midi: float) -> float:
    return 440.0 * 2 ** ((midi - 69) / 12)


def _lowpass(x: np.ndarray, cutoff: float) -> np.ndarray:
    """Gentle low-pass filter (a short exponential FIR, fast in numpy): takes the edge off."""
    a = np.exp(-2 * np.pi * cutoff / RATE)
    kernel = a ** np.arange(64)
    return np.convolve(x, kernel / kernel.sum(), mode="same")


def _pad(freqs: list[float], n: int) -> np.ndarray:
    t = np.arange(n) / RATE
    out = np.zeros(n)
    for f in freqs:
        for detune in (-0.12, 0.12):  # two slightly detuned voices make it shimmer
            ff = f * 2 ** (detune / 12)
            out += np.sin(2 * np.pi * ff * t) + 0.25 * np.sin(2 * np.pi * 2 * ff * t)
    attack = np.minimum(1, t / 0.6)
    release = np.minimum(1, (n / RATE - t) / 0.4).clip(0)
    return out * attack * release / (len(freqs) * 2.5)


def _pluck(freq: float, n: int) -> np.ndarray:
    t = np.arange(n) / RATE
    return (np.sin(2 * np.pi * freq * t) + 0.3 * np.sin(2 * np.pi * 2 * freq * t)) * np.exp(-t * 6)


def _tick(n: int, rng: np.random.Generator) -> np.ndarray:
    t = np.arange(n) / RATE
    noise = rng.uniform(-1, 1, n)
    return np.diff(noise, prepend=0) * np.exp(-t * 60)  # a high, short hiss


def _kick(n: int) -> np.ndarray:
    t = np.arange(n) / RATE
    sweep = 2 * np.pi * (45 * t + 60 * (1 - np.exp(-t * 30)) / 30)
    return np.sin(sweep) * np.exp(-t * 9)


def compose(seconds: float, energetic: bool, seed: int | None = None) -> np.ndarray:
    """Stereo float samples in [-1, 1]."""
    rng = random.Random(seed)
    nrng = np.random.default_rng(seed)
    bpm = rng.randint(96, 112) if energetic else rng.randint(68, 84)
    key = 45 + rng.randint(0, 11)  # A2 .. G#3 as the bass root
    prog = rng.choice(PROGRESSIONS)
    beat = 60 / bpm
    bar = 4 * beat
    total = int((seconds + 1) * RATE)
    left, right = np.zeros(total), np.zeros(total)
    bars = int(np.ceil(seconds / bar)) + 1
    pattern = rng.choice([[0, 1, 2, 1], [0, 2, 1, 2], [0, 1, 2, 3], [2, 1, 0, 1]])
    for b in range(bars):
        start = int(b * bar * RATE)
        if start >= total:
            break
        degree = prog[b % len(prog)]
        shape = MAJOR if degree in MAJOR_DEGREES else MINOR
        root = key + degree
        n = min(int(bar * RATE), total - start)
        chord = [_hz(root + 12 + s) for s in shape]
        pad = _pad(chord, n)
        bass = 0.5 * np.sin(2 * np.pi * _hz(root) * np.arange(n) / RATE) * np.minimum(1, np.arange(n) / (0.05 * RATE))
        bass *= np.minimum(1, (n - np.arange(n)) / (0.1 * RATE))
        left[start : start + n] += 0.55 * pad + 0.35 * bass
        right[start : start + n] += 0.55 * pad + 0.35 * bass
        notes = [root + 24 + shape[i % 3] + (12 if i == 3 else 0) for i in pattern]
        step = beat / 2  # eighth notes
        for k in range(8):
            s = start + int(k * step * RATE)
            m = min(int(step * 2 * RATE), total - s)
            if m <= 0:
                continue
            p = 0.18 * _pluck(_hz(notes[k % 4]), m)
            pan = 0.35 if k % 2 else -0.35  # alternate sides for width
            left[s : s + m] += p * (1 - pan)
            right[s : s + m] += p * (1 + pan)
            if energetic:
                tick = 0.05 * _tick(min(int(0.08 * RATE), m), nrng)
                left[s : s + len(tick)] += tick
                right[s : s + len(tick)] += tick
        if energetic:
            for k in (0, 2):  # a soft kick on beats 1 and 3
                s = start + int(k * beat * RATE)
                m = min(int(0.4 * RATE), total - s)
                if m > 0:
                    kick = 0.45 * _kick(m)
                    left[s : s + m] += kick
                    right[s : s + m] += kick
    stereo = np.stack([_lowpass(left, 5000), _lowpass(right, 5000)], axis=1)
    peak = np.abs(stereo).max() or 1.0
    fade = np.minimum(1, np.arange(total) / RATE / 1.5)[:, None]
    return stereo / peak * 0.85 * fade


def write(path: Path, seconds: float, energetic: bool, seed: int | None = None) -> Path:
    audio = compose(seconds, energetic, seed)
    pcm = (audio * 32767).astype("<i2")
    with wave.open(str(path), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(pcm.tobytes())
    return path
