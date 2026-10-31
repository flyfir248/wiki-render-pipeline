"""The What If series: one impossible premise, told as a ladder of escalating time stamps over one 3D world
that keeps changing.

A topic written `whatif:<premise>` ("whatif:the sea rose one metre every day") makes one of these videos.
The premise is grounded in a few Wikipedia articles the model picks (so every number it says can be checked
by the usual fact check), the scriptwriter gets the format's rules below on top of the usual guide, and the
script it returns is normalised so that the on-screen clock only moves forward and the danger bar only rises.
The renderer draws the clock and the bar over every scene (renderer/src/components/WhatIfClock.tsx) and
carries the world's state from scene to scene (a city's water starts where the last scene left it).
"""

from __future__ import annotations

import re

from pydantic import BaseModel, Field

from fyt.models import Script

PREFIX = "whatif:"
SERIES = "What If"
SUBSCRIBE = "Subscribe for more What Ifs"  # the series' own line over a Short's end and the end card

# Original premises to start the queue with: each one a single rule broken, with a ladder of real numbers
# behind it. `fyt topics add "whatif:<premise>"` adds more.
PREMISES = [
    "the sea rose one metre every day",
    "the Moon were twice as close",
    "every night lasted a week",
    "Earth stopped spinning for one hour",
    "all the world's insects vanished tomorrow",
    "your city were 10 degrees hotter, for good",
    "a day were only 20 hours long",
    "the oceans froze from the top down",
]

GUIDE = """THIS VIDEO IS IN THE "WHAT IF" SERIES. It replaces the true-story structure above with this one.
The premise is impossible or hypothetical; everything that follows from it must be real science, real
places and real numbers from the research notes. Never present the premise itself as something that happened.

Shape: a countdown of escalating stages. Each scene is one stage of time after the premise starts.
- Scene 1 asks the premise in the narrator's first words ("What if the sea rose one metre, every single
  day?") and lands the first consequence at once. Its `clock` is the start (e.g. "DAY 0" or "SECOND 0").
- Every scene has a `clock`: a short time stamp in capitals, a unit and a number: "SECOND 1", "MINUTE 10",
  "HOUR 6", "DAY 3", "WEEK 2", "MONTH 4", "YEAR 24". Clocks only move forward, and the gaps grow (seconds,
  then days, then years), so each stage is a bigger jump than the last. Use 6-8 stages in a Short, 12-20
  in a long video. A scene that continues the same stage repeats its clock.
- `clock_note`: what the premise has added up to by then, in 1-3 words with its unit ("+70 m", "-40 °C",
  "2x gravity"), or empty.
- `level`: 0 to 1, how far the world has gone from normal by the end of that scene. It never goes down;
  the last stage is near 1.
- One world carries the video: use `world` scenes of ONE subject and variant for the premise's place (for
  a flood: `city`, variant `modern`, action `flood`), with `subject_name` the same in every one, so the
  viewer watches the same place change. Between them, use stat, scale, proportion or map scenes for the
  numbers, keeping the same `clock`.
- Each stage gives one concrete, checkable fact that makes the jump feel real (a city's height above sea
  level, a population, a record), said in everyday words with what it means.
- The last stage answers the title's question in one plain sentence, and the closing line leads back into
  the opening one, so a replay feels seamless.
- Title: "What If" + the premise, as a question, max 55 characters for a Short ("What If the Sea Rose 1
  Metre Every Day?"). thumbnail_text: the most extreme stage's clock and result in 2-4 words ("DAY 8849:
  NO LAND"). Tone: calm, curious, vivid; no gore, no fear-mongering, no "you will die".
"""


def is_whatif_topic(topic: str) -> bool:
    return topic.strip().lower().startswith(PREFIX)


def premise_of(topic: str) -> str:
    p = topic.strip()[len(PREFIX):].strip() if is_whatif_topic(topic) else topic.strip()
    p = re.sub(r"^what\s+if\s+", "", p, flags=re.I).rstrip(" ?.")
    return p


def title_for(premise: str) -> str:
    """'the sea rose one metre every day' -> 'What If the Sea Rose One Metre Every Day?'"""
    small = {"a", "an", "the", "and", "or", "of", "for", "to", "in", "on", "at", "by", "were", "was"}
    words = premise_of(premise).split()
    out = [w if w.lower() in small or w[:1].isupper() else w[:1].upper() + w[1:] for w in words]
    return f"What If {' '.join(out)}?"


# --- the clock ------------------------------------------------------------------------------------

UNITS = {
    "SECOND": 1, "MINUTE": 60, "HOUR": 3600, "DAY": 86400, "WEEK": 7 * 86400,
    "MONTH": 30.44 * 86400, "YEAR": 365.25 * 86400, "CENTURY": 36525 * 86400,
}
_STAMP = re.compile(r"^\s*(SECOND|MINUTE|HOUR|DAY|WEEK|MONTH|YEAR|CENTURY)S?\s+([\d,]+(?:\.\d+)?)\s*$", re.I)


def clock_seconds(stamp: str | None) -> float | None:
    """How far into the premise a clock stamp is, in seconds; None when it isn't a unit and a number."""
    m = _STAMP.match(stamp or "")
    if not m:
        return None
    return float(m.group(2).replace(",", "")) * UNITS[m.group(1).upper()]


def clean_stamp(stamp: str | None) -> str | None:
    """'day 70' -> 'DAY 70', 'Years 24' -> 'YEAR 24'; anything else is kept as written, in capitals."""
    if not stamp or not stamp.strip():
        return None
    m = _STAMP.match(stamp)
    return f"{m.group(1).upper()} {m.group(2)}" if m else stamp.strip().upper()[:18]


def normalize(script: Script, premise: str | None = None) -> Script:
    """Make the ladder well-formed: every scene carries a clock (a scene without one continues the last),
    levels stay in 0-1 and never fall, and the video is filed in the series. A title that lost its
    'What If' (the polish pass) gets the premise's title back."""
    scenes = []
    clock = note = None
    level = 0.0
    for s in script.scenes:
        if s.clock and s.clock.strip():
            stamp = clean_stamp(s.clock)
            if stamp != clock:
                note = None  # a new stage: last stage's total doesn't carry over
            clock = stamp
        note = s.clock_note.strip() if s.clock_note and s.clock_note.strip() else note
        if s.level is not None:
            level = max(level, min(1.0, max(0.0, float(s.level))))
        scenes.append(s.model_copy(update={"clock": clock, "clock_note": note, "level": round(level, 3)}))
    update: dict = {"scenes": scenes, "series": SERIES}
    if premise and not script.title.lower().startswith("what if"):
        update["title"] = title_for(premise)
    return script.model_copy(update=update)


def problems(script: Script) -> list[str]:
    """What keeps a script from working as a What If video."""
    out = []
    if not script.title.lower().startswith("what if"):
        out.append("a What If title starts with 'What If'")
    if not script.scenes or not script.scenes[0].clock:
        out.append("the first scene needs a clock stamp")
    stamps = [s.clock for s in script.scenes if s.clock]
    stages = list(dict.fromkeys(stamps))
    if len(stages) < 4:
        out.append(f"only {len(stages)} clock stages; the ladder needs at least 4")
    seconds = [clock_seconds(c) for c in stages]
    known = [t for t in seconds if t is not None]
    if any(b <= a for a, b in zip(known, known[1:])):
        out.append("the clock goes backwards or stands still between stages: " + " -> ".join(stages))
    levels = [s.level for s in script.scenes if s.level is not None]
    if any(b < a for a, b in zip(levels, levels[1:])):
        out.append("the danger level falls between scenes")
    return out


# --- grounding ------------------------------------------------------------------------------------


class Grounding(BaseModel):
    articles: list[str] = Field(
        description="3-5 exact English Wikipedia article titles whose facts a video on this premise needs: "
        "the science behind it and the real places or records its stages name."
    )


GROUNDING_GUIDE = """You research a hypothetical "What if" video. The premise is impossible, but every
consequence the video describes must use real facts. Name the English Wikipedia articles that hold those
facts: the science of what changes, and the real places, heights, populations or records the escalating
stages will use. Exact article titles only."""


def grounding(cfg, premise: str, limit_chars: int = 6000) -> str:
    """Research notes for a premise: the Wikipedia articles a model names for it, fetched and cut down,
    so the scriptwriter has real numbers and the fact check has something to check them against."""
    from fyt import llm, wiki

    picked = llm.structured(llm.helping(cfg), GROUNDING_GUIDE, f"Premise: what if {premise_of(premise)}?", Grounding, max_tokens=600)
    notes = []
    for title in picked.articles[:5]:
        try:
            article = wiki.fetch_article(cfg, title)
        except Exception as e:  # a title that isn't there: the others still ground it
            print(f"what-if grounding: no article {title!r} ({e})")
            continue
        notes.append(wiki.notes(article)[:limit_chars])
    return "\n\n".join(notes)
