"""Storyboard: a picture for every sentence, so the visuals follow the story as it is told.

After the script is voiced, one LLM call plans an illustration for each sentence after the first in
the scenes that carry no diagram of their own (titles, statements, numbers, quotes, footage), and
writes a cast sheet: every recurring person, object and place described once. Each illustration is
drawn in the house style (fyt.artgen) from its description plus the cast entries it uses, so a
character looks much the same from scene to scene. A free vision model then checks each picture
against what it was meant to show, and a picture that fails is drawn once more or left out.

The scene's own graphic (the number, the statement) plays over the first sentence; each later
sentence cuts to its illustration on the word it starts with.
"""

from __future__ import annotations

import base64
import os
import re
from pathlib import Path

import requests
from pydantic import BaseModel, Field

from fyt import artgen, llm
from fyt.config import Config, secret
from fyt.models import RenderBeat, Script, Word

# Scenes whose picture can change with the story. A story scene's first sentence keeps its own
# animated illustration; its later sentences move on to new moments.
BEAT_TYPES = ("title", "statement", "stat", "quote", "broll", "story")
# Scenes that are only words on screen: their first sentence is illustrated too (the captions carry
# the words). The others keep their own graphic, or the video's opening photo, for the first sentence.
FROM_FIRST = ("statement",)
BUDGET = {"short": 6, "long": 20}  # illustrations per video, inside the free daily image allowance


class CastMember(BaseModel):
    name: str = Field(description="Short name used in beats, e.g. 'the inventor', 'the tank', 'Boston harbour'.")
    look: str = Field(
        description="How to draw it every time: era, clothing or materials, colours, distinctive details. "
        "People by role and clothing only, never a real person's likeness."
    )


class Beat(BaseModel):
    scene: int = Field(description="Scene number, as listed.")
    sentence: int = Field(description="Sentence number within that scene, as listed.")
    picture: str = Field(
        description="The illustration shown while this sentence is spoken: one concrete moment, where it is, "
        "who or what is in it and what they are doing, max 40 words. No text or signs in the picture."
    )
    cast: list[str] = Field(default_factory=list, description="Names from the cast sheet that appear in it.")


class Board(BaseModel):
    cast: list[CastMember] = Field(default_factory=list, description="Recurring people, objects and places, 0-6.")
    beats: list[Beat] = Field(default_factory=list)


GUIDE = """You are the storyboard artist of an illustrated documentary channel. Every sentence listed below
gets its own illustration, shown full screen while the narrator says it. Plan them.

- Show what the sentence says is happening, as one concrete moment: a place, the people or things in
  it, what they are doing, the time of day. Make the viewer feel they are watching the story happen.
- Follow the story: consecutive pictures should feel like the same world (same era, places, people).
- First write the cast sheet: each person, object or place that appears in more than one picture,
  described once so every picture draws it the same way. People are described by role, age, clothing
  and era only; never name or depict a real person's face or likeness.
- Pictures must be drawable: no text, signs, numbers, maps, charts or diagrams in them.
- Nothing gory: show tragedy through its aftermath, scale and atmosphere, never injuries or bodies.
- Return exactly one beat per listed sentence, with its scene and sentence numbers."""

SENTENCE = re.compile(r"(?<=[.!?])[\"')\]]*\s+(?=[A-Z0-9\"'(])")


def sentences(text: str) -> list[str]:
    return [s.strip() for s in SENTENCE.split(text.strip()) if s.strip()]


def wanted(script: Script) -> list[tuple[int, int, str]]:
    """(scene index, sentence index, sentence) for every sentence that gets an illustration, 0-based."""
    out = []
    for i, scene in enumerate(script.scenes):
        if scene.type not in BEAT_TYPES:
            continue
        first = 0 if scene.type in FROM_FIRST and i > 0 else 1
        out += [(i, k, s) for k, s in enumerate(sentences(scene.narration)) if k >= first]
    return out


def plan(cfg: Config, script: Script, todo: list[tuple[int, int, str]]) -> Board:
    lines = [f"Story: {script.title}" + (f" -- {script.core_message}" if script.core_message else ""), ""]
    lines += [f"Scene {i + 1}, sentence {k + 1}: {s}" for i, k, s in todo]
    context = " ".join(sc.narration for sc in script.scenes)
    user = "\n".join(lines) + f"\n\nThe whole narration, for context:\n{context[:2500]}"
    return llm.structured(cfg, GUIDE, user, Board, max_tokens=3000)


def sentence_starts(narration: str, words: list[Word], duration: float) -> list[float]:
    """When each sentence starts, in seconds from the start of the scene's audio."""
    parts = sentences(narration)
    counts = [len(p.split()) for p in parts]
    total = sum(counts) or 1
    starts, seen = [], 0
    for n in counts:
        if words and len(words) >= total * 0.8:  # the voice's own word timings line up with the text
            starts.append(words[min(seen, len(words) - 1)].start)
        else:  # no usable timings: assume an even pace
            starts.append(duration * seen / total)
        seen += n
    return starts


def prompt(beat: Beat, cast: dict[str, str]) -> str:
    who = [f"{name} is drawn as {cast[name]}." for name in beat.cast if name in cast]
    return " ".join([f"{beat.picture.strip().rstrip('.')}.", *who, artgen.SCENE_STYLE])


# --- checking each picture ------------------------------------------------------------


class Verdict(BaseModel):
    matches: bool = Field(description="True if the picture clearly shows what it was meant to show.")
    problems: str = Field(default="", description="What is wrong, in a few words, or empty.")


REVIEW = """You check illustrations for a documentary video before it is published. Look at the picture and
compare it with what it was meant to show. Fail it if the main subject or action is missing or wrong,
or if it has any readable text or garbled lettering, distorted or extra limbs, melted faces, gore, or
a real person's recognisable face. Small stylistic differences are fine.
Reply with a single JSON object: {"matches": true or false, "problems": "a few words, or empty"}."""


VISION_HINTS = ("scout", "maverick", "vision", "llava")  # Groq model ids that can read images
CLOUDFLARE_VISION = "@cf/meta/llama-3.2-11b-vision-instruct"
_found: dict[str, str | None] = {}


def _groq_vision_model(cfg: Config, key: str) -> str | None:
    """The configured review model, or with "auto" the first image-reading model Groq lists."""
    if cfg.review_model != "auto":
        return cfg.review_model
    if "model" not in _found:
        try:
            r = requests.get(f"{cfg.llm.base_url.rstrip('/')}/models", headers={"Authorization": f"Bearer {key}"}, timeout=30)
            r.raise_for_status()
            ids = sorted(m["id"] for m in r.json().get("data", []))
            _found["model"] = next((m for hint in VISION_HINTS for m in ids if hint in m.lower()), None)
        except Exception as e:
            print(f"warning: could not list the provider's models: {str(e)[:200]}")
            _found["model"] = None
    return _found["model"]


def _verdict(text: str | dict) -> Verdict:
    if isinstance(text, dict):  # Cloudflare hands back a reply that is JSON already parsed
        return Verdict.model_validate(text)
    m = re.search(r"\{.*\}", text or "", re.S)
    return Verdict.model_validate_json(m.group(0) if m else text)


def _small_jpeg(path: Path) -> bytes:
    from io import BytesIO

    from PIL import Image

    img = Image.open(path).convert("RGB")
    img.thumbnail((640, 640))
    out = BytesIO()
    img.save(out, "JPEG", quality=85)
    return out.getvalue()


def _ask_groq(cfg: Config, key: str, model: str, image: bytes, meant: str) -> Verdict:
    data = base64.b64encode(image).decode()
    body = {
        "model": model,
        "temperature": 0.1,
        "max_tokens": 200,
        "messages": [
            {"role": "system", "content": REVIEW},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": f"Meant to show: {meant}"},
                    {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{data}"}},
                ],
            },
        ],
    }
    r = requests.post(
        f"{cfg.llm.base_url.rstrip('/')}/chat/completions", headers={"Authorization": f"Bearer {key}"}, json=body, timeout=90
    )
    r.raise_for_status()
    return _verdict(r.json()["choices"][0]["message"]["content"])


def _ask_cloudflare(image: bytes, meant: str) -> Verdict:
    account, token = secret("CLOUDFLARE_ACCOUNT_ID"), secret("CLOUDFLARE_API_TOKEN")
    url = f"https://api.cloudflare.com/client/v4/accounts/{account}/ai/run/{CLOUDFLARE_VISION}"
    headers = {"Authorization": f"Bearer {token}"}
    body = {
        "messages": [{"role": "system", "content": REVIEW}, {"role": "user", "content": f"Meant to show: {meant}"}],
        "image": list(image),
        "max_tokens": 200,
    }
    r = requests.post(url, headers=headers, json=body, timeout=90)
    if not r.ok and "agree" in r.text.lower():  # Meta's licence is accepted once per account by sending "agree"
        requests.post(url, headers=headers, json={"prompt": "agree"}, timeout=60)
        r = requests.post(url, headers=headers, json=body, timeout=90)
    r.raise_for_status()
    return _verdict(r.json()["result"]["response"])


def _say_once(message: str) -> None:
    if _found.get("said") != message:
        _found["said"] = message
        print(message)


def review(cfg: Config, path: Path, meant: str) -> Verdict | None:
    """A free vision model's verdict on one picture, or None when no check could be made: a Groq model
    that reads images when the channel writes with Groq, else Cloudflare's, with the image key."""
    if not cfg.review_model:
        return None
    try:
        image = _small_jpeg(path)
        key = os.environ.get(cfg.llm.api_key_env)
        model = _groq_vision_model(cfg, key) if key and cfg.llm.provider == "openai" else None
        if model:
            _say_once(f"pictures checked by {model}")
            return _ask_groq(cfg, key, model, image, meant)
        if secret("CLOUDFLARE_ACCOUNT_ID") and secret("CLOUDFLARE_API_TOKEN"):
            _say_once(f"pictures checked by {CLOUDFLARE_VISION}")
            return _ask_cloudflare(image, meant)
    except Exception as e:  # the check is a safeguard; without it the picture is used as drawn
        print(f"warning: could not check {path.name}: {str(e)[:200]}")
    return None


# --- the whole pass --------------------------------------------------------------------


def make(
    cfg: Config,
    script: Script,
    spans: list[tuple[float, float]],
    clip_words: list[list[Word]],
    public: Path,
    log=print,
) -> dict[int, list[RenderBeat]]:
    """Plan, draw and check the illustrations; returns the beats per scene for the renderer."""
    todo = wanted(script)[: BUDGET[cfg.format]]
    if not todo or not artgen.provider():
        return {}
    board = plan(cfg, script, todo)
    cast = {c.name: c.look for c in board.cast}
    by_key = {(b.scene - 1, b.sentence - 1): b for b in board.beats}
    (public / "art").mkdir(parents=True, exist_ok=True)
    beats: dict[int, list[RenderBeat]] = {}
    drawn = checked = redrawn = dropped = 0
    for i, k, text in todo:
        beat = by_key.get((i, k)) or Beat(scene=i + 1, sentence=k + 1, picture=text)
        name = f"art/beat-{i + 1}-{k + 1}.jpg"
        ask = prompt(beat, cast)
        ok = False
        for attempt in range(2):
            try:
                artgen.generate(ask, cfg.format == "short", seed=31 + 7 * i + k + attempt).save(public / name, quality=90)
                drawn += 1
            except Exception as e:
                log(f"warning: no illustration for scene {i + 1}, sentence {k + 1}: {e}")
                break
            verdict = review(cfg, public / name, beat.picture)
            checked += verdict is not None
            if verdict is None or verdict.matches:
                ok = True
                break
            log(f"scene {i + 1}, sentence {k + 1} redrawn: {verdict.problems or 'did not match'}")
            redrawn += attempt == 0
            ask = f"{ask} Avoid: {verdict.problems}." if verdict.problems else ask
        if not ok:
            dropped += 1
            continue
        start = 0.0 if i == 0 else spans[i][0]
        at = spans[i][0] + sentence_starts(script.scenes[i].narration, clip_words[i], spans[i][1] - spans[i][0])[k]
        # The first sentence's picture opens the scene; a later one cuts in on its first word.
        beats.setdefault(i, []).append(RenderBeat(at=0.0 if k == 0 else round(max(0.3, at - start), 3), src=name))
    log(
        f"storyboard: {sum(len(v) for v in beats.values())} illustrated sentences of {len(todo)} planned, "
        f"{len(cast)} in the cast"
        + (f"; {checked} checked, {redrawn} redrawn, {dropped} left out" if checked or dropped else "")
    )
    return beats
