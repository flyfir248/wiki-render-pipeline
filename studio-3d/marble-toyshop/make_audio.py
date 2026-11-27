#!/usr/bin/env python3
"""Soundtrack for the toyshop marble loop: a seamless 15 s stereo WAV, synthesised (no samples, no licences).

Every machine sound repeats every 1.25 s, because a marble passes each point once per 1.25 s:
  xylophone: 7 bars, C major pentatonic (C5 D5 E5 G5 A5 C6 D6), panned left to right like the bars on screen
  wood tock when a cup picks up a marble, a click as it tips onto the top ramp, a soft rattle in each U-turn,
  a rising whirr in the spiral funnel, a plunk when it drops onto the return ramp, and a low rolling bed.
Under it, a quiet pad cycles C - Am - F - G (3.75 s each), so the 15 s loop has a shape.
The signal is built over three loops and the middle one is kept, so tails wrap round the seam.

usage: python make_audio.py timing.json out.wav   (timing.json = window.MARBLE_TIMING from the page)
Loudness is set afterwards with ffmpeg loudnorm (-14 LUFS, -1.5 dBTP) by the assembly step.
"""
import json, sys, wave
import numpy as np

SR = 48000
tm = json.load(open(sys.argv[1]))
LOOP, GAP = tm['loop'], tm['gap']
seg = {name: (start, dur) for name, start, dur in tm['segs']}
N = int(LOOP * SR)
buf = np.zeros((3 * N, 2))
rng = np.random.default_rng(7)


def add(t, sig, pan=0.0, gain=1.0):
    """Mix a mono signal at time t (s, may be anywhere in the middle loop) with constant-power pan."""
    i = int(round((t + LOOP) * SR))
    l, r = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
    j = min(len(buf), i + len(sig))
    if j > i:
        buf[i:j, 0] += sig[: j - i] * gain * l
        buf[i:j, 1] += sig[: j - i] * gain * r


def env(n, a, d):
    t = np.arange(n) / SR
    return np.minimum(1, t / a) * np.exp(-t / d)


def bandnoise(n, lo, hi):
    x = rng.standard_normal(n)
    f = np.fft.rfft(x)
    fr = np.fft.rfftfreq(n, 1 / SR)
    f[(fr < lo) | (fr > hi)] = 0
    y = np.fft.irfft(f, n)
    return y / (np.abs(y).max() + 1e-9)


def chime(freq, dur=1.6):
    n = int(dur * SR)
    t = np.arange(n) / SR
    s = (np.sin(2 * np.pi * freq * t) * env(n, 0.002, 0.55)
         + 0.35 * np.sin(2 * np.pi * freq * 2.76 * t) * env(n, 0.001, 0.12)
         + 0.12 * np.sin(2 * np.pi * freq * 5.40 * t) * env(n, 0.001, 0.05)
         + 0.25 * np.sin(2 * np.pi * freq * 2 * t) * env(n, 0.002, 0.3))
    s[: int(0.004 * SR)] += bandnoise(int(0.004 * SR), 2000, 9000) * 0.15
    return s


def knock(freq, dur, decay, noise=0.3):
    n = int(dur * SR)
    t = np.arange(n) / SR
    return (np.sin(2 * np.pi * freq * t) * env(n, 0.001, decay) + noise * bandnoise(n, 800, 5000) * env(n, 0.0005, decay / 4))


NOTES = [523.25, 587.33, 659.26, 783.99, 880.0, 1046.5, 1174.66]
chimes = [chime(f) for f in NOTES]
for k in range(-1, int(LOOP / GAP) + 1):           # every 1.25 s, including the wrap-round neighbours
    base = k * GAP
    for b, ts in tm['strikes']:
        add(base + ts % GAP, chimes[b], pan=-0.35 + 0.7 * b / 6, gain=0.32)
    add(base + 0.0, knock(320, 0.15, 0.03, 0.5), pan=-0.45, gain=0.16)                       # cup picks up the marble
    add(base + (seg['tip'][0] + seg['tip'][1]) % GAP, knock(900, 0.08, 0.012, 0.8), pan=-0.3, gain=0.10)   # onto the top ramp
    for u in ('U1', 'U2'):
        s0, d = seg[u]; n = int(d * SR)
        add(base + s0 % GAP, bandnoise(n, 500, 2500) * np.hanning(n) * 0.5, pan=0.3 if u == 'U1' else -0.2, gain=0.05)
    s0, d = seg['funnel']; n = int(d * SR); t = np.arange(n) / SR           # spiral: whirr rising in pitch and level
    ph = 2 * np.pi * np.cumsum(180 + 420 * (t / d) ** 1.6) / SR
    whirr = bandnoise(n, 300, 2200) * (0.6 + 0.4 * np.sin(ph * 2)) * np.minimum(1, t / 0.2) * (0.4 + 0.6 * t / d) * np.minimum(1, (d - t) / 0.05)
    add(base + s0 % GAP, whirr, pan=0.15, gain=0.07)
    add(base + (seg['R3'][0]) % GAP, knock(210, 0.2, 0.05, 0.4), pan=0.1, gain=0.18)              # plunk onto the return ramp

# rolling bed (constant: there are always marbles on the ramps)
bed = bandnoise(3 * N, 120, 700) * 0.5
buf[:, 0] += bed * 0.035; buf[:, 1] += np.roll(bed, 4000) * 0.035

# pad: C - Am - F - G, 3.75 s each, soft triangle-ish voices with overlapping fades
CH = [[130.81, 196.0, 261.63, 329.63], [110.0, 220.0, 261.63, 329.63], [87.31, 174.61, 220.0, 261.63], [98.0, 196.0, 246.94, 293.66]]
cd = LOOP / 4
for k in range(-1, 5):
    n = int((cd + 1.0) * SR); t = np.arange(n) / SR
    fade = np.minimum(1, t / 0.6) * np.minimum(1, (cd + 1.0 - t) / 1.0)
    s = sum(np.sin(2 * np.pi * f * t) + 0.15 * np.sin(2 * np.pi * 3 * f * t) for f in CH[k % 4]) * fade
    s *= 0.85 + 0.15 * np.sin(2 * np.pi * t / 2.5)
    add(k * cd - 0.5, s, pan=0.0, gain=0.035)

out = buf[N:2 * N]
out = out / np.abs(out).max() * 0.7
with wave.open(sys.argv[2], 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((out * 32767).astype('<i2').tobytes())
print('wrote', sys.argv[2], f'{len(out) / SR:.2f}s')
