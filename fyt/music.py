"""Background music made from scratch for each video, in the mood the script asks for:
somber (slow, sparse, respectful), tense (low pulse and drone), curious (soft chords and a
plucked arpeggio), uplifting (major key, brighter) or playful (major, quick and light).

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
MAJOR_PROGRESSIONS = [
    [0, 7, 9, 5],  # I V vi IV
    [0, 5, 7, 5],  # I IV V IV
    [0, 9, 5, 7],  # I vi IV V
]
MINOR = [0, 3, 7]  # root, minor third, fifth
MAJOR = [0, 4, 7]
MAJOR_DEGREES = {3, 8, 10}  # III, VI and VII are major in a minor key
MINOR_IN_MAJOR = {2, 4, 9}  # ii, iii and vi are minor in a major key


class Style:
    """How a mood sounds: tempo range, key, which parts play, and how bright the mix is."""

    def __init__(self, bpm, major, arp_step, arp_level, pulse, drone, cutoff, level):
        self.bpm, self.major, self.arp_step, self.arp_level = bpm, major, arp_step, arp_level
        self.pulse, self.drone, self.cutoff, self.level = pulse, drone, cutoff, level


# arp_step: beats between arpeggio notes (0 = no arpeggio). pulse: kick and ticks.
# level: peak level, so a somber track also sits quieter under the voice.
STYLES = {
    "somber": Style((54, 64), False, 2.0, 0.12, False, True, 2200, 0.6),
    "tense": Style((78, 90), False, 0.5, 0.08, False, True, 3200, 0.75),
    "curious": Style((68, 84), False, 0.5, 0.18, False, False, 5000, 0.85),
    "uplifting": Style((92, 106), True, 0.5, 0.18, False, False, 6000, 0.85),
    "playful": Style((108, 120), True, 0.5, 0.2, True, False, 7000, 0.85),
}
MOODS = tuple(STYLES)


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


def compose(
    seconds: float, energetic: bool = False, seed: int | None = None, mood: str = "curious"
) -> np.ndarray:
    """Stereo float samples in [-1, 1]. `energetic` (Shorts) adds a light pulse and a little tempo,
    except for somber and tense tracks, which keep their weight."""
    st = STYLES.get(mood, STYLES["curious"])
    rng = random.Random(seed)
    nrng = np.random.default_rng(seed)
    pulse = st.pulse or (energetic and mood in ("curious", "uplifting"))
    lo, hi = st.bpm
    bpm = rng.randint(lo, hi) + (12 if energetic and mood in ("curious", "uplifting") else 0)
    key = 45 + rng.randint(0, 11)  # A2 .. G#3 as the bass root
    prog = rng.choice(MAJOR_PROGRESSIONS if st.major else PROGRESSIONS)
    if mood == "tense":
        prog = [0, 0, 8, 7]  # hang on the tonic, then lean on VI and V
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
        if st.major:
            shape = MINOR if degree in MINOR_IN_MAJOR else MAJOR
        else:
            shape = MAJOR if degree in MAJOR_DEGREES else MINOR
        root = key + degree
        n = min(int(bar * RATE), total - start)
        t = np.arange(n) / RATE
        chord = [_hz(root + 12 + s) for s in shape]
        pad = _pad(chord, n)
        env = np.minimum(1, t / 0.05) * np.minimum(1, (n - np.arange(n)) / (0.1 * RATE))
        if mood == "tense":  # a bass that throbs on every eighth note
            bass = 0.5 * np.sin(2 * np.pi * _hz(root) * t) * (0.55 + 0.45 * np.cos(2 * np.pi * t / (beat / 2))) * env
        else:
            bass = 0.5 * np.sin(2 * np.pi * _hz(root) * t) * env
        left[start : start + n] += 0.55 * pad + 0.35 * bass
        right[start : start + n] += 0.55 * pad + 0.35 * bass
        if st.drone:  # a low held fifth under everything
            drone = 0.12 * np.sin(2 * np.pi * _hz(key - 12) * t) + 0.08 * np.sin(2 * np.pi * _hz(key - 5) * t)
            left[start : start + n] += drone
            right[start : start + n] += drone
        if st.arp_step:
            notes = [root + 24 + shape[i % 3] + (12 if i == 3 else 0) for i in pattern]
            step = beat * st.arp_step
            for k in range(int(round(4 / st.arp_step))):
                s = start + int(k * step * RATE)
                m = min(int(min(step * 2, 1.5) * RATE), total - s)
                if m <= 0:
                    continue
                p = st.arp_level * _pluck(_hz(notes[k % 4]), m)
                pan = 0.35 if k % 2 else -0.35  # alternate sides for width
                left[s : s + m] += p * (1 - pan)
                right[s : s + m] += p * (1 + pan)
                if pulse:
                    tick = 0.05 * _tick(min(int(0.08 * RATE), m), nrng)
                    left[s : s + len(tick)] += tick
                    right[s : s + len(tick)] += tick
        if pulse:
            for k in (0, 2):  # a soft kick on beats 1 and 3
                s = start + int(k * beat * RATE)
                m = min(int(0.4 * RATE), total - s)
                if m > 0:
                    kick = 0.45 * _kick(m)
                    left[s : s + m] += kick
                    right[s : s + m] += kick
    stereo = np.stack([_lowpass(left, st.cutoff), _lowpass(right, st.cutoff)], axis=1)
    peak = np.abs(stereo).max() or 1.0
    fade = np.minimum(1, np.arange(total) / RATE / 1.5)[:, None]
    return stereo / peak * st.level * fade


def write(path: Path, seconds: float, energetic: bool = False, seed: int | None = None, mood: str = "curious") -> Path:
    audio = compose(seconds, energetic, seed, mood)
    pcm = (audio * 32767).astype("<i2")
    with wave.open(str(path), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(pcm.tobytes())
    return path
