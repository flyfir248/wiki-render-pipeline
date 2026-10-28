"""Titles and descriptions in other languages (YouTube "localizations").

YouTube shows a viewer the title and description in their own language when the video
has one, and searches in that language can find it. The narration stays English; only
the text around the video is translated. Languages come from `youtube.localize`.
"""

from __future__ import annotations

import re

from pydantic import BaseModel, Field

from fyt import llm
from fyt.config import Config
from fyt.models import Script

NAMES = {
    "es": "Spanish", "pt": "Portuguese (Brazil)", "hi": "Hindi", "fr": "French", "de": "German",
    "it": "Italian", "id": "Indonesian", "ja": "Japanese", "ko": "Korean", "ar": "Arabic",
    "ru": "Russian", "tr": "Turkish", "nl": "Dutch", "pl": "Polish", "vi": "Vietnamese",
}  # fmt: skip
STAMP = re.compile(r"(?m)^\s*(\d{1,2}:\d{2}(?::\d{2})?)\b")
# Credit paragraphs (model and set-piece credits, links) stay as they are, so they aren't sent to be translated:
# on a free tier every token counts, and a video with many 3D models has a long credits list.
CREDITS = re.compile(r"^(3D models:|Set pieces from|Images?:|Music:)|https?://|\bCC[- ]?(BY|0)\b", re.I)


def _credit(paragraph: str) -> bool:
    lines = [x for x in paragraph.splitlines() if x.strip()]
    return bool(lines) and (bool(CREDITS.match(lines[0].strip())) and lines[0].strip().endswith(":") or all(CREDITS.search(x) for x in lines))


class Translation(BaseModel):
    title: str = Field(description="The title in the target language, at most 90 characters.")
    description: str = Field(description="The description in the target language, same layout and line breaks.")


GUIDE = """You translate YouTube titles and descriptions for a {channel} channel about {niche}.
Write natural {language} a native speaker would search for, not a word-for-word copy: keep the title's hook
and curiosity, at most 90 characters. Keep names of people and places, numbers, dates and URLs as they are.
Lines that start with a timestamp such as 0:00 or 4:12 are chapters: keep the timestamp exactly and
translate only the words after it. Leave lines of image credits and source links untranslated.
Never use the characters < or >."""


def _clean(text: str) -> str:
    return text.replace("<", "").replace(">", "").strip()


def translate(cfg: Config, script: Script, languages: list[str] | None = None, log=print) -> dict[str, dict]:
    """{language code: {"title", "description"}} for each configured language that translated cleanly."""
    out: dict[str, dict] = {}
    paragraphs = script.description.strip().split("\n\n")
    kept = [p for p in paragraphs if _credit(p)]
    text = "\n\n".join(p for p in paragraphs if not _credit(p))
    for code in languages if languages is not None else cfg.youtube.localize:
        if code == cfg.channel.language:
            continue
        language = NAMES.get(code, code)
        guide = GUIDE.format(channel=cfg.channel.name, niche=cfg.channel.niche, language=language)
        user = f"Translate into {language}.\n\nTITLE:\n{script.title}\n\nDESCRIPTION:\n{text}"
        try:  # never waits on a rate limit: the video goes up fine without it
            t = llm.structured(llm.helping(cfg), guide, user, Translation, max_tokens=2500, quick=True)
        except Exception as e:  # the video is fine without it
            log(f"warning: no {language} title and description ({e})")
            continue
        title, description = _clean(t.title)[:100], _clean(t.description)
        if not title or not description:
            continue
        if STAMP.findall(script.description) != STAMP.findall(description):
            # Chapters only work when every timestamp survives; drop the chapter lines rather than mislead.
            description = "\n".join(line for line in description.splitlines() if not STAMP.match(line))
            log(f"warning: {language} description lost its chapter times; chapters left out")
        out[code] = {"title": title, "description": "\n\n".join([description, *kept])}
    return out
