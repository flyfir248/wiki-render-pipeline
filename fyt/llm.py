"""Claude calls: topic ideation, web research, and structured script writing."""

from __future__ import annotations

import anthropic
from pydantic import BaseModel

from fyt.config import Config
from fyt.models import Script

# Server-side refusal fallbacks: if the primary model declines, the API reroutes
# the same request to a suitable fallback model inside the same call.
FALLBACK_BETA = "server-side-fallback-2026-07-01"
WEB_SEARCH = {"type": "web_search_20260209", "name": "web_search", "max_uses": 8}


class ClaudeError(RuntimeError):
    pass


def _client() -> anthropic.Anthropic:
    return anthropic.Anthropic(max_retries=4)


def _check(response) -> None:
    if response.stop_reason == "refusal":
        raise ClaudeError(f"Claude declined the request: {response.stop_details}")
    if response.stop_reason == "max_tokens":
        raise ClaudeError("Response hit max_tokens; raise it or shorten the target length.")


def _text(response) -> str:
    return "\n".join(b.text for b in response.content if b.type == "text").strip()


class TopicIdeas(BaseModel):
    topics: list[str]


def ideate_topics(cfg: Config, n: int, avoid: list[str], performance_notes: str = "") -> list[str]:
    """Propose fresh video topics for the channel, skipping ones already covered."""
    ch = cfg.channel
    prompt = f"""You plan videos for a faceless YouTube channel.

Channel niche: {ch.niche}
Audience: {ch.audience}
Format: {"YouTube Shorts (under 60 seconds)" if cfg.format == "short" else f"~{cfg.target_minutes:g} minute videos"}

Propose {n} specific video topics. Each must be:
- specific (a single concrete question or story, not a broad subject)
- searchable (something people actually look up) or strongly curiosity-driven
- explainable with data, charts, timelines, lists or comparisons (our visuals are motion graphics)
- factual and verifiable; no medical/financial advice framed as instructions

Already covered or queued -- do not repeat or closely paraphrase:
{chr(10).join(f"- {t}" for t in avoid) or "- (none yet)"}
{f"{chr(10)}What has performed well so far:{chr(10)}{performance_notes}" if performance_notes else ""}
Return one topic per entry, phrased as a working title."""
    response = _client().beta.messages.parse(
        model=cfg.model,
        max_tokens=16000,
        betas=[FALLBACK_BETA],
        fallbacks="default",
        output_config={"effort": "medium"},
        output_format=TopicIdeas,
        messages=[{"role": "user", "content": prompt}],
    )
    _check(response)
    return [t.strip() for t in response.parsed_output.topics if t.strip()][:n]


def research(cfg: Config, topic: str) -> str:
    """Gather facts, figures and sources for the topic using web search."""
    messages: list = [
        {
            "role": "user",
            "content": f"""Research this YouTube video topic: "{topic}"

Search the web and produce research notes for a scriptwriter:
- the core explanation, in plain language
- 8-15 concrete, verifiable facts, each with a number/date/name where possible and its source URL
- numeric series that could become a bar chart (label + value, with units and source)
- a few dated events for a timeline, if relevant
- one or two real, verified quotes with attribution, if any exist (never invent quotes)
- common misconceptions worth correcting
- a surprising angle or hook that would make someone click and keep watching

Prefer primary and reputable sources. Flag anything uncertain.""",
        }
    ]
    client = _client()
    # Server-side tool turns can pause; resume by sending the partial turn back.
    for _ in range(5):
        with client.beta.messages.stream(
            model=cfg.model,
            max_tokens=32000,
            betas=[FALLBACK_BETA],
            fallbacks="default",
            thinking={"type": "adaptive"},
            output_config={"effort": "medium"},
            tools=[WEB_SEARCH],
            messages=messages,
        ) as stream:
            response = stream.get_final_message()
        if response.stop_reason != "pause_turn":
            break
        messages.append({"role": "assistant", "content": response.content})
    _check(response)
    return _text(response)


SCRIPT_GUIDE = """Write the complete script for a faceless YouTube video. The narration is read by a
text-to-speech voice and each scene is rendered as an animated motion-graphics template.

Channel: {name} -- {niche}
Audience: {audience}
Tone: {tone}
Language: {language}
Format: {format_line}
Target narration length: about {words} words in total across all scenes.

Scene templates (field names in brackets):
- title: opening title card [heading, text]
- statement: kinetic typography of a key sentence [text, optional heading]
- stat: one big number that counts up [value, prefix, suffix, heading, text]
- bars: animated bar chart [heading, data (2-7 points, real numbers only), optional text]
- list: numbered points [heading, items (2-5, max ~6 words each)]
- quote: a real, verifiable quote [text, author]
- timeline: dated events [heading, events (3-5, label = year/date)]
- comparison: two columns [heading, left_title, left, right_title, right]
- broll: stock footage with a caption [broll_query (concrete, filmable), heading]

Rules:
- The first scene's narration is the hook: create curiosity or tension within the first 2 sentences.
  No "welcome back", no "in this video we will".
- Each scene's narration is 1-4 sentences and matches what is on screen at that moment.
- Vary the templates; don't use the same template more than twice in a row. Use data-driven templates
  (stat, bars, timeline, comparison) wherever the research supports them -- they are what makes this
  channel different from generic stock-footage channels.
- Only use numbers, dates and quotes that appear in the research notes. If unsure, don't state it.
- On-screen text must be short and scannable; the narration carries the detail.
- End with a satisfying conclusion and one natural line inviting viewers to subscribe for similar topics.
- Title max 70 characters; no false clickbait. Description must be accurate.
- List the sources you relied on.
"""


def write_script(cfg: Config, topic: str, notes: str) -> Script:
    ch = cfg.channel
    if cfg.format == "short":
        format_line = "YouTube Short, vertical 9:16, under 55 seconds, 5-8 fast scenes"
        words = 130
    else:
        format_line = f"horizontal 16:9 video, about {cfg.target_minutes:g} minutes"
        words = int(cfg.target_minutes * 150)
    guide = SCRIPT_GUIDE.format(
        name=ch.name,
        niche=ch.niche,
        audience=ch.audience,
        tone=ch.tone,
        language=ch.language,
        format_line=format_line,
        words=words,
    )
    with _client().beta.messages.stream(
        model=cfg.model,
        max_tokens=48000,
        betas=[FALLBACK_BETA],
        fallbacks="default",
        thinking={"type": "adaptive"},
        output_config={"effort": "high"},
        output_format=Script,
        system=guide,
        messages=[
            {
                "role": "user",
                "content": f"Topic: {topic}\n\n<research_notes>\n{notes or '(no research notes; stick to well-established facts)'}\n</research_notes>",
            }
        ],
    ) as stream:
        response = stream.get_final_message()
    _check(response)
    script = response.parsed_output
    if script is None:
        raise ClaudeError("Claude did not return a parsable script.")
    return script
