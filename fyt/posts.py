"""Weekly drafts for the channel's Community tab: a poll, a teaser for the week's long video and a
fact with a question.

YouTube's API has no way to publish Community posts, so the drafts are delivered as a GitHub issue
(which GitHub emails to the channel owner) to paste into YouTube Studio: Create > Create post.
"""

from __future__ import annotations

from datetime import datetime, timedelta

from pydantic import BaseModel, Field

from fyt import llm, wiki, youtube
from fyt.config import Config
from fyt.store import Topics, Uploads

EVERY_DAYS = 7
GUIDE = """You write Community tab posts for a faceless YouTube channel.

Channel: {niche}
Audience: {audience}
Tone: {tone}

Write three posts for this week:
1. A poll asking which story the channel should cover next, with exactly 4 options. Use the candidate
   stories given (add stories that fit the channel if there are fewer than 4), each rewritten as an
   intriguing option of at most 60 characters (no spoilers, no clickbait lies).
2. A teaser for the week's long video: two or three short sentences that make people want to watch,
   ending with the day it goes live (just the day, e.g. "Live Saturday."). If no long video is given,
   tease the channel's best recent video instead, without a day.
3. One surprising fact taken from the recent videos, then a question that asks for an opinion or a
   guess about it, never one the fact already answers. E.g. "Would you have stayed in the city?"
Only use facts from the material given. No hashtags, no "smash that like button"."""


class Poll(BaseModel):
    question: str = Field(description="At most 100 characters.")
    options: list[str] = Field(description="2-4 options, each at most 60 characters.")


class Drafts(BaseModel):
    poll: Poll
    teaser: str
    fact: str


def due(cfg: Config, now: datetime) -> bool:
    last = Uploads(cfg).note("posts-last")
    return last is None or last <= (now - timedelta(days=EVERY_DAYS)).isoformat()


def draft(cfg: Config, now: datetime) -> str:
    """The week's drafts as markdown, ready for a GitHub issue."""
    videos = youtube.recent_uploads(limit=30)
    soon = [
        v for v in videos
        if v["seconds"] > 180 and v["publish_at"] and now.isoformat() <= v["publish_at"] <= (now + timedelta(days=7)).isoformat()
    ]
    recent = [v for v in videos if not v["publish_at"] or v["publish_at"] <= now.isoformat()][:8]
    pending = [wiki.title_of(t) for _, t, status, _ in Topics(cfg).all() if status == "pending" and wiki.is_wiki_topic(t)][:6]
    long_video = soon[-1] if soon else None  # the next one to go live
    material = "Candidate stories for the poll:\n" + "\n".join(f"- {t}" for t in pending or ["(none queued: suggest four fitting the niche)"])
    if long_video:
        when = datetime.fromisoformat(long_video["publish_at"].replace("Z", "+00:00"))
        material += f"\n\nThis week's long video: {long_video['title']}, live {when:%A}.\n{long_video['description'][:600]}"
    material += "\n\nRecent videos:\n" + "\n".join(f"- {v['title']}: {v['description'][:300]}" for v in recent)
    guide = GUIDE.format(niche=cfg.channel.niche, audience=cfg.channel.audience, tone=cfg.channel.tone)
    d = llm.structured(cfg, guide, material, Drafts, max_tokens=2000)
    options = "\n".join(f"   - {o[:65]}" for o in d.poll.options[:4])
    out = [
        "Three posts for the Community tab this week. YouTube doesn't let apps publish these, so paste each one "
        "in YouTube Studio: **Create > Create post** (or the **+** button > **Post** in the YouTube app).",
        f"### 1. Poll\n\n{d.poll.question}\n\nChoose **Poll** and add these options:\n{options}",
        f"### 2. Teaser\n\n{d.teaser}",
    ]
    if long_video:
        out[-1] += f"\n\nAdd the video's thumbnail as the post image, and link it: https://youtu.be/{long_video['id']}"
    out.append(f"### 3. Fact and question\n\n{d.fact}")
    out.append("Post them on different days (for example Monday, Thursday, Saturday) so each gets seen.")
    return "\n\n".join(out)


def write_drafts(cfg: Config, now: datetime, path: str, force: bool = False) -> bool:
    """Write this week's drafts to `path` when they are due. Returns whether it wrote them."""
    if not (force or due(cfg, now)) or not youtube.can_manage():
        return False
    from pathlib import Path

    Path(path).write_text(draft(cfg, now))
    Uploads(cfg).set_note("posts-last", now.isoformat())
    return True
