"""Claude calls: topic ideation, web research, and structured script writing."""

from __future__ import annotations

import json
import os
import time

import anthropic
import requests
from pydantic import BaseModel, ValidationError

from fyt.config import Config
from fyt.models import Script

# Server-side refusal fallbacks: if the primary model declines, the API reroutes
# the same request to a suitable fallback model inside the same call.
FALLBACK_BETA = "server-side-fallback-2026-07-01"
WEB_SEARCH = {"type": "web_search_20260209", "name": "web_search", "max_uses": 8}


class ClaudeError(RuntimeError):
    pass


class RequestTooLarge(ClaudeError):
    """The provider rejected the request as too large (e.g. Groq's free tokens-per-minute cap)."""


def _client() -> anthropic.Anthropic:
    return anthropic.Anthropic(max_retries=4)


def _check(response) -> None:
    if response.stop_reason == "refusal":
        raise ClaudeError(f"Claude declined the request: {response.stop_details}")
    if response.stop_reason == "max_tokens":
        raise ClaudeError("Response hit max_tokens; raise it or shorten the target length.")


def _text(response) -> str:
    return "\n".join(b.text for b in response.content if b.type == "text").strip()


def _openai_structured(cfg: Config, system: str, user: str, schema: type[BaseModel], max_tokens: int = 16000):
    """Structured output from an OpenAI-compatible API (Groq, OpenRouter, Ollama...).

    Asks for JSON matching the schema, validates it, and on a bad answer retries
    with the validation error so the model can correct itself.
    """
    c = cfg.llm
    key = os.environ.get(c.api_key_env)
    if not key and "localhost" not in c.base_url:
        raise ClaudeError(f"{c.api_key_env} is not set")
    system += (
        "\n\nReply with a single JSON object and nothing else. It must match this JSON schema:\n"
        + json.dumps(schema.model_json_schema(), separators=(",", ":"))
    )
    body = {
        "model": c.model,
        "temperature": c.temperature,
        "max_tokens": max_tokens,
        "response_format": {"type": "json_object"},
    }
    if c.reasoning_effort and "gpt-oss" in c.model:
        body["reasoning_effort"] = c.reasoning_effort
    retry_note = ""
    last_error = ""
    for attempt in range(8):
        # A retry resends the same prompt plus a short note, never the rejected reply,
        # so the request doesn't grow past the provider's tokens-per-minute limit.
        messages = [{"role": "system", "content": system}, {"role": "user", "content": user + retry_note}]
        r = requests.post(
            f"{c.base_url.rstrip('/')}/chat/completions",
            headers={"Authorization": f"Bearer {key or 'none'}"},
            json={**body, "messages": messages},
            timeout=300,
        )
        if r.status_code == 429 and attempt < 7:  # free tiers limit tokens per minute
            wait = min(max(float(r.headers.get("retry-after") or 30), 10), 65)
            print(f"rate limited by {c.base_url}; waiting {wait:.0f}s")
            time.sleep(wait)
            continue
        if r.status_code == 413:
            raise RequestTooLarge(f"{c.base_url} returned 413: {r.text[:500]}")
        if r.status_code == 400 and "json_validate_failed" in r.text:
            # Groq rejects replies that aren't valid JSON, e.g. when the model ran out of tokens.
            last_error = r.text[:500]
            print(f"{c.model} did not produce valid JSON; retrying")
            retry_note = "\n\nYour previous reply was not valid JSON. Keep it concise and reply with the JSON object only."
            continue
        if r.status_code >= 400:
            raise ClaudeError(f"{c.base_url} returned {r.status_code}: {r.text[:500]}")
        content = (r.json()["choices"][0]["message"]["content"] or "").strip()
        if content.startswith("```"):  # tolerate a fenced reply
            content = content.strip("`").removeprefix("json").strip()
        try:
            return schema.model_validate_json(content)
        except ValidationError as e:
            last_error = str(e)[:800]
            print(f"{c.model} reply did not match the schema; retrying")
            retry_note = f"\n\nYour previous reply did not match the schema:\n{last_error}\nReply with the corrected JSON object only."
    raise ClaudeError(f"{c.model} did not return valid JSON: {last_error}")


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
    if cfg.llm.provider == "openai":
        ideas = _openai_structured(cfg, "You plan YouTube videos.", prompt, TopicIdeas, max_tokens=4000)
        return [t.strip() for t in ideas.topics if t.strip()][:n]
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
    if cfg.llm.provider == "openai":
        print("note: web research needs Claude; writing from the model's own knowledge")
        return ""
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


SHORT_WORDS = 130  # ~50s at Kokoro's pace

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


WIKI_GUIDE = """
The research notes are a Wikipedia article. Turn it into an original video:
- Pick the single most surprising or intriguing thread in the article and build the video around it;
  don't summarise the article top to bottom.
- Write every sentence in your own words. Never copy or lightly reword sentences from the article.
- Don't say "according to Wikipedia" in the narration.
- Only state facts the article supports.

Visuals: the message ends with a numbered list of "Available images" from the article. For each scene,
set `image` to the number of the image that best shows what the narration is talking about at that
moment (the real person, place or object), or leave it null if none fits. Use each image at most once.
For scenes without an image, set `broll_query` to a concrete stock-footage search for what is being
said. The title scene should show the subject itself whenever an image of it exists.
"""


def write_script(
    cfg: Config, topic: str, notes: str, from_wikipedia: bool = False, images: str = "", feedback: str = ""
) -> Script:
    ch = cfg.channel
    if cfg.format == "short":
        format_line = "YouTube Short, vertical 9:16, under 55 seconds, 5-8 fast scenes"
        words = SHORT_WORDS
    else:
        format_line = f"horizontal 16:9 video, about {cfg.target_minutes:g} minutes"
        words = int(cfg.target_minutes * 150)
    guide = (SCRIPT_GUIDE + (WIKI_GUIDE if from_wikipedia else "")).format(
        name=ch.name,
        niche=ch.niche,
        audience=ch.audience,
        tone=ch.tone,
        language=ch.language,
        format_line=format_line,
        words=words,
    )
    tail = f"\n\nAvailable images:\n{images}" if images else ""
    tail += f"\n\n{feedback}" if feedback else ""

    def user_message(notes: str) -> str:
        return f"Topic: {topic}\n\n<research_notes>\n{notes or '(no research notes; stick to well-established facts)'}\n</research_notes>{tail}"

    if cfg.llm.provider == "openai":
        # Free tiers cap tokens per minute (Groq: 8000, counting max_tokens), so send a
        # slice of long notes and halve it if the request is still too large.
        limit = cfg.llm.max_note_chars
        for attempt in range(3):
            try:
                return _openai_structured(cfg, guide, user_message(notes[:limit]), Script, max_tokens=3000)
            except RequestTooLarge:
                if attempt == 2:
                    raise
                limit //= 2
                print(f"request too large; retrying with {limit} characters of notes")
    user = user_message(notes)
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
                "content": user,
            }
        ],
    ) as stream:
        response = stream.get_final_message()
    _check(response)
    script = response.parsed_output
    if script is None:
        raise ClaudeError("Claude did not return a parsable script.")
    return script
