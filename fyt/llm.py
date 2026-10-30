"""Claude calls: topic ideation, web research, and structured script writing."""

from __future__ import annotations

import difflib
import json
import os
import re
import time
from datetime import datetime, timezone

import anthropic
import requests
from pydantic import BaseModel, Field, ValidationError

from fyt import scenes3d
from fyt.config import Config
from fyt.models import MOOD_HELP, TITLE_HELP, Chapter, Mood, Script, ScriptScene

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


def _compact(node, in_properties: bool = False, guide: str = ""):
    """A JSON schema trimmed to fit a free tier's per-minute token budget: without the "title" pydantic
    gives every field (the field's name again), and, when the prompt already describes the scene
    templates field by field (the script guide), without the scene fields' descriptions too."""
    drop_scene_help = "Scene templates (field names in brackets)" in guide
    if isinstance(node, dict):
        out = {}
        for k, v in node.items():
            if not in_properties and k == "title" and isinstance(v, str):
                continue
            if drop_scene_help and k == "ScriptScene" and isinstance(v, dict):
                v = _strip_descriptions(v)
            out[k] = _compact(v, k == "properties", guide)
        return out
    if isinstance(node, list):
        return [_compact(x, False, guide) for x in node]
    return node


def _strip_descriptions(node):
    if isinstance(node, dict):
        return {k: _strip_descriptions(v) for k, v in node.items() if k != "description" or not isinstance(v, str)}
    if isinstance(node, list):
        return [_strip_descriptions(x) for x in node]
    return node


def _with_model(cfg: Config, model: str) -> Config:
    return cfg.model_copy(update={"llm": cfg.llm.model_copy(update={"model": model, "fallback_models": [], "backup": None, "last_resort": []})})


class RateLimited(ClaudeError):
    pass


LAST_MODEL = ""  # the model that gave the last structured answer, for the job's log
_SPENT: set[str] = set()  # providers that said the account has no credit left: not asked again this run
# Models whose free tokens for the day ran out: not asked again this run. A per-minute limit clears in a
# minute; a daily one doesn't, and waiting it out a minute at a time stalled whole scheduled runs.
_EXHAUSTED: set[tuple[str, str]] = set()
DAILY = re.compile(r"per day|\(TPD\)|\(RPD\)", re.I)


def _out_for_the_day(r) -> bool:
    try:
        wait = float(r.headers.get("retry-after") or 0)
    except ValueError:
        wait = 0
    return bool(DAILY.search(r.text or "")) or wait > 120


NEWEST = "newest:"  # a model named "newest:flash" is the provider's newest stable model with "flash" in its name
_SKIP_MODELS = ("image", "tts", "audio", "live", "embedding", "exp", "vision", "robotics")


def newest_model(c, name: str) -> str | None:
    """`name` as is, or for "newest:<word>" the newest model the provider lists (GET /models) whose name has
    that word, preferring stable ones over previews. Providers retire models for new keys (Gemini 2.5 Flash
    was no longer offered to new users by late 2026), so a fixed name goes stale. None if none is listed."""
    if not name.startswith(NEWEST):
        return name
    word = name[len(NEWEST):]
    try:
        r = requests.get(
            f"{os.path.expandvars(c.base_url).rstrip('/')}/models",
            headers={"Authorization": f"Bearer {os.environ.get(c.api_key_env, '')}"},
            timeout=30,
        )
        r.raise_for_status()
        ids = [m["id"].removeprefix("models/") for m in r.json().get("data", [])]
    except Exception as e:
        print(f"could not list the models at {c.base_url}: {e}")
        return None
    others = [w for w in ("lite", "pro", "flash") if w != word and w not in word]
    fits = [i for i in ids if word in i and not any(w in i for w in others + list(_SKIP_MODELS))]

    def rank(i: str) -> tuple:
        m = re.search(r"-(\d+(?:\.\d+)*)(?:-|$)", i)  # gemini-3.1-flash -> (3, 1)
        return ("preview" not in i, tuple(int(n) for n in m.group(1).split(".")) if m else (), -len(i))

    return max(fits, key=rank) if fits else None


_resolved: dict[tuple[str, str], str | None] = {}  # (base_url, "newest:...") -> model id, once per run


def _models(b) -> list[str]:
    """A backup provider's models, with any "newest:<word>" looked up in its model list."""
    out = []
    for m in b.models:
        if m.startswith(NEWEST):
            if (b.base_url, m) not in _resolved:
                _resolved[(b.base_url, m)] = newest_model(b, m)
            m = _resolved[(b.base_url, m)]
        if m and m not in out:
            out.append(m)
    return out


def _chain(cfg: Config) -> list[Config]:
    """Who to ask, in order: the main model, the backup provider's models (when its key is set), then the
    fallback models on the main provider."""
    steps = [_with_model(cfg, cfg.llm.model)]
    b = cfg.llm.backup
    if b and b.models and os.environ.get(b.api_key_env) and b.base_url not in _SPENT:
        for m in _models(b):
            steps.append(cfg.model_copy(update={"llm": cfg.llm.model_copy(update={
                "model": m, "base_url": b.base_url, "api_key_env": b.api_key_env, "fallback_models": [], "backup": None,
                "last_resort": []})}))
    steps += [_with_model(cfg, m) for m in cfg.llm.fallback_models]
    for b in cfg.llm.last_resort:
        if b.models and os.environ.get(b.api_key_env) and all(os.environ.get(v) for v in re.findall(r"\$(\w+)", b.base_url)):
            steps += [cfg.model_copy(update={"llm": cfg.llm.model_copy(update={
                "model": m, "base_url": b.base_url, "api_key_env": b.api_key_env, "fallback_models": [], "backup": None,
                "last_resort": []})}) for m in _models(b)]
    return steps


def _openai_structured(cfg: Config, system: str, user: str, schema: type[BaseModel], max_tokens: int = 16000, quick: bool = False):
    """Structured output from an OpenAI-compatible API (Groq, OpenRouter, Ollama...).

    Asks for JSON matching the schema, validates it, and on a bad answer retries
    with the validation error so the model can correct itself. If the model keeps
    failing, tries the backup provider and then each of `llm.fallback_models` in turn.
    With a backup set up, the main model and the backup's models move on after a couple of
    rate-limit waits instead of seven, since the next one has limits of its own. A model out of tokens for
    the day is skipped for the rest of the run. `quick` (for extras a video is fine without) never waits on
    a rate limit: each model is asked once and the call gives up when none has room.
    """
    steps = _chain(cfg)
    hurry = len(steps) - len(cfg.llm.fallback_models)  # the main model and the backup's
    error: ClaudeError | None = None
    for i, step in enumerate(steps):
        if step.llm.base_url in _SPENT or (step.llm.base_url, step.llm.model) in _EXHAUSTED:
            continue  # it ran out of credit, or of tokens for the day, earlier in this run
        last = i == len(steps) - 1
        try:
            patient = not quick and (last or hurry == 1 or i >= hurry)
            return _openai_structured_once(step, step.llm.model, system, user, schema, max_tokens, patient=patient, quick=quick)
        except RequestTooLarge as e:
            if i == 0:
                raise  # the caller shrinks the request
            # too large only for a later model with a smaller allowance: not a reason to cut the notes
            error = ClaudeError(str(e))
            print(f"request too large for {step.llm.model}; trying the next model")
        except ClaudeError as e:
            if last and not isinstance(e, RateLimited) and step.llm.base_url not in _SPENT:
                raise
            error = e
            print(f"{step.llm.model} failed ({str(e)[:200]}); trying the next model")
    if quick:
        raise error or ClaudeError("no model had room")
    if all((st.llm.base_url, st.llm.model) in _EXHAUSTED or st.llm.base_url in _SPENT for st in steps):
        raise error or ClaudeError("every model is out of tokens for the day")
    if hurry > 1 and (steps[0].llm.base_url, steps[0].llm.model) not in _EXHAUSTED:  # the backup couldn't help: wait for the main model as before
        return _openai_structured_once(steps[0], steps[0].llm.model, system, user, schema, max_tokens, patient=True)
    raise error or ClaudeError("no model answered")


def _openai_structured_once(
    cfg: Config, model: str, system: str, user: str, schema: type[BaseModel], max_tokens: int, patient: bool = True,
    quick: bool = False,
):
    global LAST_MODEL
    c = cfg.llm
    base_url = os.path.expandvars(c.base_url)  # e.g. Cloudflare's, which holds $CLOUDFLARE_ACCOUNT_ID
    key = os.environ.get(c.api_key_env)
    if not key and "localhost" not in c.base_url:
        raise ClaudeError(f"{c.api_key_env} is not set")
    system += (
        "\n\nReply with a single JSON object and nothing else. It must match this JSON schema:\n"
        + json.dumps(_compact(schema.model_json_schema(), guide=system), separators=(",", ":"))
    )
    body = {
        "model": model,
        "temperature": c.temperature,
        "max_tokens": max_tokens,
        "response_format": {"type": "json_object"},
    }
    if c.reasoning_effort and "gpt-oss" in model:
        body["reasoning_effort"] = c.reasoning_effort
    if "generativelanguage.googleapis.com" in c.base_url:
        # Gemini thinks before it answers and the thinking counts against max_tokens: a 3000-token chapter
        # came back cut off mid-JSON again and again, each retry spending one of Flash's few free requests.
        # Its output limit is far higher, and the free tier counts requests, not tokens.
        body["max_tokens"] = max(max_tokens, 16000)
        body["reasoning_effort"] = "low"
    if "nemotron" in model and "nvidia.com" in c.base_url:
        # Nemotron thinks at length by default, and the thinking counts against max_tokens
        body["chat_template_kwargs"] = {"enable_thinking": False}
    retry_note = ""
    last_error = ""
    for attempt in range(8):
        # A retry resends the same prompt plus a short note, never the rejected reply,
        # so the request doesn't grow past the provider's tokens-per-minute limit.
        messages = [{"role": "system", "content": system}, {"role": "user", "content": user + retry_note}]
        try:
            r = requests.post(
                f"{base_url.rstrip('/')}/chat/completions",
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
        if r.status_code == 429 and _out_for_the_day(r):  # waiting a minute at a time won't help
            _EXHAUSTED.add((c.base_url, model))
            print(f"{model} is out of free tokens for the day; not asking it again this run")
            raise RateLimited(f"{c.base_url} returned 429: {r.text[:300]}")
        if r.status_code == 429 and (quick or (not patient and attempt >= 2)):  # someone else may have room now
            raise RateLimited(f"{c.base_url} returned 429: {r.text[:300]}")
        if r.status_code == 429 and attempt < 7:  # free tiers limit tokens per minute
            wait = min(max(float(r.headers.get("retry-after") or 30), 10), 65)
            print(f"rate limited by {c.base_url}; waiting {wait:.0f}s")
            time.sleep(wait)
            continue
        if r.status_code in (404, 410):  # retired, unknown, or not open to this account: not again this run
            _EXHAUSTED.add((c.base_url, model))
            raise ClaudeError(f"{c.base_url} returned {r.status_code}: {r.text[:300]}")
        if r.status_code == 402:  # out of credit: no use asking this provider again today
            _SPENT.add(c.base_url)
            print(f"{c.base_url} has no credit left; not asking it again this run")
            raise ClaudeError(f"{c.base_url} returned 402: {r.text[:300]}")
        if r.status_code == 413:
            raise RequestTooLarge(f"{c.base_url} returned 413: {r.text[:500]}")
        if r.status_code == 400 and "response_format" in r.text and "response_format" in body:
            body.pop("response_format")  # a provider without JSON mode: the prompt asks for JSON anyway
            continue
        if r.status_code == 400 and "json_validate_failed" in r.text:
            # Groq rejects replies that aren't valid JSON, e.g. when the model ran out of tokens.
            last_error = r.text[:500]
            print(f"{model} did not produce valid JSON; retrying")
            retry_note = "\n\nYour previous reply was not valid JSON. Keep it concise and reply with the JSON object only."
            continue
        if r.status_code >= 400:
            raise ClaudeError(f"{c.base_url} returned {r.status_code}: {r.text[:500]}")
        choice = r.json()["choices"][0]
        content = (choice["message"]["content"] or "").strip()
        if choice.get("finish_reason") == "length" and body["max_tokens"] < 32000:
            body["max_tokens"] = min(body["max_tokens"] * 2, 32000)  # cut off: the next try gets room to finish
            print(f"{model} ran out of room mid-reply; retrying with max_tokens {body['max_tokens']}")
        if content.startswith("```"):  # tolerate a fenced reply
            content = content.strip("`").removeprefix("json").strip()
        if not content.startswith("{") and "{" in content:  # a sentence before or after the object (Gemini)
            content = content[content.index("{"): content.rindex("}") + 1]
        try:
            answer = schema.model_validate_json(content)
        except ValidationError as e:
            answer = _salvage(schema, content, e)
            if answer is not None:
                LAST_MODEL = model
                return answer
            last_error = str(e)[:800]
            print(f"{model} reply did not match the schema ({' '.join(str(e).split())[:200]}); retrying")
            retry_note = f"\n\nYour previous reply did not match the schema:\n{last_error}\nReply with the corrected JSON object only."
            continue
        LAST_MODEL = model
        return answer
    raise ClaudeError(f"{model} did not return a valid answer: {last_error}")


def _salvage(schema: type[BaseModel], content: str, error: ValidationError):
    """The answer with every made-up value in a choice field left out (an actor's action "cruise", a setting
    "mountain"), when that is all that is wrong and those fields have defaults. Smaller models often invent
    such values; a retry costs a request and often invents another. None when it can't be saved."""
    if not all(err["type"] in ("literal_error", "enum") for err in error.errors()):
        return None
    try:
        data = json.loads(content)
        for err in error.errors():
            *path, key = err["loc"]
            node = data
            for step in path:
                node = node[step]
            if isinstance(node, dict):
                node.pop(key, None)
            elif isinstance(node, list) and isinstance(key, int):
                node[key] = None
        return schema.model_validate(data)
    except Exception:
        return None


def helping(cfg: Config) -> Config:
    """The config for a supporting call: the helper models first and the main model last, so the main
    model's daily tokens go to writing and checking scripts."""
    helpers = cfg.llm.helper_models
    if cfg.llm.provider != "openai" or not helpers:
        return cfg
    rest = [m for m in helpers[1:] + cfg.llm.fallback_models if m not in (helpers[0], cfg.llm.model)]
    rest = list(dict.fromkeys(rest)) + [cfg.llm.model]
    return cfg.model_copy(update={"llm": cfg.llm.model_copy(update={"model": helpers[0], "fallback_models": rest})})


def structured(cfg: Config, system: str, user: str, schema: type[BaseModel], max_tokens: int = 3000, quick: bool = False):
    """A small structured answer from whichever provider the channel uses. `quick`: an extra the video is
    fine without, so a rate limit gives up instead of waiting. A supporting call passes `helping(cfg)`."""
    if cfg.llm.provider == "openai":
        return _openai_structured(cfg, system, user, schema, max_tokens=max_tokens, quick=quick)
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
    takeaway: str = Field(default="", description="What a stranger learns, in one plain sentence, or empty if nothing clear.")
    worth: int = Field(default=10, description="0-10: would a stranger who swiped in be glad they watched?")


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
Return exactly {n} narrations, one per scene.
Then judge the fixed script as that stranger. `takeaway`: what they now know, in one plain sentence; leave
it empty if there is no clear point. `worth` (0-10): would they be glad they watched? Score 3 or less for
a script that circles one detail, leans on names or terms it never explains, or ends without answering
its hook (a part 1 that ends saying part two is next may leave it open); 7 or more only when it has a
clear point, several concrete facts and a real payoff."""


def mend(cfg: Config, script: Script) -> tuple[Script, list[str], Mended]:
    """Check a Short tells one followable story; fix the lines where a first-time viewer would get lost.
    Also returns the editor's verdict: what a stranger takes away, and whether it is worth watching."""
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
        return script, [], m
    lines = [x.strip() for x in m.narrations]
    if len(lines) != n or not all(lines):
        raise ValueError(f"expected {n} narrations, got {len(lines)}")
    if sum(len(x.split()) for x in lines) > max(words, SHORT_MAX_WORDS):
        raise ValueError("the fixed script ran too long")
    scenes = [sc.model_copy(update={"narration": line}) for sc, line in zip(script.scenes, lines)]
    return script.model_copy(update={"scenes": scenes}), problems, m


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
- not mainly about sex, suicide or gore (YouTube limits ads and reach on those)

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
SHORT_FLOOR_WORDS = 100  # still under this after the rewrite and the checks: too thin to upload
SHORT_MIN_WORTH = 5  # the story editor's 0-10 score below which a Short is not made

SHORT_STRUCTURE = """Structure of a Short (45-55 seconds, 6-8 scenes; viewers decide in the first second whether to swipe).
It is worth watching only if a stranger comes away with something they can retell in one sentence. First
decide the question a stranger would ask after the hook ("why?", "how did it survive?", "what does it
really show?"), its answer (the core message), and why someone who never heard of it should care (the
human stake, the surprise, the claim people argue about; pick that angle over technical detail).
1. Hook (scene 1, max 12 words): the strangest concrete fact, stated flatly in everyday words, raising
   the question. No "welcome back", "in this video", "did you know", no question, and never open on a
   name or term the viewer can't know: say what it is or does. Scene 1 is a `title` scene over a photo
   of the subject: its heading is the hook in 2-5 big words (e.g. "Watch it with your eyes shut"),
   never just the topic's name. Leave its text empty.
2. Context (1-2 scenes): who or what this is, where and when, and why the hook is true.
3. Build (2-3 scenes): each follows from the last ("so", "but", "then") and escalates with a new,
   stranger or higher-stakes detail of the same thread. Show a size, share, change over time or place
   with a moving graphic (scale, proportion, trend or map) rather than a still.
4. Payoff (1 scene): answer the hook's question; say the core message in plain words.
5. End on the payoff: no subscribe line, no thanks, no question; the replay should feel seamless.
Substance over jargon: every scene adds a new fact and no sentence repeats an earlier one; use at
least three concrete specifics from the notes (number, date, place, person, exact detail) and say
what each means; besides the subject, at most two names or specialist terms, each explained where it
first appears ("an Egyptian god", not a name to remember). Write the full {words} words.
One thread only, introduced before it is relied on; never jump to a new topic without the link.
If any sentence would make a stranger ask "wait, what?", fix it.""".replace("{words}", str(SHORT_WORDS))

LONG_STRUCTURE = """Structure of a long video (a documentary told like a thriller; viewers leave the moment
nothing is at stake, so there is always an unanswered question on the table):
1. Cold open (first 20 seconds): drop the viewer into the most dramatic moment of the story, in the
   present tense of that moment, and cut away before the outcome. No "welcome back", no "in this video
   we will", no "did you know".
2. Stakes and promise (next 10-15 seconds): why this moment matters, the central question the video
   will answer, and a hint that the answer is stranger than it looks. Then rewind: "To understand how it
   came to this, we have to go back to ...".
3. Setup: one person (or group) at the centre, what they wanted, and what stood in their way. A viewer
   follows a person with a goal, not a list of facts.
4. Escalation: the story in order, each scene linked to the last by "but" or "so", never "and then".
   Every 60-90 seconds something must change: a reveal, a setback, a new number, a jump in place or
   time. Plant a question early and answer it later ("that detail will matter"), and keep at least one
   question open at every moment.
5. Midpoint turn (around the middle): the twist that changes how the story so far looks, or the moment
   everything goes wrong.
6. Climax and payoff: return to the cold open's moment, now with everything the viewer needs, and
   finish it. Answer every question the video raised; then state the core message.
7. Close fast: one line on why it still matters, then one natural line inviting viewers to subscribe.
   No recap of the story."""

# Long videos cut to a new picture often enough that the screen never sits still: each scene is a
# 5-10 second beat, and long photo scenes get cutaways (fyt.pipeline.extra_shots).
LONG_SCENE_WORDS = (15, 25)

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
- trend: a line chart drawn point by point, its value counting up beside the pen, the peak circled at
  the end [heading, data (3-10 real points in time order, label = year or date), prefix, suffix, optional
  text]. Use it when a number rose or fell over time.
- proportion: a grid of 100 dots that light up to show a share [heading, value (the percentage, 0-100),
  text = what the share is of, e.g. "of the island collapsed into the sea"]. Use it for "1 in 3", "two thirds".
- scale: circles sized by value; the camera starts on the smallest and pulls out to reveal each bigger
  one [heading, data (2-5 things, label = the thing, value = a real number in the same unit), suffix =
  the unit, optional text]. Use it to make a huge difference in size, energy, money or distance felt.
- cycle: a loop of steps joined by arrows, with a pulse running round it [heading, items (3-5 steps,
  max ~4 words each), optional text = a 1-3 word name for the loop shown in the middle]. Only for
  something that really feeds back into itself.
<<WORLD SCENE>>
- dialogue: a real recorded exchange, typed out like a transcript [heading, lines (2-4, speaker + exact
  words)]. Only for words that were actually recorded or documented; never invent dialogue.

Every scene sets `purpose`: what the viewer must understand from it, max 15 words.
Every scene may also set `camera` (push_in, pull_out, pan_left, pan_right, parallax) for the move over
its photo and `transition` (fade, slide, zoom, wipe, flash, thread, whip) for how it enters. Leave them
unset unless a choice clearly fits the moment, e.g. flash for a sudden turn, whip for a jump in place or
time, thread when the next scene is a connected clue, pull_out to reveal scale.

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
- Each scene's narration is 1-3 sentences, 15-25 words (1-2 in a Short), matching what is on screen.
- Show, don't just tell: this channel tells its stories in 3D. In about four scenes in five the viewer
  should see the story happen: someone or something the story names doing what the narration says, in
  its place (a launch, a voyage, a chase, a bear in the woods, a ship in the ice). Write those as
  statement scenes with a short heading; the visual director makes each one a 3D world scene
  from the story's own cast and places. Name the thing in the scene that shows it, so it can be shown.
- When a figure, a share, a short list or a few dates matter, use a stat, proportion, list or timeline
  scene: its figures are drawn over a 3D scene of the story. Keep maps, charts (bars, trend, scale,
  comparison), quotes, documents, evidence boards and photos for what only they can carry (a route, a
  trend, someone's exact words, the real face or object), at most one scene in five between them.
- Vary the templates; don't use the same template more than twice in a row.
- Only use numbers, dates and quotes that appear in the research notes. If unsure, don't state it.
- On-screen text must be short and scannable; the narration carries the detail.
- Title: the subject in everyday words first, then the question the video answers; plain words, no puns
  or labels, never words about sex, suicide or gore. No false clickbait. Description must be accurate.
- List the sources you relied on.
- Write `comment_question`: one specific, easy question about this story for the channel's first
  comment, the kind people answer in a few words. No "let me know in the comments".
"""
# The scriptwriter tells the story; it doesn't pick 3D scenes. The visual director decides what each
# scene shows once the script is checked (fyt/visualplan.py, fyt/manifest.py), from what the story needs.
SCRIPT_GUIDE = SCRIPT_GUIDE.replace("<<WORLD SCENE>>\n", "")


WIKI_GUIDE = """
The research notes are a Wikipedia article. Turn it into an original video:
- Pick the single most surprising or intriguing thread in the article and build the video around it;
  don't summarise the article top to bottom.
- Write every sentence in your own words. Never copy or lightly reword sentences from the article.
- Don't say "according to Wikipedia" in the narration.
- Only state facts the article supports.
"""

IMAGES_GUIDE = """
Visuals: the message ends with a numbered list of "Available images": the article's own, then freely
licensed photos found for the subject. For each scene, set `image` to the number of the image that best
shows what the narration is talking about at that moment (the real person, place or object), or leave it
null if none fits. Use each image at most once. For scenes without an image, set `broll_query` to a
concrete stock-footage search for what is being said. The title scene should show the subject itself
whenever an image of it exists.
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
    if images:
        guide += IMAGES_GUIDE
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
        for attempt in range(4):
            try:
                return _openai_structured(cfg, guide, user_message(notes[:limit]), Script, max_tokens=3000)
            except RequestTooLarge as e:
                if attempt == 3:
                    # Still too large with the shortest notes: a fallback model may have a larger
                    # per-minute allowance than the primary.
                    for model in cfg.llm.fallback_models:
                        try:
                            print(f"request too large for {cfg.llm.model}; trying {model}")
                            return _openai_structured(_with_model(cfg, model), guide, user_message(notes[:limit]), Script, max_tokens=3000)
                        except (RequestTooLarge, ClaudeError) as err:
                            e = err
                    raise e
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


EXTEND_TRIES = 3  # calls that lengthen one short chapter
SAID_CHARS = 9000  # earlier chapters' narration each chapter is shown, so it doesn't say it again


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
    heading: str = Field(description="Chapter title for the description's chapter list and the on-screen chapter card, max ~6 words.")
    angle: str = Field(description="One sentence: what this chapter tells, and why the viewer keeps watching.")
    turn: str = Field(default="", description="The reveal, setback or twist this chapter delivers, from the notes, max 20 words.")
    cliffhanger: str = Field(
        default="",
        description="The open question this chapter ends on, which a later chapter answers, max 15 words. "
        "Empty for the last chapter.",
    )


class Outline(BaseModel):
    core_message: str = Field(default="", description="Write this first: the one sentence the viewer should remember, max 20 words.")
    cold_open: str = Field(
        default="",
        description="The most dramatic moment of the story, which the video opens on and stops just before "
        "its outcome, max 25 words. The last chapter returns to it.",
    )
    mood: Mood = Field(default="curious", description=MOOD_HELP)
    title: str = Field(description=TITLE_HELP)
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


def _ending(scenes: list[ScriptScene]) -> int:
    """Where a chapter's ending starts: the scene inviting viewers to subscribe, else its last scene."""
    for k in range(len(scenes) - 1, 0, -1):
        if "subscrib" in scenes[k].narration.lower():
            return k
    return max(1, len(scenes) - 1)


def _extend_chapter(
    cfg: Config, system: str, user: str, scenes: list[ScriptScene], missing: int, next_plan: ChapterPlan | None
) -> list[ScriptScene]:
    """A chapter that came out short, with more scenes put before its ending (its cliffhanger, or the
    video's close), so nothing comes after the subscribe line. The chapter as it was if the call fails."""
    cut = _ending(scenes) if len(scenes) > 1 else len(scenes)
    body, ending = scenes[:cut], scenes[cut:]
    lead = f' The ending leads into the next chapter, "{next_plan.heading}".' if next_plan else ""
    so_far = "\n".join(sc.narration for sc in body)
    end_text = "\n".join(sc.narration for sc in ending)
    ask = (
        f"{user}\n\nYou already wrote this chapter. Its middle:\n{so_far}\n\nIts ending:\n{end_text or '(none)'}\n\n"
        f"It is {missing} words too short. Return only NEW scenes that go between the middle and the ending: "
        f"about {missing} more words of narration, with new facts and detail from the notes that the chapter "
        f"doesn't say yet. Don't repeat or reword anything above, and don't wrap up: the ending stays last.{lead}"
    )
    try:
        extra = _openai_structured(cfg, system, ask, ChapterScenes, max_tokens=3000).scenes
    except Exception as e:  # the chapter as written still works, just shorter
        print(f"could not lengthen a short chapter: {e}")
        return scenes
    print(f"added {sum(len(sc.narration.split()) for sc in extra)} words to a short chapter")
    return body + extra + ending


def _words(text: str) -> list[str]:
    return re.findall(r"[a-z0-9']+", text.lower())


def _sentences(text: str) -> list[str]:
    return [t for t in re.split(r"(?<=[.!?])\s+", text.strip()) if t]


def _repeats(sentence: list[str], said: list[list[str]]) -> bool:
    """Whether a sentence says again what an earlier one said: most of its words, in much the same order."""
    if len(sentence) < 5:
        return False
    words = set(sentence)
    for old in said:
        if len(words & set(old)) / len(words | set(old)) >= 0.6:
            return True
        if difflib.SequenceMatcher(None, sentence, old).ratio() >= 0.75:
            return True
    return False


def drop_repeats(scenes: list, chapters: list[Chapter] | None = None) -> tuple[list, list[Chapter]]:
    """The scenes without narration that repeats what an earlier scene already said: a repeated sentence is
    cut, and a scene that is mostly repeats goes. The first scene stays. Chapter starts move to match."""
    said: list[list[str]] = []
    kept, where = [], []
    for k, sc in enumerate(scenes):
        parts = _sentences(sc.narration)
        fresh = [t for t in parts if not _repeats(_words(t), said)]
        said += [_words(t) for t in parts]
        if k and len(fresh) * 2 < len(parts):
            print(f"dropped a scene that repeats earlier narration: {sc.narration[:80]!r}")
            where.append(len(kept))
            continue
        if k and len(fresh) < len(parts):
            print(f"cut {len(parts) - len(fresh)} repeated sentence(s) from a scene")
            sc = sc.model_copy(update={"narration": " ".join(fresh)})
        where.append(len(kept))
        kept.append(sc)
    moved: list[Chapter] = []
    for c in chapters or []:
        start = where[c.scene] if c.scene < len(where) else len(kept)
        if start >= len(kept):
            continue
        if moved and moved[-1].scene == start:
            moved[-1] = c.model_copy(update={"scene": start})  # its scenes all went: the next chapter starts there
        else:
            moved.append(c.model_copy(update={"scene": start}))
    return kept, moved


def write_long_script(
    cfg: Config, topic: str, notes: str, guide: str, images: str = "", from_wikipedia: bool = False
) -> Script:
    guide += LONG_WIKI_GUIDE if from_wikipedia else ""
    if cfg.llm.strict_writer:
        # only the main model, then the backup provider's (NVIDIA's 120B Nemotron), write the script: a small
        # fallback's long script isn't worth a week's video, and when both are out the next run tries again
        cfg = cfg.model_copy(update={"llm": cfg.llm.model_copy(update={"fallback_models": [], "last_resort": []})})
    limit = cfg.llm.max_note_chars
    n = chapter_count(cfg)
    chunks = split_notes(notes, n, limit)
    overview = "\n...\n".join(c[: limit // n] for c in chunks)
    image_tail = f"\n\nAvailable images:\n{images}" if images else ""

    plan_note = (
        f"\n\nFirst, plan the video as exactly {n} chapters. The notes below are excerpts in article order; "
        "chapter k should draw mainly on part k. Pick the cold open first, then give every chapter a turn "
        "(something changes) and, except the last, a cliffhanger a later chapter answers. Return the metadata "
        "and the chapter plan only: the scenes are written chapter by chapter afterwards."
    )
    user = f"Topic: {topic}\n\n<research_notes>\n{overview or '(no research notes)'}\n</research_notes>"
    outline = _openai_structured(cfg, guide + plan_note, user, Outline, max_tokens=3000)
    plans = outline.chapters[:8] or [ChapterPlan(heading=topic, angle="The story.")]
    if len(plans) != n:
        n = len(plans)
        chunks = split_notes(notes, n, limit)

    words = int(long_words(cfg) / n)
    plan_text = "\n".join(
        f"{i}. {c.heading}: {c.angle}" + (f" Turn: {c.turn}" if c.turn else "") + (f" Ends on: {c.cliffhanger}" if c.cliffhanger else "")
        for i, c in enumerate(plans, 1)
    )
    cold_open = f"Cold open: {outline.cold_open}\n" if outline.cold_open else ""
    scenes: list[ScriptScene] = []
    chapters: list[Chapter] = []
    used_images: set[int] = set()
    for i, plan in enumerate(plans, 1):
        if i == 1:
            position = (
                "This chapter opens the video: start with a title scene and the cold open, cut away before its "
                "outcome, say what is at stake, then rewind to where the story begins."
            )
        else:
            last = scenes[-1].narration if scenes else ""
            position = f"Continue straight on from the previous chapter, which ended: \"{last}\" Don't re-introduce the topic."
        if plan.turn:
            position += f" Build to this chapter's turn: {plan.turn}"
        if i == n:
            position += (
                " This is the last chapter: return to the cold open's moment and finish it, answer every open "
                "question, then close fast with one natural line inviting viewers to subscribe."
            )
        else:
            ending = f": {plan.cliffhanger}" if plan.cliffhanger else ", a question the next chapters answer"
            position += f" Don't wrap up or invite viewers to subscribe yet; end on the open question{ending}"
        said = "\n".join(sc.narration for sc in scenes)[-SAID_CHARS:]
        if said:
            position += (
                f"\n\nThe narration so far (earlier chapters), which this chapter must not repeat, reword or "
                f"recap: tell only what comes next.\n<said>\n{said}\n</said>"
            )
        taken = f"\nImages already used (don't reuse): {', '.join(map(str, sorted(used_images)))}" if used_images else ""
        system = guide + (
            f"\n\nYou are writing one chapter of this video at a time. Return only this chapter's scenes: "
            f"{words} words of narration in total (about {max(4, words // 20)} scenes of {LONG_SCENE_WORDS[0]}-"
            f"{LONG_SCENE_WORDS[1]} words each, so the picture changes every few seconds). "
            "Don't write less: the video needs this length."
        )
        chunk = chunks[i - 1]
        for attempt in range(3):
            user = (
                f"Video title: {outline.title}\nCore message: {outline.core_message}\n{cold_open}Chapter plan:\n{plan_text}\n\n"
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
        for _ in range(EXTEND_TRIES):
            # Models write short (Nemotron's five chapters came to 765 words, a 5-minute video); a chapter that
            # falls short pulls the video under the minimum for mid-roll ads
            written = sum(len(sc.narration.split()) for sc in part.scenes)
            if written >= words * 0.9:
                break
            longer = _extend_chapter(cfg, system, user, part.scenes, words - written, plans[i] if i < n else None)
            if len(longer) == len(part.scenes):
                break  # the call failed: the chapter stays as it is
            part = ChapterScenes(scenes=longer)
        chapters.append(Chapter(title=plan.heading, scene=len(scenes)))
        for sc in part.scenes:
            if sc.image is not None:
                used_images.add(sc.image)
        scenes.extend(part.scenes)
        print(f"wrote chapter {i}/{n}: {plan.heading} ({sum(len(sc.narration.split()) for sc in part.scenes)} words)")

    scenes, chapters = drop_repeats(scenes, chapters)
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
