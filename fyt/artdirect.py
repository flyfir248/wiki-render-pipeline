"""Art direction: each video's own look, kept the same in every scene of it.

A profile sets the background, the second accent and the grade of the 3D scenes (a CSS filter), picked
from what the story is: archival for history before 1950, scientific for science and technology,
cosmic for space, natural for landscapes and weather, noir for dark or tense stories, news for news
explainers and stories told mostly in numbers, and the channel's signature look otherwise. The channel's own accent colour and font stay
in every profile, so videos look like they belong to one channel while each has an identity of its own.
"""

from __future__ import annotations

import re

from fyt import scenes3d
from fyt.models import Script

PROFILES: dict[str, dict[str, str]] = {
    "signature": {},
    "archival": {"background": "#16110b", "background2": "#3a2a18", "accent2": "#e0b070", "muted": "#cdbb9c",
                 "grade": "sepia(0.32) saturate(0.85) contrast(1.05)"},
    "noir": {"background": "#07090f", "background2": "#1c2232", "accent2": "#9fb4d9", "muted": "#a3adc2",
             "grade": "saturate(0.65) contrast(1.12) brightness(0.94)"},
    "scientific": {"background": "#061923", "background2": "#0d3a4a", "accent2": "#5fe0d0", "muted": "#a6c8cf",
                   "grade": "saturate(1.05)"},
    "cosmic": {"background": "#05040f", "background2": "#1d1440", "accent2": "#b28cff", "muted": "#b3acd6",
               "grade": "saturate(1.1) contrast(1.05)"},
    "natural": {"background": "#07140d", "background2": "#1d3a2a", "accent2": "#8fd694", "muted": "#a9c7b2",
                "grade": "saturate(1.08)"},
    "news": {"background": "#0b1020", "background2": "#1b2350", "accent2": "#4dd6ff", "muted": "#a9b3d6", "grade": "none"},
}

CHARTS = ("stat", "bars", "trend", "proportion", "scale", "cycle")
SUBJECT_PROFILE = {"science": "scientific", "technology": "scientific", "space": "cosmic", "rocket": "cosmic", "landscape": "natural"}


def choose(script: Script, news: bool = False) -> str:
    """The profile that suits the story: its 3D subjects, its era, its mood."""
    if news:
        return "news"
    world = [s.subject for s in script.scenes if s.type == "world" and s.subject]
    story = " ".join([script.title] + [s.narration for s in script.scenes])
    charts = sum(1 for s in script.scenes if s.type in CHARTS)
    if charts >= 3 and charts > len(world):  # a story told in numbers takes the data look
        return "news"
    counts = {p: sum(1 for w in world if SUBJECT_PROFILE.get(w) == p) for p in set(SUBJECT_PROFILE.values())}
    best = max(counts, key=counts.get) if counts else None
    if best and counts[best] * 2 >= max(1, len(world)):
        return best
    if not world:  # a story told in charts and photos: read the subject from the words
        for subj, p in SUBJECT_PROFILE.items():
            if scenes3d.count(story, scenes3d.subjects()[subj]["keywords"]) >= 3:
                return p
    year = scenes3d.story_year(story)
    if year is not None and year < 1950:
        return "archival"
    if script.mood in ("somber", "tense"):
        return "noir"
    return "signature"


def era(script: Script) -> str:
    """"historic" for a story set before 1900, so 2D backdrops draw no tower blocks in 1518."""
    year = scenes3d.story_year(" ".join([script.title] + [s.narration for s in script.scenes]))
    return "historic" if year is not None and year < 1900 else "modern"


def theme(base: dict, profile: str, script: Script | None = None) -> dict:
    """The channel theme with the profile laid over it; the accent and font are the channel's own."""
    out = dict(base) | {k: v for k, v in PROFILES.get(profile, {}).items()}
    if script is not None:
        out["era"] = era(script)
    out["profile"] = profile
    out.setdefault("grade", "none")
    return out
