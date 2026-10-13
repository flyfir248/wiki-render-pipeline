"""Claude calls: topic ideation, web research, and structured script writing."""

from __future__ import annotations

import json
import os
import time
from datetime import datetime, timezone

import anthropic
import requests
from pydantic import BaseModel, Field, ValidationError

from fyt.config import Config
from fyt.models import MOOD_HELP, Chapter, Mood, Script, ScriptScene

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
    with the validation error so the model can correct itself. If the model keeps
    failing, tries each of `llm.fallback_models` in turn.
    """
    models = [cfg.llm.model, *cfg.llm.fallback_models]
    for i, model in enumerate(models):
        try:
            return _openai_structured_once(cfg, model, system, user, schema, max_tokens)
        except RequestTooLarge:
            raise  # the caller shrinks the request
        except ClaudeError as e:
            if i == len(models) - 1:
                raise
            print(f"{model} failed ({str(e)[:200]}); trying {models[i + 1]}")
    raise AssertionError("unreachable")


def _openai_structured_once(
    cfg: Config, model: str, system: str, user: str, schema: type[BaseModel], max_tokens: int
):
    c = cfg.llm
    key = os.environ.get(c.api_key_env)
    if not key and "localhost" not in c.base_url:
        raise ClaudeError(f"{c.api_key_env} is not set")
    system += (
        "\n\nReply with a single JSON object and nothing else. It must match this JSON schema:\n"
        + json.dumps(schema.model_json_schema(), separators=(",", ":"))
    )
    body = {
        "model": model,
        "temperature": c.temperature,
        "max_tokens": max_tokens,
        "response_format": {"type": "json_object"},
    }
    if c.reasoning_effort and "gpt-oss" in model:
        body["reasoning_effort"] = c.reasoning_effort
    retry_note = ""
    last_error = ""
    for attempt in range(8):
        # A retry resends the same prompt plus a short note, never the rejected reply,
        # so the request doesn't grow past the provider's tokens-per-minute limit.
        messages = [{"role": "system", "content": system}, {"role": "user", "content": user + retry_note}]
        try:
            r = requests.post(
                f"{c.base_url.rstrip('/')}/chat/completions",
                headers={"Authorization": f"Bearer {key or 'none'}"},
                json={**body, "messages": messages},
                timeout=300,
            )
        except requests.RequestException as e:  # dropped connection or timeout
            last_error = str(e)[:500]
            print(f"request to {c.base_url} failed ({e}); retrying")
            time.sleep(min(10 * (attempt + 1), 60))
            continue
        if r.status_code >= 500 and attempt < 7:  # provider hiccup
            last_error = f"{r.status_code}: {r.text[:300]}"
            print(f"{c.base_url} returned {r.status_code}; retrying")
            time.sleep(min(10 * (attempt + 1), 60))
            continue
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
            print(f"{model} did not produce valid JSON; retrying")
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
            print(f"{model} reply did not match the schema; retrying")
            retry_note = f"\n\nYour previous reply did not match the schema:\n{last_error}\nReply with the corrected JSON object only."
    raise ClaudeError(f"{model} did not return a valid answer: {last_error}")


def structured(cfg: Config, system: str, user: str, schema: type[BaseModel], max_tokens: int = 3000):
    """A small structured answer from whichever provider the channel uses."""
    if cfg.llm.provider == "openai":
        return _openai_structured(cfg, system, user, schema, max_tokens=max_tokens)
    response = _client().beta.messages.parse(
        model=cfg.model,
        max_tokens=max(max_tokens, 8000),
        betas=[FALLBACK_BETA],
        fallbacks="default",
        output_config={"effort": "medium"},
        output_format=schema,
        system=system,
        messages=[{"role": "user", "content": user}],
    )
    _check(response)
    if response.parsed_output is None:
        raise ClaudeError("Claude did not return a parsable answer.")
    return response.parsed_output


class Tightened(BaseModel):
    narrations: list[str] = Field(description="The new narration for each scene, in the same order, one per scene.")


TIGHTEN_GUIDE = """You are the editor of a YouTube Short. The script runs too long: viewers swipe away before
the payoff. Cut it to about {words} words of narration in total, keeping every scene and its order.
- Keep the hook (scene 1) and the payoff (the last scene) as strong as they are.
- Keep the story followable: keep the lines that say who or what this is and why the hook is true, and
  every link that explains how one scene leads to the next. Cut side facts and repetition instead.
- Cut whole clauses rather than squeezing words; every sentence must still read naturally aloud.
- Change no facts and add none. Keep any line that leads back into the opening, or that says part two is next.
Return exactly {n} narrations, one per scene."""


def tighten(cfg: Config, script: Script, words: int | None = None) -> Script:
    """Shorten a Short's narration scene by scene, keeping its scenes and visuals."""
    n = len(script.scenes)
    current = sum(len(s.narration.split()) for s in script.scenes)
    words = min(words or SHORT_WORDS, current * 9 // 10)  # always shorter than it is now
    user = "\n".join(f"Scene {i} ({s.type}): {s.narration}" for i, s in enumerate(script.scenes, 1))
    t = structured(cfg, TIGHTEN_GUIDE.format(words=words, n=n), user, Tightened, max_tokens=2000)
    lines = [x.strip() for x in t.narrations]
    if len(lines) != n or not all(lines):
        raise ValueError(f"expected {n} narrations, got {len(lines)}")
    scenes = [sc.model_copy(update={"narration": line}) for sc, line in zip(script.scenes, lines)]
    return script.model_copy(update={"scenes": scenes})


class Mended(BaseModel):
    problems: list[str] = Field(description="Each place a first-time viewer would get lost, or empty if none.")
    narrations: list[str] = Field(description="The narration for each scene, in the same order, fixed where needed.")


MEND_GUIDE = """You are the story editor of a YouTube Short. Read the script as a viewer who has never heard
of the subject, hearing it once at speed with no way to rewind. List every place they would get lost:
- a person, place or thing used before it was introduced, or never explained
- a jump to a different topic with no link to what came before
- a hook whose claim the rest of the script never explains
- a payoff that doesn't answer what the script set up (unless the script ends by saying part two is
  next: then the open question is meant to stay open)
- a sentence that contradicts or repeats another
If there are none, return no problems and the narrations exactly as they are.
Otherwise rewrite only the lines that need it to fix those problems: add a short link or a few words of
context, reorder within a scene, or drop the stray fact. Keep every scene and its order, keep each scene
about what it shows now, keep the total length about the same ({words} words, never over {limit}), use
only facts already in the script, and keep the narrator's voice. Keep any line that leads back into the
opening, or that says part two is next. Sentences of 6-16 words, written for the ear.
Return exactly {n} narrations, one per scene."""


def mend(cfg: Config, script: Script) -> tuple[Script, list[str]]:
    """Check a Short tells one followable story; fix the lines where a first-time viewer would get lost."""
    n = len(script.scenes)
    words = sum(len(s.narration.split()) for s in script.scenes)
    user = (f"Core message: {script.core_message}\n\n" if script.core_message else "") + "\n".join(
        f"Scene {i} ({s.type}{': ' + s.heading if s.heading else ''}): {s.narration}"
        for i, s in enumerate(script.scenes, 1)
    )
    guide = MEND_GUIDE.format(words=words, limit=max(words, SHORT_MAX_WORDS), n=n)
    m = structured(cfg, guide, user, Mended, max_tokens=2500)
    problems = [p.strip() for p in m.problems if p.strip()]
    if not problems:
        return script, []
    lines = [x.strip() for x in m.narrations]
    if len(lines) != n or not all(lines):
        raise ValueError(f"expected {n} narrations, got {len(lines)}")
    if sum(len(x.split()) for x in lines) > max(words, SHORT_MAX_WORDS):
        raise ValueError("the fixed script ran too long")
    scenes = [sc.model_copy(update={"narration": line}) for sc, line in zip(script.scenes, lines)]
    return script.model_copy(update={"scenes": scenes}), problems


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


SHORT_WORDS = 130  # about 50 seconds at the Shorts reading speed (110 words ran 44s): room to explain the story
SHORT_MAX_WORDS = 150  # about a minute: longer gets tightened
SHORT_MIN_WORDS = 105  # under about 40 seconds there is no room for context: shorter gets rewritten

SHORT_STRUCTURE = """Structure of a Short (45-55 seconds, 6-8 scenes; viewers decide in the first second whether to swipe):
1. Hook (scene 1, max 12 words): the strangest concrete fact, stated flatly. The viewer must know
   at once what this is about. No "welcome back", no "in this video", no "did you know", no question.
   Scene 1 is a `title` scene shown over a photo of the subject: its heading is the hook in 2-5 big
   words (e.g. "Watch it with your eyes shut"), never just the topic's name. Leave its text empty.
2. Context (1-2 scenes): who or what this is, where and when, in plain words, so a viewer who has
   never heard of it can follow. Explain the hook here: why is that strange fact true?
3. Build (2-3 scenes): each one follows from the one before ("so", "but", "then") and escalates
   with a new, stranger or higher-stakes detail of the same thread.
4. Payoff (1 scene): the twist or answer, saying the core message in plain words.
5. End on the payoff. No subscribe line, no "thanks for watching", no question to the audience:
   Shorts replay automatically, and a clean ending makes the replay seamless.
One thread only: tell one story from start to finish, not a list of facts about the subject.
Introduce every person, place and object before relying on it, and never jump to a new topic
(an unexplained "flight", a different discovery, a later career) without saying how it connects.
Read it back as a stranger would: if any sentence would make them ask "wait, what?", fix it."""

LONG_STRUCTURE = """Structure (always the same shape, so every video feels like the same show):
1. Hook: the single strangest fact or question, in the first 2 sentences, and a promise of what the
   viewer will understand by the end. No "welcome back", no "in this video we will", no "did you know".
2. Setup: who, where and when, in plain terms.
3. The story: what happened, in order, each scene adding one new fact. End each chapter on an open
   question the next chapter answers, so there is always a reason to keep watching.
4. The payoff: the detail that makes it worth telling, stated as the core message.
5. Close: one line on why it still matters, then one natural line inviting viewers to subscribe."""

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
- map: an animated map that flies to real places and draws a route between them [heading, places
  (1-4, each name + lat + lon in degrees, in the order of travel), route (true to draw the journey)].
  Use it whenever the story moves between places or where something is matters. For a journey, set
  `vehicle` (plane, ship, car, train, walk, or army for a military campaign) and the camera follows it
  across a tilted map, stopping at each place. For territory (an empire, an alliance, where something
  spread), set `regions` (1-6 present-day country names) and `region_change` (appear, spread, shrink,
  fade); places are optional then. When time passes on the map, set `year_from` and `year_to` (negative
  for BC) and a year counter runs.
- process: how one thing led to another, as connected steps [heading, items (2-5, max ~5 words each)]
- document: a line from a real report, letter, ruling or newspaper, highlighted [heading = what the
  document is, text = the line (max ~20 words), author = source and year]. For a reveal, wrap the 1-3
  words that matter most in [square brackets]: they start blacked out, like a declassified file, and
  are uncovered one by one.
- story: an animated 2D illustration that acts out what the narration describes, like a cartoon
  explainer [heading (optional), setting (sky, night, space, sea, city, countryside, desert, snow, room,
  road), actors (1-5 things on stage: thing = plain concrete noun, x/y position 0-100 with y=100 the
  ground, size s/m/l, optional to_x/to_y to move it, enter, action, at = when it appears 0-0.8, label),
  effect (explosion, fire, smoke, lightning, sparkles, rain, snow) with effect_x/effect_y/effect_at].
  Each scene is illustrated for this story in a flat 2D style: set `backdrop` to the specific place
  (era, landmarks, time of day) and give each actor a `look` that fits the story (era, colours,
  condition). Keep `thing` a plain noun too (airplane, rocket, ship, police car, house, money bag,
  envelope, skull, dog, man, woman, scientist, pilot, judge), used if a drawing can't be made.
  Describe people only by role and clothing; never ask for a real person's likeness.
  Show the action: the ship sails from left to right, the plane climbs then shakes, the money moves
  from one person to another, the explosion goes off at the moment the narration says so.
- evidence: an investigator's board for a mystery, crime or unexplained event: clue cards are pinned one
  by one and joined with red string, then an optional stamp lands [heading = the case name, items (2-5
  clues, max ~5 words each, each a real documented fact), text = a 1-2 word stamp such as Unsolved or
  Classified, only if true]. Use it where the story lays out the clues that don't add up.
- dialogue: a real recorded exchange, typed out like a transcript [heading, lines (2-4, speaker + exact
  words)]. Only for words that were actually recorded or documented; never invent dialogue.

Every scene may also set `camera` (push_in, pull_out, pan_left, pan_right, parallax) for the move over
its photo and `transition` (fade, slide, zoom, wipe, flash) for how it enters. Leave them unset unless
a choice clearly fits the moment, e.g. flash for a sudden turn, pull_out to reveal scale.

One message: before any scene, decide the single thing the viewer should walk away knowing and
write it as `core_message` (one plain sentence). Every scene must move toward it. Cut any fact,
however interesting, that doesn't; a video that says one thing clearly beats one that says five.

{structure}

Music: set `mood` so the background music fits the story. Somber for death, disaster, war, illness
or any tragedy (respectful, never upbeat); tense for danger, mystery or a race against time; curious
for strange facts and discoveries; uplifting for triumph, rescue or kindness; playful only for light,
harmless fun.

Narrator voice (keep it identical from the first scene to the last):
- One storyteller talking to one listener: warm, curious, confident and brisk. Past tense for the
  story, present tense only for what is still true today.
- Momentum beats completeness: link scenes with "but", "so" and "then", never "and also" or "another fact".
- Never shift register: no sudden hype, jokes, rhetorical "folks" or "guys", and no exclamation marks.

Write for the ear -- the narration is spoken by a text-to-speech voice:
- Sentences of 6-16 words, one idea each, with a few very short ones for punch. Never start a
  sentence with a number or symbol.
- Say a long date or number the way a person would, and keep figures simple: "about 2,500 people",
  not "2,487 people". Round decimals unless the exact value is the point.
- Write a name in full the first time (the HAL 9000 computer, the International Union for
  Conservation of Nature) and avoid unfamiliar acronyms after that.
- Write units in full, in the narration and on screen: "35 miles per hour", "15 feet", "200 pounds
  per square inch", never mph, ft, psi or km/h. On-screen labels, headings and stat units follow the
  same rule; if a full word is too long for a label, rephrase rather than abbreviate.
- No parentheses, slashes, semicolons, footnote marks, emoji or ALL-CAPS emphasis.
- No lists or headings inside the narration; the on-screen templates carry those.

Rules:
- Each scene's narration is 1-4 sentences (1-2 in a Short) and matches what is on screen at that moment.
- Show, don't just tell: real photos of the subject (they get the channel's cut-out collage look), maps,
  and the animated templates carry most of the video. Save story scenes, which act a moment out in
  drawings, for the one or two moments a photo can't show (a journey, an accident, a chase) -- at most
  one scene in five. Viewers stay for seeing the story, not reading it.
- Vary the templates; don't use the same template more than twice in a row. Use data-driven templates
  (stat, bars, timeline, comparison, map, process, evidence) wherever the research supports them -- they
  are what makes this channel different from generic stock-footage channels.
- Only use numbers, dates and quotes that appear in the research notes. If unsure, don't state it.
- On-screen text must be short and scannable; the narration carries the detail.
- Title max 70 characters; no false clickbait. Description must be accurate.
- List the sources you relied on.
- Write `comment_question`: one specific, easy question about this story for the channel's first
  comment, the kind people answer in a few words. No "let me know in the comments".
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


NEWS_GUIDE = """
This is a news explainer about a recent real incident, written on {today}. It overrides anything above
that conflicts:
- Report only what the article states as established. Attribute claims that are disputed or come
  from one side: "police said", "the airline said", "according to investigators".
- Never speculate about causes, motives or guilt. Anyone accused but not convicted is "accused" or
  "charged". Don't name private people who aren't central to the story.
- No graphic detail about injuries or deaths. Speak of victims with respect.
- Set `mood` to somber for deaths or injuries, otherwise tense.
- Structure: what happened, where and when (use a map scene), how it unfolded (a timeline scene),
  why it matters or what it changed, then what is still unknown or under investigation.
- Say "as of" the article's latest facts where they may still change. The title is factual, never
  sensational, and doesn't promise answers the facts don't give.
"""


PART1_NOTE = """This Short is part 1 of a two-part story, and this overrides how the structure ends:
tell the first half, build to the most gripping open question, and stop there without giving the
payoff away. The last sentence is "Part two is up next." Keep the payoff for part 2."""

PART2_NOTE = """This Short is part 2 of a two-part story. Part 1 told this, and ended on its open question:
<part_1>
{previous}
</part_1>
Open with "Part two." and one sentence that reminds the viewer where part 1 stopped, then the build
and the payoff. Don't repeat part 1's facts beyond that one sentence. Core message of the story: {message}"""


def write_script(
    cfg: Config,
    topic: str,
    notes: str,
    from_wikipedia: bool = False,
    images: str = "",
    feedback: str = "",
    news: bool = False,
    lessons: str = "",
) -> Script:
    ch = cfg.channel
    if cfg.format == "short":
        format_line = "YouTube Short, vertical 9:16, 45-55 seconds, 6-8 fast scenes"
        words = SHORT_WORDS
    else:
        format_line = f"horizontal 16:9 video, about {cfg.target_minutes:g} minutes"
        words = long_words(cfg)
    guide = (SCRIPT_GUIDE + (WIKI_GUIDE if from_wikipedia else "")).format(
        name=ch.name,
        niche=ch.niche,
        audience=ch.audience,
        tone=ch.tone,
        language=ch.language,
        format_line=format_line,
        words=words,
        structure=SHORT_STRUCTURE if cfg.format == "short" else LONG_STRUCTURE,
    )
    if news:
        guide += NEWS_GUIDE.format(today=datetime.now(timezone.utc).strftime("%d %B %Y"))
    if lessons:
        guide += f"\n\nWhat this channel's viewers have responded to, from watch-time data on earlier videos:\n{lessons}\n"
    tail = f"\n\nAvailable images:\n{images}" if images else ""
    tail += f"\n\n{feedback}" if feedback else ""

    def user_message(notes: str) -> str:
        return f"Topic: {topic}\n\n<research_notes>\n{notes or '(no research notes; stick to well-established facts)'}\n</research_notes>{tail}"

    if cfg.llm.provider == "openai" and cfg.format == "long":
        return write_long_script(cfg, topic, notes, guide, images, from_wikipedia)
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


# Long videos on a free tier: one request can't hold a whole 8-10 minute script
# (Groq counts max_tokens against 8000 tokens a minute), so plan the video first,
# then write it one chapter at a time, each from its own slice of the notes.

WORDS_PER_CHAPTER = 220
# The narrator's real pace in a long video, pauses and title cards included: 822 words ran 6:01
# (Devil's Island) and 876 ran 6:07 (a news explainer), about 137-143 words a minute.
LONG_WPM = 135
MIDROLL_MARGIN_MINUTES = 0.5  # aim a little past the minimum so a brisk read still clears it


def long_words(cfg: Config) -> int:
    """Narration words a long video needs to run its target length, and at least the minimum
    length for mid-roll ads (`long_min_minutes`), with a margin."""
    minutes = max(cfg.target_minutes, cfg.long_min_minutes + MIDROLL_MARGIN_MINUTES if cfg.long_min_minutes else 0)
    return int(minutes * LONG_WPM)

LONG_WIKI_GUIDE = """
This is a long video, so it can tell the whole story. Build it as a narrative around the
most intriguing thread in the article, not a section-by-section summary.
"""


class ChapterPlan(BaseModel):
    heading: str = Field(description="Chapter title for the description's chapter list, max ~6 words.")
    angle: str = Field(description="One sentence: what this chapter tells, and why the viewer keeps watching.")


class Outline(BaseModel):
    core_message: str = Field(default="", description="Write this first: the one sentence the viewer should remember, max 20 words.")
    mood: Mood = Field(default="curious", description=MOOD_HELP)
    title: str = Field(description="YouTube title, max 70 characters, curiosity-driven but truthful.")
    description: str = Field(description="YouTube description: 2 short paragraphs, then key points. No hashtag spam.")
    tags: list[str] = Field(description="8-15 search tags.")
    thumbnail_text: str = Field(description="2-5 punchy words for the thumbnail (not the title).")
    thumbnail_kicker: str = Field(description="1-3 word label above the thumbnail text, e.g. the topic.")
    thumbnail_query: str = Field(description="Stock photo search query for the thumbnail background.")
    chapters: list[ChapterPlan]
    sources: list[str] = Field(description="URLs or references backing the facts used.")
    comment_question: str = Field(
        default="",
        description="A question the channel posts as the first comment: specific to this story, easy to answer "
        "in a few words, max 15 words.",
    )


class ChapterScenes(BaseModel):
    scenes: list[ScriptScene]


def chapter_count(cfg: Config) -> int:
    return max(3, min(8, round(long_words(cfg) / WORDS_PER_CHAPTER)))


def split_notes(notes: str, parts: int, limit: int) -> list[str]:
    """Consecutive slices of the notes, one per chapter, cut at line breaks, each at most `limit` chars."""
    size = -(-len(notes) // parts) if notes else 0
    chunks, start = [], 0
    for i in range(parts):
        end = len(notes) if i == parts - 1 else notes.find("\n", start + size)
        end = len(notes) if end == -1 else end
        chunks.append(notes[start:end].strip()[:limit] or notes[:limit])
        start = end
    return chunks


def _extend_chapter(
    cfg: Config, system: str, user: str, scenes: list[ScriptScene], missing: int, next_plan: ChapterPlan | None
) -> list[ScriptScene]:
    """More scenes for a chapter that came out short, continuing from its last line. [] if the call fails."""
    lead = f' It still has to lead into the next chapter, "{next_plan.heading}".' if next_plan else ""
    so_far = "\n".join(sc.narration for sc in scenes)
    ask = (
        f"{user}\n\nYou already wrote this chapter's opening:\n{so_far}\n\nIt is {missing} words too short. "
        f"Return only the NEW scenes that continue it: about {missing} more words of narration, with new facts "
        f"and detail from the notes, not repetition.{lead}"
    )
    try:
        extra = _openai_structured(cfg, system, ask, ChapterScenes, max_tokens=3000).scenes
    except Exception as e:  # the chapter as written still works, just shorter
        print(f"could not lengthen a short chapter: {e}")
        return []
    print(f"added {sum(len(sc.narration.split()) for sc in extra)} words to a short chapter")
    return extra


def write_long_script(
    cfg: Config, topic: str, notes: str, guide: str, images: str = "", from_wikipedia: bool = False
) -> Script:
    guide += LONG_WIKI_GUIDE if from_wikipedia else ""
    limit = cfg.llm.max_note_chars
    n = chapter_count(cfg)
    chunks = split_notes(notes, n, limit)
    overview = "\n...\n".join(c[: limit // n] for c in chunks)
    image_tail = f"\n\nAvailable images:\n{images}" if images else ""

    plan_note = (
        f"\n\nFirst, plan the video as exactly {n} chapters. The notes below are excerpts in article order; "
        "chapter k should draw mainly on part k. Return the metadata and the chapter plan only: the scenes "
        "are written chapter by chapter afterwards."
    )
    user = f"Topic: {topic}\n\n<research_notes>\n{overview or '(no research notes)'}\n</research_notes>"
    outline = _openai_structured(cfg, guide + plan_note, user, Outline, max_tokens=3000)
    plans = outline.chapters[:8] or [ChapterPlan(heading=topic, angle="The story.")]
    if len(plans) != n:
        n = len(plans)
        chunks = split_notes(notes, n, limit)

    words = int(long_words(cfg) / n)
    plan_text = "\n".join(f"{i}. {c.heading}: {c.angle}" for i, c in enumerate(plans, 1))
    scenes: list[ScriptScene] = []
    chapters: list[Chapter] = []
    used_images: set[int] = set()
    for i, plan in enumerate(plans, 1):
        if i == 1:
            position = "This chapter opens the video: start with a title scene, and make the first two sentences the hook."
        else:
            last = scenes[-1].narration if scenes else ""
            position = f"Continue straight on from the previous chapter, which ended: \"{last}\" Don't re-introduce the topic."
        if i == n:
            position += " This is the last chapter: end with a satisfying conclusion and one natural line inviting viewers to subscribe."
        else:
            position += " Don't wrap up or invite viewers to subscribe yet."
        taken = f"\nImages already used (don't reuse): {', '.join(map(str, sorted(used_images)))}" if used_images else ""
        system = guide + (
            f"\n\nYou are writing one chapter of this video at a time. Return only this chapter's scenes: "
            f"{words} words of narration in total (about {max(3, words // 30)} scenes of 25-35 words each). "
            "Don't write less: the video needs this length."
        )
        chunk = chunks[i - 1]
        for attempt in range(3):
            user = (
                f"Video title: {outline.title}\nCore message: {outline.core_message}\nChapter plan:\n{plan_text}\n\n"
                f"Write chapter {i}: {plan.heading}. {position}{taken}\n\n"
                f"<research_notes>\n{chunk or '(no research notes)'}\n</research_notes>{image_tail}"
            )
            try:
                part = _openai_structured(cfg, system, user, ChapterScenes, max_tokens=3000)
                break
            except RequestTooLarge:
                if attempt == 2:
                    raise
                chunk = chunk[: len(chunk) // 2]
                print(f"request too large; retrying chapter {i} with {len(chunk)} characters of notes")
        if not part.scenes:
            continue
        written = sum(len(sc.narration.split()) for sc in part.scenes)
        if written < words * 0.85:
            # Models write short; a chapter that falls well short would pull the video under its minimum.
            more = _extend_chapter(cfg, system, user, part.scenes, words - written, plans[i] if i < n else None)
            part = ChapterScenes(scenes=part.scenes + more)
        chapters.append(Chapter(title=plan.heading, scene=len(scenes)))
        for sc in part.scenes:
            if sc.image is not None:
                used_images.add(sc.image)
        scenes.extend(part.scenes)
        print(f"wrote chapter {i}/{n}: {plan.heading} ({sum(len(sc.narration.split()) for sc in part.scenes)} words)")

    return Script(
        core_message=outline.core_message,
        mood=outline.mood,
        comment_question=outline.comment_question,
        title=outline.title,
        description=outline.description,
        tags=outline.tags,
        thumbnail_text=outline.thumbnail_text,
        thumbnail_kicker=outline.thumbnail_kicker,
        thumbnail_query=outline.thumbnail_query,
        scenes=scenes,
        sources=outline.sources,
        chapters=chapters,
    )
