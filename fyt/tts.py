"""Text-to-speech per scene, returning audio plus word-level timestamps.

Each scene is voiced separately so scene boundaries line up exactly with the
narration; clips are then joined into one WAV with a short pause between them.
"""

from __future__ import annotations

import asyncio
import base64
import re
import shutil
import subprocess
import wave
from dataclasses import dataclass
from pathlib import Path

import imageio_ffmpeg
import requests

from fyt.config import ROOT, Config, secret
from fyt.models import Word
from fyt.speech import join_spoken, speakable, spoken_sentences

SAMPLE_RATE = 44100


@dataclass
class Clip:
    wav: Path
    duration: float
    words: list[Word]  # times relative to the clip start


def ffmpeg(*args: str) -> None:
    subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), "-loglevel", "error", "-y", *args], check=True)


def to_wav(src: Path, dst: Path) -> float:
    ffmpeg("-i", str(src), "-ac", "1", "-ar", str(SAMPLE_RATE), "-sample_fmt", "s16", str(dst))
    with wave.open(str(dst)) as w:
        return w.getnframes() / w.getframerate()


def silence_wav(dst: Path, seconds: float) -> None:
    with wave.open(str(dst), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SAMPLE_RATE)
        w.writeframes(b"\x00\x00" * int(seconds * SAMPLE_RATE))


def estimate_words(text: str, words_per_second: float = 2.6, offset: float = 0.1) -> tuple[list[Word], float]:
    """Evenly spaced word timings; used for the silent provider."""
    tokens = text.split()
    words, t = [], offset
    for tok in tokens:
        d = (0.12 + 0.045 * len(tok)) * (2.6 / words_per_second)
        words.append(Word(word=tok, start=round(t, 3), end=round(t + d, 3)))
        t += d + 0.04
    return words, t + 0.2


def estimate_spoken(pairs: list[tuple[str, str]], duration: float, offset: float = 0.0) -> list[Word]:
    """Timings for written tokens, spread over `duration` by how long each one takes to say:
    "1992" gets the time of "nineteen ninety-two", but the caption still shows "1992"."""
    cost = [sum(0.12 + 0.045 * len(w) for w in said.split()) + 0.04 for _, said in pairs]
    k = duration / sum(cost) if sum(cost) else 1.0
    words, t = [], offset
    for (written, _), c in zip(pairs, cost):
        d = c * k
        words.append(Word(word=written, start=round(t, 3), end=round(t + d - 0.04 * k, 3)))
        t += d
    return words


def words_from_chars(chars: list[str], starts: list[float], ends: list[float]) -> list[Word]:
    """Collapse ElevenLabs character alignment into words."""
    words: list[Word] = []
    buf, w_start, w_end = "", None, 0.0
    for ch, s, e in zip(chars, starts, ends):
        if ch.isspace():
            if buf:
                words.append(Word(word=buf, start=w_start, end=w_end))
            buf, w_start = "", None
            continue
        if w_start is None:
            w_start = s
        buf += ch
        w_end = e
    if buf:
        words.append(Word(word=buf, start=w_start, end=w_end))
    return words


def _elevenlabs(cfg: Config, text: str, out: Path) -> Clip:
    key = secret("ELEVENLABS_API_KEY")
    if not key:
        raise RuntimeError("ELEVENLABS_API_KEY is not set")
    r = requests.post(
        f"https://api.elevenlabs.io/v1/text-to-speech/{cfg.voice.elevenlabs_voice_id}/with-timestamps",
        params={"output_format": "mp3_44100_128"},
        headers={"xi-api-key": key},
        json={"text": text, "model_id": cfg.voice.elevenlabs_model},
        timeout=180,
    )
    r.raise_for_status()
    body = r.json()
    mp3 = out.with_suffix(".mp3")
    mp3.write_bytes(base64.b64decode(body["audio_base64"]))
    duration = to_wav(mp3, out)
    mp3.unlink()
    a = body["alignment"]
    words = words_from_chars(a["characters"], a["character_start_times_seconds"], a["character_end_times_seconds"])
    return Clip(out, duration, words)


def _edge(cfg: Config, text: str, out: Path) -> Clip:
    import edge_tts

    async def run() -> tuple[bytes, list[Word]]:
        comm = edge_tts.Communicate(text, cfg.voice.edge_voice, rate=cfg.voice.edge_rate, boundary="WordBoundary")
        audio, words = bytearray(), []
        async for chunk in comm.stream():
            if chunk["type"] == "audio":
                audio.extend(chunk["data"])
            elif chunk["type"] == "WordBoundary":
                start = chunk["offset"] / 1e7  # 100ns ticks
                words.append(Word(word=chunk["text"], start=start, end=start + chunk["duration"] / 1e7))
        return bytes(audio), words

    audio, words = asyncio.run(run())
    mp3 = out.with_suffix(".mp3")
    mp3.write_bytes(audio)
    duration = to_wav(mp3, out)
    mp3.unlink()
    return Clip(out, duration, _reattach_punctuation(text, words))


def _reattach_punctuation(text: str, words: list[Word]) -> list[Word]:
    """Edge reports bare words; restore trailing punctuation from the source text
    so captions can break on sentence ends."""
    tokens = text.split()
    if len(tokens) != len(words):
        return words
    return [w.model_copy(update={"word": tok}) for w, tok in zip(words, tokens)]


def _silent(cfg: Config, text: str, out: Path) -> Clip:
    words, duration = estimate_words(text)
    silence_wav(out, duration)
    return Clip(out, duration, words)


def _espeak(cfg: Config, text: str, out: Path) -> Clip:
    """Offline voice via espeak-ng. Robotic, but needs no network or key."""
    exe = shutil.which("espeak-ng") or shutil.which("espeak")
    if not exe:
        raise RuntimeError("espeak-ng is not installed (apt install espeak-ng / brew install espeak-ng)")
    raw = out.with_suffix(".raw.wav")
    spoken = speakable(text)
    subprocess.run([exe, "-v", cfg.voice.espeak_voice, "-s", str(cfg.voice.espeak_wpm), "-w", str(raw), spoken], check=True)
    duration = to_wav(raw, out)
    raw.unlink()
    # espeak reports no word timings; spread the estimate over the real duration.
    pairs = [p for sentence in spoken_sentences(text) for p in sentence]
    return Clip(out, duration, estimate_spoken(pairs, duration))


KOKORO_RELEASE = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0"
KOKORO_FILES = ("kokoro-v1.0.onnx", "voices-v1.0.bin")
_kokoro_model = None


def _kokoro_load(cfg: Config):
    """Load Kokoro once per process, downloading the model files on first use."""
    global _kokoro_model
    if _kokoro_model is None:
        from kokoro_onnx import Kokoro

        d = ROOT / cfg.voice.kokoro_dir
        d.mkdir(parents=True, exist_ok=True)
        for name in KOKORO_FILES:
            path = d / name
            if not path.exists():
                print(f"downloading Kokoro model file {name} ...", flush=True)
                tmp = path.with_suffix(".part")
                with requests.get(f"{KOKORO_RELEASE}/{name}", stream=True, timeout=60) as r:
                    r.raise_for_status()
                    with open(tmp, "wb") as f:
                        for chunk in r.iter_content(1 << 20):
                            f.write(chunk)
                tmp.rename(path)
        _kokoro_model = Kokoro(str(d / KOKORO_FILES[0]), str(d / KOKORO_FILES[1]))
    return _kokoro_model


def _kokoro(cfg: Config, text: str, out: Path) -> Clip:
    """Kokoro-82M, run locally via ONNX: natural voice, free, no API key.

    Kokoro reports no word timings, so each sentence is voiced separately
    (exact sentence boundaries) and words are spread across their sentence.
    Numbers, dates, acronyms and abbreviations are rewritten into words first
    (see fyt.speech); captions keep the written form.
    """
    import numpy as np

    model = _kokoro_load(cfg)
    v = cfg.voice
    pause = np.zeros(int(v.kokoro_sentence_pause * 24000), dtype=np.float32)
    parts, words, t = [], [], 0.0
    for pairs in spoken_sentences(text):
        spoken = join_spoken(pairs)
        if not re.search(r"\w", spoken):
            continue
        samples, sr = model.create(spoken, voice=v.kokoro_voice, speed=v.speed(cfg.format), lang=v.kokoro_lang)
        if parts:
            parts.append(pause)
            t += len(pause) / sr
        dur = len(samples) / sr
        words += estimate_spoken(pairs, dur, offset=t)
        parts.append(samples.astype(np.float32))
        t += dur
    audio = np.concatenate(parts) if parts else np.zeros(2400, dtype=np.float32)
    pcm = (np.clip(audio, -1, 1) * 32767).astype("<i2").tobytes()
    raw = out.with_suffix(".raw.wav")
    with wave.open(str(raw), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(24000)
        w.writeframes(pcm)
    duration = to_wav(raw, out)
    raw.unlink()
    return Clip(out, duration, words)


PROVIDERS = {"kokoro": _kokoro, "elevenlabs": _elevenlabs, "edge": _edge, "espeak": _espeak, "silent": _silent}


def synthesize(cfg: Config, text: str, out: Path, provider: str | None = None) -> Clip:
    text = re.sub(r"\s+", " ", text).strip()
    return PROVIDERS[provider or cfg.voice.provider](cfg, text, out)


def join_clips(clips: list[Clip], gap: float, out: Path) -> list[tuple[float, float]]:
    """Concatenate clips with `gap` seconds between them. Returns (start, end) per clip."""
    spans, t = [], 0.0
    gap_frames = b"\x00\x00" * int(gap * SAMPLE_RATE)
    with wave.open(str(out), "wb") as dst:
        dst.setnchannels(1)
        dst.setsampwidth(2)
        dst.setframerate(SAMPLE_RATE)
        for i, clip in enumerate(clips):
            with wave.open(str(clip.wav)) as src:
                frames = src.readframes(src.getnframes())
            dst.writeframes(frames)
            n = len(frames) // 2
            spans.append((t, t + n / SAMPLE_RATE))
            t += n / SAMPLE_RATE
            if i < len(clips) - 1:
                dst.writeframes(gap_frames)
                t += gap
    return spans
