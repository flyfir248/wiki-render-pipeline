"""What makes videos find viewers: sharper titles and hooks, better topics, series,
Shorts cut from long videos, and bonus videos on topics trending on Wikipedia.

Everything here is a nice-to-have on top of the pipeline: when a call fails, the
video is still made the plain way.
"""

from __future__ import annotations

import math
import random
from datetime import date, datetime, timedelta, timezone
from urllib.parse import quote

import requests
from pydantic import BaseModel, Field

from fyt import llm, wiki
from fyt.config import Config
from fyt.models import Script, ScriptScene

# --- Titles, hooks, thumbnails ------------------------------------------------


class Polish(BaseModel):
    titles: list[str] = Field(description="5 different title ideas, each max 70 characters.")
    best_title: str = Field(description="The strongest of the titles (or a better one), max 70 characters.")
    thumbnail_text: str = Field(description="2-5 punchy words for the thumbnail, different from the title.")
    hook: str = Field(description="New opening narration: 1-2 sentences, max 35 words, facts from the script only.")
    loop_line: str = Field(default="", description="Shorts only: last sentence, max 12 words, that flows back into the hook.")
    hook_heading: str = Field(default="", description="Shorts only: 2-5 words shown huge on the first frame, over the photo.")
    series: str = Field(default="", description="The series this video belongs to, exactly as listed, or empty.")


POLISH_GUIDE = """You are the packaging editor of a faceless YouTube channel. The script is written; your job
is to make people click and keep watching, without lying.

Channel niche: {niche}
Audience: {audience}
Format: {format}

Titles:
- max 70 characters, specific, create a curiosity gap about something the video really answers
- lead with the most surprising concrete detail (a number, an odd object, a strange outcome)
- no clickbait lies, no ALL CAPS words except one short one at most, no emoji, no "you won't believe"
Thumbnail text: 2-5 words that add to the title rather than repeat it.
Hook: rewrite the opening so the first sentence alone makes someone stop scrolling: open on the strangest
concrete fact or the moment of tension. {hook_rule} No "welcome back", no "in this video", no questions like
"did you know". Use only facts that appear in the script.
The hook replaces the first scene's narration, and the second scene follows it unchanged: it must be
about the same thing the first scene was, so the story still flows into scene 2. Don't pull a fact
forward from later in the script that only makes sense once that later part has explained it.
Everything you write must point at the video's core message; a title or hook that promises something
else loses the viewer when the video doesn't deliver it.
{loop_rule}{heading_rule}{series_rule}"""


def polish(cfg: Config, script: Script, performance: str = "", loop: bool = True) -> Script:
    """Rewrite the title, thumbnail text and opening line for clicks and retention."""
    short = cfg.format == "short"
    looped = short and loop
    narration = " ".join(s.narration for s in script.scenes)
    series = cfg.growth.series
    guide = POLISH_GUIDE.format(
        niche=cfg.channel.niche,
        audience=cfg.channel.audience,
        format="YouTube Short (vertical, 45-55 seconds)" if short else "long video",
        hook_rule="For this Short: one sentence, max 12 words." if short else "Max 2 sentences.",
        loop_rule=(
            "Loop line: Shorts replay automatically. If it comes naturally, write a last sentence that follows from "
            "the payoff and leads back into the hook, so the replay feels seamless. It adds no new fact. "
            "Leave it empty rather than tack on a line that doesn't follow.\n"
            if looped
            else "Leave loop_line empty.\n"
        ),
        heading_rule=(
            "Hook heading: 2-5 words shown huge over the photo on the very first frame, before a word is spoken. "
            "It is the hook's most striking idea (e.g. \"Watch it with your eyes shut\"), never just the topic's name.\n"
            if short
            else "Leave hook_heading empty.\n"
        ),
        series_rule=f"Series: pick the one that fits best: {', '.join(series)}.\n" if series else "Leave series empty.\n",
    )
    user = (
        (f"Core message: {script.core_message}\n" if script.core_message else "")
        + f"Current title: {script.title}\nCurrent thumbnail text: {script.thumbnail_text}\n"
        f"Opening narration: {script.scenes[0].narration if script.scenes else ''}\n\n"
        f"Full narration:\n{narration[:3000]}"
        + (f"\n\nHow earlier videos on this channel did (learn from the titles and hooks that held viewers and won subscribers):\n{performance[:1500]}" if performance else "")
    )
    p = llm.structured(cfg, guide, user, Polish, max_tokens=2000)
    scenes = list(script.scenes)
    hook = p.hook.strip()
    if scenes and hook and len(hook.split()) <= (20 if short else 45):
        scenes[0] = scenes[0].model_copy(update={"narration": hook})
    heading = p.hook_heading.strip().rstrip(".")
    if short and scenes and scenes[0].type == "title" and heading and len(heading.split()) <= 6:
        scenes[0] = scenes[0].model_copy(update={"heading": heading, "text": None})
    loop_line = p.loop_line.strip()
    if looped and scenes and loop_line and len(loop_line.split()) <= 16:
        scenes[-1] = scenes[-1].model_copy(update={"narration": scenes[-1].narration.rstrip() + " " + loop_line})
    title = p.best_title.strip()
    update = {"scenes": scenes}
    if 10 <= len(title) <= 100:
        update["title"] = title
    if p.thumbnail_text.strip():
        update["thumbnail_text"] = p.thumbnail_text.strip()
    if p.series in series:
        update["series"] = p.series
    return script.model_copy(update=update)


# --- Topic choice ---------------------------------------------------------------

PAGEVIEWS = "https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/{lang}.wikipedia/all-access/user/{title}/daily/{start}/{end}"


def pageviews(cfg: Config, title: str, days: int = 30, today: date | None = None) -> int:
    """How many people read the article over the last `days` days: a free signal of interest."""
    end = (today or datetime.now(timezone.utc).date()) - timedelta(days=1)
    start = end - timedelta(days=days - 1)
    url = PAGEVIEWS.format(
        lang=cfg.wikipedia.lang,
        title=quote(title.replace(" ", "_"), safe=""),
        start=start.strftime("%Y%m%d"),
        end=end.strftime("%Y%m%d"),
    )
    r = requests.get(url, headers={"User-Agent": wiki.USER_AGENT}, timeout=30)
    if r.status_code == 404:
        return 0
    r.raise_for_status()
    return sum(item.get("views", 0) for item in r.json().get("items", []))


def page_lengths(cfg: Config, titles: list[str]) -> dict[str, int]:
    """Size of each article's source text in bytes (roughly its length), 50 titles per request."""
    out: dict[str, int] = {}
    for i in range(0, len(titles), 50):
        body = wiki._api(cfg, action="query", prop="info", titles="|".join(titles[i : i + 50]), redirects=1)
        for page in body.get("query", {}).get("pages", []):
            if not page.get("missing"):
                out[page["title"]] = page.get("length", 0)
        for r in body.get("query", {}).get("redirects", []):  # keep the title we asked about
            if r["to"] in out:
                out[r["from"]] = out[r["to"]]
    return out


class TopicScore(BaseModel):
    title: str
    fit: int = Field(description="0-10: how well a video on this fits the channel and would fascinate its audience.")


class TopicScores(BaseModel):
    scores: list[TopicScore]


RANK_GUIDE = """You choose topics for a faceless YouTube channel.

Channel niche: {niche}
Audience: {audience}

Rate every candidate Wikipedia article 0-10 for how well a video about it fits this channel and would
fascinate its audience. 8-10: squarely in the niche with a surprising, story-shaped subject. 5-7: fits but
ordinary. 0-4: off-niche (for example celebrities, sports seasons, companies, lists, places with nothing odd).
Score 0 for anything about a recent death, a recent tragedy or disaster with living victims, current politics
or elections, or a private person.
{extra}"""


def score_topics(cfg: Config, candidates: list[tuple[str, int]], extra: str = "") -> dict[str, int]:
    """candidates: (title, 30-day pageviews). Returns title -> fit 0-10."""
    guide = RANK_GUIDE.format(niche=cfg.channel.niche, audience=cfg.channel.audience, extra=extra)
    user = "Candidates (title | readers in the last 30 days):\n" + "\n".join(f"- {t} | {v}" for t, v in candidates)
    scores = llm.structured(cfg, guide, user, TopicScores, max_tokens=2500)
    return {s.title: max(0, min(10, s.fit)) for s in scores.scores}


def rank(fits: dict[str, int], views: dict[str, int], min_fit: int) -> list[str]:
    """Best first: fit matters most, demand (log of readers) breaks ties."""
    ok = [t for t, f in fits.items() if f >= min_fit and t in views]
    return sorted(ok, key=lambda t: fits[t] + 0.3 * math.log10(1 + views[t]), reverse=True)


def pick_topics(
    cfg: Config,
    n: int,
    used: set[str],
    min_chars: int | None = None,
    performance: str = "",
    rng: random.Random | None = None,
    sample: int = 30,
) -> list[str]:
    """Up to n unused articles, chosen for fit with the niche and reader interest.
    Falls back to a random pick when ranking isn't possible."""
    min_chars = min_chars or cfg.wikipedia.min_chars
    if not cfg.growth.rank_topics:
        return wiki.pick_articles(_with_min(cfg, min_chars), n, used, rng)
    try:
        pool = [t for t in wiki.candidates(cfg) if wiki.topic_for(t) not in used]
        (rng or random).shuffle(pool)
        lengths = page_lengths(cfg, pool[: sample * 2])
        # Source text is longer than the readable text, so this is only a first cut.
        pool = [t for t in pool[: sample * 2] if lengths.get(t, 0) >= min_chars][:sample]
        views = {t: pageviews(cfg, t) for t in pool}
        extra = f"What has performed well on the channel so far:\n{performance}\n" if performance else ""
        order = rank(score_topics(cfg, list(views.items()), extra), views, cfg.growth.min_topic_fit)
    except Exception as e:
        print(f"::warning::could not rank topics ({e}); picking at random")
        return wiki.pick_articles(_with_min(cfg, min_chars), n, used, rng)
    picked: list[str] = []
    for title in order:
        if len(picked) >= n:
            break
        try:
            article = wiki.fetch_article(cfg, title)
        except Exception as e:
            print(f"skipping {title}: {e}")
            continue
        if len(article.text) >= min_chars and wiki.topic_for(article.title) not in used:
            picked.append(article.title)
    return picked


def _with_min(cfg: Config, min_chars: int) -> Config:
    return cfg.model_copy(update={"wikipedia": cfg.wikipedia.model_copy(update={"min_chars": min_chars})})


# --- Trending topics --------------------------------------------------------------

FEED = "https://{lang}.wikipedia.org/api/rest_v1/feed/featured/{day:%Y/%m/%d}"


def trending_candidates(cfg: Config, day: date | None = None) -> list[tuple[str, int]]:
    """(title, readers) for yesterday's most-read articles and today's anniversaries."""
    day = day or datetime.now(timezone.utc).date()
    r = requests.get(FEED.format(lang=cfg.wikipedia.lang, day=day), headers={"User-Agent": wiki.USER_AGENT}, timeout=30)
    r.raise_for_status()
    body = r.json()
    out: dict[str, int] = {}
    for a in (body.get("mostread") or {}).get("articles", [])[:40]:
        out[_title(a)] = a.get("views", 0)
    for event in (body.get("onthisday") or [])[:15]:
        for page in event.get("pages", [])[:2]:
            out.setdefault(_title(page), 0)
    out.pop("Main Page", None)
    return list(out.items())


def _title(page: dict) -> str:
    return page.get("normalizedtitle") or (page.get("titles") or {}).get("normalized") or page["title"].replace("_", " ")


def pick_trending(cfg: Config, used: set[str], min_fit: int, min_chars: int, day: date | None = None) -> str | None:
    """The trending article that fits the channel best, if any fits well enough."""
    cands = [(t, v) for t, v in trending_candidates(cfg, day) if wiki.topic_for(t) not in used]
    if not cands:
        return None
    extra = (
        "These are trending today (most read yesterday, or today's anniversaries). Only rate high what a "
        "viewer of this channel would genuinely want; a trending subject outside the niche is still off-niche.\n"
    )
    fits = score_topics(cfg, cands, extra)
    views = dict(cands)
    for title in rank(fits, views, min_fit):
        try:
            article = wiki.fetch_article(cfg, title)
        except Exception as e:
            print(f"skipping {title}: {e}")
            continue
        if len(article.text) >= min_chars and wiki.topic_for(article.title) not in used:
            print(f"trending pick: {article.title} (fit {fits[title]}/10, {views[title]} readers)")
            return article.title
    return None


# --- News incidents -----------------------------------------------------------------

NEWS_RANK_GUIDE = """You choose news incidents for a weekly explainer video on a YouTube channel.

Channel: {niche}
Audience: {audience}

Rate every candidate Wikipedia article 0-10 as the subject of a calm, factual explainer about a recent
incident. 8-10: a specific incident (an accident, disaster, rescue, crime with charges, discovery or
failure) whose basic facts are established and that the audience would want explained. 5-7: notable but
thin on facts or less gripping. 0-4: not an incident (people, films, sports results, companies, lists),
still developing so fast the facts may change within days, about elections or partisan politics,
centred on a private person, or a violent crime, trial or execution centred on one individual (these
are hard to monetise and easy to get wrong).
"""


def news_candidates(cfg: Config, day: date | None = None) -> list[tuple[str, int]]:
    """(title, readers) for the incidents in Wikipedia's "In the news" and the most read articles, as of
    yesterday's feed, so each story has had at least a day for its facts to settle."""
    day = (day or datetime.now(timezone.utc).date()) - timedelta(days=1)
    r = requests.get(FEED.format(lang=cfg.wikipedia.lang, day=day), headers={"User-Agent": wiki.USER_AGENT}, timeout=30)
    r.raise_for_status()
    body = r.json()
    out: dict[str, int] = {}
    for a in (body.get("mostread") or {}).get("articles", [])[:30]:
        out[_title(a)] = a.get("views", 0)
    for item in body.get("news") or []:
        for page in (item.get("links") or [])[:3]:
            out.setdefault(_title(page), 0)
    out.pop("Main Page", None)
    return list(out.items())


def pick_news(cfg: Config, used: set[str], min_fit: int, min_chars: int, day: date | None = None) -> str | None:
    """The recent incident that makes the best explainer, if one is strong enough."""

    def seen(t: str) -> bool:
        return wiki.topic_for(t) in used or wiki.news_topic_for(t) in used

    cands = [(t, v) for t, v in news_candidates(cfg, day) if not seen(t)]
    if not cands:
        return None
    guide = NEWS_RANK_GUIDE.format(niche=cfg.channel.niche, audience=cfg.channel.audience)
    user = "Candidates (title | readers yesterday):\n" + "\n".join(f"- {t} | {v}" for t, v in cands)
    scores = llm.structured(cfg, guide, user, TopicScores, max_tokens=2500)
    fits = {x.title: max(0, min(10, x.fit)) for x in scores.scores}
    views = dict(cands)
    for title in rank(fits, views, min_fit):
        try:
            article = wiki.fetch_article(cfg, title)
        except Exception as e:
            print(f"skipping {title}: {e}")
            continue
        try:
            person = wiki.is_about_a_person(cfg, article.title)
        except Exception as e:  # can't tell, so don't risk it
            print(f"skipping {title}: could not check whether it is about one person: {e}")
            continue
        if person:
            print(f"skipping {title}: it is about one person")
            continue
        if len(article.text) >= min_chars and not seen(article.title):
            print(f"news pick: {article.title} (fit {fits[title]}/10, {views[title]} readers)")
            return article.title
    return None


# --- Shorts cut from a long video -------------------------------------------------

CUT_WORDS = 140


class CutChoice(BaseModel):
    chapters: list[int] = Field(description="Numbers of the chapters that work best as standalone Shorts, best first.")


def cut_scripts(cfg: Config, script: Script, video_id: str, n: int) -> list[Script]:
    """Standalone Short scripts from the strongest chapters of a long video, each pointing to the full video."""
    groups = _chapter_groups(script)
    if n <= 0 or len(groups) < 2:
        return []
    menu = "\n".join(f"{i}. {title}: {' '.join(s.narration for s in scenes)[:400]}" for i, (title, scenes) in enumerate(groups, 1))
    try:
        choice = llm.structured(
            cfg,
            "Pick the chapters of this video that would each work best as a standalone YouTube Short: "
            "a self-contained surprising story or fact that makes sense without the rest.",
            menu,
            CutChoice,
            max_tokens=1000,
        ).chapters
    except Exception as e:
        print(f"::warning::could not choose chapters to cut ({e}); using the middle ones")
        choice = list(range(2, len(groups) + 1))
    picked = [c for c in dict.fromkeys(choice) if 1 <= c <= len(groups)][:n]
    link = f"https://youtu.be/{video_id}"
    out = []
    for c in picked:
        title, scenes = groups[c - 1]
        kept, words = [], 0
        for s in scenes:
            w = len(s.narration.split())
            if kept and words + w > CUT_WORDS:
                break
            kept.append(s.model_copy(update={"image": None}))  # article images aren't fetched for cuts
            words += w
        if kept[0].type != "title":
            kept[0] = kept[0].model_copy(update={"type": "title", "heading": title})
        kept[-1] = kept[-1].model_copy(
            update={"narration": kept[-1].narration.rstrip() + " The full story is linked below."}
        )
        out.append(
            script.model_copy(
                update={
                    "title": title[:70],
                    "description": _cut_description(script.description, link),
                    "scenes": kept,
                    "chapters": None,
                    "core_message": "",  # the long video's message isn't this chapter's
                    "thumbnail_text": title,
                }
            )
        )
    return out


def _chapter_groups(script: Script) -> list[tuple[str, list[ScriptScene]]]:
    if script.chapters:
        starts = [c.scene for c in script.chapters] + [len(script.scenes)]
        return [(c.title, script.scenes[a:b]) for c, a, b in zip(script.chapters, starts, starts[1:]) if b > a]
    size = 6  # no chapters (written in one go): cut the video into even parts
    return [(script.title, script.scenes[i : i + size]) for i in range(0, len(script.scenes), size)]


def _cut_description(description: str, link: str) -> str:
    first = description.split("\n\n")[0].strip()
    credit = [line for line in description.splitlines() if "CC BY-SA" in line]  # Wikipedia's licence needs it
    return "\n\n".join([f"Full video: {link}", first, *credit])
