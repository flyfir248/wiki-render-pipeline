"""Fact check: every number, date, name and quote in a script, said or shown, against the source notes.

The scriptwriter only sees a slice of the article and writes at a high temperature, so it can round a
figure, swap a date or borrow a number from memory. Before a video is voiced, each scene is checked
against the passages of the article that mention the same things. Wrong or unsupported claims are
rewritten from the article once; whatever still fails stops the video before it can upload.
"""

from __future__ import annotations

import json
import re
from typing import Callable, Literal

from pydantic import BaseModel, Field

from fyt import llm, titles
from fyt.config import Config
from fyt.models import DataPoint, DialogueLine, Script, ScriptScene, TimelineEvent

# Scene fields that carry facts a viewer reads or hears. Layout and art fields can't be wrong.
FACT_FIELDS = (
    "narration", "heading", "text", "items", "value", "prefix", "suffix", "data", "events",
    "left_title", "left", "right_title", "right", "author", "lines", "year_from", "year_to",
)
BATCH = 8  # scenes per check: keeps a long video's requests under free-tier token limits
STOP = set(
    "the and for that with this was were are from his her their its into which when what who they them "
    "than then there have has had been but not all one two about after before over under also only more "
    "most some such would could will can just like even still very much many what where while".split()
)


class Claim(BaseModel):
    scene: int = Field(description="Scene number the claim is in (0 for the title or thumbnail text).")
    claim: str = Field(description="The claim, quoted or closely paraphrased from the script.")
    verdict: Literal["supported", "wrong", "unsupported"]
    correction: str = Field(default="", description="What the source actually says, quoted, when wrong.")


class FactCheck(BaseModel):
    claims: list[Claim] = Field(description="Only the claims that are wrong or unsupported; empty if every claim checks out.")


class SceneFacts(BaseModel):
    """The fact-bearing part of a scene, as the fixer returns it."""

    narration: str
    heading: str | None = None
    text: str | None = None
    items: list[str] | None = None
    value: float | None = None
    prefix: str | None = None
    suffix: str | None = None
    data: list[DataPoint] | None = None
    events: list[TimelineEvent] | None = None
    left_title: str | None = None
    left: list[str] | None = None
    right_title: str | None = None
    right: list[str] | None = None
    author: str | None = None
    lines: list[DialogueLine] | None = None
    year_from: int | None = None
    year_to: int | None = None


class TitleFacts(BaseModel):
    title: str
    thumbnail_text: str


CHECK_GUIDE = """You are the fact checker for a YouTube channel that tells true stories. Check every factual
claim in the script below against the source passages: numbers, dates, durations, distances, counts,
names, places, quotes and who said them, and cause and effect. Check both what the narrator says and
what is shown on screen (headings, chart values, labels, list items, timeline dates).
- wrong: the source says something different (a different number, date, name, place or order of events).
  Rounding that keeps the meaning is fine ("about 36,000" for 36,417); changing it is not ("two thirds"
  for "over 70%" is wrong).
- unsupported: a specific number, date, name or quote that the source passages don't contain and that
  isn't widely known general knowledge (the year of World War II or the yield of the Hiroshima bomb is
  general knowledge; an exact casualty count or a person's words are not).
Don't flag opinions, framing, or the storyteller's own words ("strange", "nobody expected").
Return only the wrong and unsupported claims. If everything checks out, return an empty list."""

FIX_GUIDE = """You are the fact checker for a YouTube channel that tells true stories. The scene below has
claims that are wrong or not backed by the source. Rewrite it so every claim matches the source passages:
use the source's figure, date or name, or drop a claim the source doesn't back. Change the on-screen fields
too, so what is shown always matches what is said. Keep everything else as it is: the same fields, the same
length within a few words, the same voice and the same place in the story. Narration is read aloud, so
write numbers as the narrator should say them, as the original does."""

TITLE_GUIDE = """You are the fact checker for a YouTube channel that tells true stories. The video's title or
thumbnail text makes a claim the source doesn't back. Rewrite only what is needed so it is true to the
source passages, keeping it as short and curious as it is, in plain words with the subject named near the
start. Title max 70 characters (55 for a Short), thumbnail text 2-5 words."""


def _strict(cfg: Config) -> Config:
    """A checker should be consistent, not creative."""
    return cfg.model_copy(update={"llm": cfg.llm.model_copy(update={"temperature": 0.1})})


def scene_facts(scene: ScriptScene) -> dict:
    """The scene's claim-bearing fields that are set."""
    out = {}
    for k in FACT_FIELDS:
        v = getattr(scene, k)
        if v is None or v == [] or v == "":
            continue
        out[k] = [x.model_dump() if isinstance(x, BaseModel) else x for x in v] if isinstance(v, list) else v
    return out


def passages(notes: str, size: int = 700) -> list[str]:
    """The notes cut into paragraph-sized passages, long paragraphs split at sentence ends."""
    out = []
    for para in re.split(r"\n\s*\n|\n(?=#)", notes):
        para = para.strip()
        while len(para) > size:
            cut = para.rfind(". ", 0, size)
            cut = size if cut < size // 3 else cut + 1
            out.append(para[:cut].strip())
            para = para[cut:].strip()
        if para:
            out.append(para)
    return out


def _numbers(text: str) -> set[str]:
    """Figures written in digits, without separators ("36,417" -> "36417")."""
    nums = {n.replace(",", "") for n in re.findall(r"\d[\d,]*(?:\.\d+)?", text)}
    nums = {n.rstrip("0").rstrip(".") if "." in n else n for n in nums}
    return {n for n in nums if n}


def _terms(text: str) -> set[str]:
    words = {w for w in re.findall(r"[a-z][a-z'-]+", text.lower()) if len(w) > 2 and w not in STOP}
    return {w[:-1] if w.endswith("s") and len(w) > 4 else w for w in words}


def evidence(query: str, chunks: list[str], budget: int) -> str:
    """The passages that share the most numbers and words with the query, in article order, within budget chars."""
    q_nums, q_terms = _numbers(query), _terms(query)
    scored = []
    for i, c in enumerate(chunks):
        nums, terms = _numbers(c), _terms(c)
        # A shared figure is the strongest sign a passage is about the claim; prefixes catch "36,000" vs 36417.
        num_hits = sum(1 for n in q_nums if n in nums or (len(n) >= 3 and any(m.startswith(n[:2]) and len(m) == len(n) for m in nums)))
        score = 4 * num_hits + len(q_terms & terms)
        if score:
            scored.append((score, i))
    picked, used = [], 0
    for score, i in sorted(scored, reverse=True):
        if used + len(chunks[i]) > budget:
            continue
        picked.append(i)
        used += len(chunks[i])
    if chunks and 0 not in picked and used + len(chunks[0]) <= budget:
        picked.append(0)  # the lead says what the subject is
    return "\n\n".join(chunks[i] for i in sorted(picked))


def _script_text(scenes: list[tuple[int, ScriptScene]], title: Script | None = None) -> str:
    lines = []
    if title is not None:
        lines.append(f"Scene 0 (title and thumbnail): {json.dumps({'title': title.title, 'thumbnail_text': title.thumbnail_text}, ensure_ascii=False)}")
    for i, s in scenes:
        lines.append(f"Scene {i} ({s.type}): {json.dumps(scene_facts(s), ensure_ascii=False)}")
    return "\n".join(lines)


def check(cfg: Config, script: Script, notes: str, only: set[int] | None = None) -> list[Claim]:
    """The wrong and unsupported claims in the script (scene numbers from 1; 0 is the title)."""
    chunks = passages(notes)
    budget = cfg.llm.max_note_chars
    numbered = [(i, s) for i, s in enumerate(script.scenes, 1) if only is None or i in only]
    claims: list[Claim] = []
    # range(0, 1) when only the title is re-checked, so that batch still runs with no scenes.
    for start in range(0, max(len(numbered), 1), BATCH):
        batch = numbered[start : start + BATCH]
        with_title = start == 0 and (only is None or 0 in only)
        text = _script_text(batch, script if with_title else None)
        source = evidence(text, chunks, budget)
        user = f"<source>\n{source or '(no source text)'}\n</source>\n\n<script>\n{text}\n</script>"
        result = llm.structured(_strict(cfg), CHECK_GUIDE, user, FactCheck, max_tokens=2500)
        allowed = {i for i, _ in batch} | ({0} if with_title else set())
        claims += [c for c in result.claims if c.verdict != "supported" and c.scene in allowed]
    return claims


def _fix_scene(cfg: Config, scene: ScriptScene, claims: list[Claim], source: str) -> ScriptScene:
    facts = scene_facts(scene)
    problems = "\n".join(f"- {c.verdict}: {c.claim}" + (f" (source: {c.correction})" if c.correction else "") for c in claims)
    user = (
        f"<source>\n{source}\n</source>\n\nProblems:\n{problems}\n\n"
        f"Scene ({scene.type}), fields to return: {json.dumps(facts, ensure_ascii=False)}"
    )
    fixed = llm.structured(_strict(cfg), FIX_GUIDE, user, SceneFacts, max_tokens=2000)
    if not fixed.narration.strip():
        raise ValueError("the fixed scene has no narration")
    # Only the fields the scene had: a fix may change a figure, not turn a chart into another kind of scene.
    update = {k: getattr(fixed, k) for k in facts}
    return scene.model_copy(update=update)


def _fix_title(cfg: Config, script: Script, claims: list[Claim], source: str) -> Script:
    problems = "\n".join(f"- {c.claim}" + (f" (source: {c.correction})" if c.correction else "") for c in claims)
    user = f"<source>\n{source}\n</source>\n\nProblems:\n{problems}\n\nTitle: {script.title}\nThumbnail text: {script.thumbnail_text}"
    fixed = llm.structured(_strict(cfg), TITLE_GUIDE, user, TitleFacts, max_tokens=800)
    return script.model_copy(update={"title": titles.clean(fixed.title)[:100], "thumbnail_text": fixed.thumbnail_text.strip()})


def describe(claims: list[Claim]) -> list[str]:
    return [
        f"scene {c.scene}: {c.verdict} claim \"{c.claim}\"" + (f" (source says: {c.correction})" if c.correction else "")
        for c in claims
    ]


def verify(cfg: Config, script: Script, notes: str, log: Callable[[str], None] = print) -> tuple[Script, list[str]]:
    """Check the script, fix what is wrong once, and re-check the fixed scenes.

    Returns the script and the claims that still fail (empty when it is safe to publish).
    """
    claims = check(cfg, script, notes)
    if not claims:
        return script, []
    log("fact check found: " + "; ".join(describe(claims)))
    chunks = passages(notes)
    scenes = list(script.scenes)
    flagged = sorted({c.scene for c in claims})
    for i in flagged:
        mine = [c for c in claims if c.scene == i]
        if i == 0:
            source = evidence(script.title + " " + script.thumbnail_text + " " + " ".join(c.claim for c in mine), chunks, cfg.llm.max_note_chars)
            script = _fix_title(cfg, script, mine, source)
            continue
        query = json.dumps(scene_facts(scenes[i - 1]), ensure_ascii=False) + " " + " ".join(c.claim + " " + c.correction for c in mine)
        source = evidence(query, chunks, cfg.llm.max_note_chars)
        scenes[i - 1] = _fix_scene(cfg, scenes[i - 1], mine, source)
    script = script.model_copy(update={"scenes": scenes})
    remaining = check(cfg, script, notes, only=set(flagged))
    return script, describe(remaining)
