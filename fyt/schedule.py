"""Keep the channel's publish slots filled ahead of time.

`fyt fill` looks at the next few days of publish slots (config `schedule`), makes a
video for each empty one and uploads it with YouTube's scheduled publishing
(`publishAt`). Videos sit on YouTube as "scheduled" until their slot, so a run that
fails, or a scheduled run GitHub skips, only shrinks the buffer; the next run refills
it and no publish is missed. A video whose upload fails is kept in jobs/pending/ and
uploaded by a later run.
"""

from __future__ import annotations

import random
import re
import shutil
import time
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from datetime import time as dtime
from zoneinfo import ZoneInfo

from fyt import pipeline, youtube
from fyt.config import Config
from fyt.store import Job, Topics, Uploads

# The YouTube Data API quota resets at midnight Pacific time.
PACIFIC = ZoneInfo("America/Los_Angeles")
LEAD_MINUTES = 30  # a slot this close is left alone: the upload might not finish in time
# Rough time to make one video on the free 2-core runner, to avoid starting one the job can't finish.
MAKE_MINUTES = {"short": 10, "long": 100}  # an 8.5-minute long video takes about 100
KEEP = ("video.mp4", "thumbnail.png", "captions.srt", "script.json", "job.json", "part2.json", "props.json", "localizations.json")


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


@dataclass(frozen=True)
class Slot:
    at: datetime
    kind: str  # short | long

    @property
    def key(self) -> str:
        return self.at.isoformat()


def _at(day: date, hhmm: str) -> datetime:
    h, m = (int(x) for x in hhmm.split(":"))
    return datetime.combine(day, dtime(h, m), tzinfo=timezone.utc)


def upcoming_slots(cfg: Config, now: datetime) -> list[Slot]:
    """Publish slots from now (plus a lead time) to the end of the buffer, earliest first."""
    sc = cfg.schedule
    start = now + timedelta(minutes=LEAD_MINUTES)
    short_end = now + timedelta(days=sc.buffer_days)
    long_end = now + timedelta(days=sc.long_lead_days)
    slots = []
    day = now.date()
    while day <= max(short_end, long_end).date():
        for hhmm in sc.short_slots:
            at = _at(day, hhmm)
            if start <= at <= short_end:
                slots.append(Slot(at, "short"))
        if sc.long_weekday is not None and day.weekday() == sc.long_weekday:
            at = _at(day, sc.long_slot)
            if start <= at <= long_end:
                slots.append(Slot(at, "long"))
        day += timedelta(days=1)
    return sorted(slots, key=lambda s: s.at)


def empty_slots(cfg: Config, now: datetime) -> list[Slot]:
    filled = Uploads(cfg).filled()
    return [s for s in upcoming_slots(cfg, now) if s.key not in filled]


def uploads_left_today(cfg: Config, now: datetime) -> int:
    day_start = now.astimezone(PACIFIC).replace(hour=0, minute=0, second=0, microsecond=0)
    used = Uploads(cfg).count_since(day_start.astimezone(timezone.utc).isoformat(timespec="seconds"))
    return max(0, cfg.schedule.max_uploads_per_day - used)


def pending_jobs(cfg: Config) -> list[Job]:
    folder = cfg.jobs_path / "pending"
    if not folder.exists():
        return []
    return [Job(p) for p in sorted(folder.iterdir()) if (p / "job.json").exists()]


def _keep_pending(cfg: Config, job: Job) -> None:
    """Save a made-but-not-uploaded video so a later run can upload it (jobs/pending is cached)."""
    dst = cfg.jobs_path / "pending" / job.id
    if dst == job.path:
        return
    dst.mkdir(parents=True, exist_ok=True)
    for name in KEEP:
        if job.file(name).exists():
            shutil.copy(job.file(name), dst / name)
    print(f"kept {job.id} to upload in a later run")


def _is_quota_error(e: Exception) -> bool:
    return "quota" in str(e).lower()


def publish_time(cfg: Config, slot: Slot, rng: random.Random | None = None) -> datetime:
    jitter = cfg.youtube.publish_jitter_minutes
    return slot.at + timedelta(minutes=(rng or random).uniform(0, jitter) if jitter else 0)


def _upload(
    cfg: Config, job: Job, slot: Slot, rng: random.Random | None, now: datetime, kind: str | None = None
) -> bool | None:
    """Upload a job into a slot. True on success, None when the daily quota ran out, False otherwise."""
    # A long render can outlast a near slot; YouTube needs publishAt in the future.
    earliest = utcnow() + timedelta(minutes=youtube.MIN_PUBLISH_LEAD_MINUTES)
    publish_at = max(publish_time(cfg, slot, rng), earliest)
    try:
        video_id = pipeline.upload_job(cfg, job, publish_at=publish_at)
    except Exception as e:
        video_id = job.meta.get("youtube_id")
        if not video_id:
            print(f"::warning::upload of {job.id} failed: {e}")
            job.update(status="upload_failed", upload_error=str(e)[:500])
            return None if _is_quota_error(e) else False
        # The video is on YouTube; only a later step failed. Count it, never upload it again.
        print(f"::warning::{job.id} is up as https://youtu.be/{video_id}, but a later step failed: {e}")
    key = None if kind else slot.key  # bonus videos fill no slot
    Uploads(cfg).record(kind or slot.kind, job.id, video_id, publish_at.isoformat(), key, at=now.isoformat(timespec="seconds"))
    print(f"scheduled https://youtu.be/{video_id} ({kind or slot.kind}) for {publish_at:%a %d %b %H:%M} UTC")
    return True


ARTICLE = re.compile(r'Based on the Wikipedia article "(.+?)" \(')
SLOT_SLACK_MINUTES = 60  # a publish time can land past the jitter window when a render ran long


def _slot_for(cfg: Config, publish_at: str | None, slots: list[Slot], filled: dict) -> Slot | None:
    """The empty slot a video scheduled for `publish_at` fills, if any."""
    if not publish_at:
        return None
    at = datetime.fromisoformat(publish_at.replace("Z", "+00:00"))
    window = timedelta(minutes=cfg.youtube.publish_jitter_minutes + SLOT_SLACK_MINUTES)
    return next((s for s in slots if s.key not in filled and s.at <= at <= s.at + window), None)


def _same_title(a: str, b: str) -> bool:
    norm = lambda t: re.sub(r"\W+", " ", t).strip().lower()  # noqa: E731
    return bool(a) and norm(a) == norm(b)


def settle_posted(cfg: Config, now: datetime, channel_titles: list[str] = ()) -> int:
    """Drop kept videos that are already on YouTube, so no video is ever uploaded twice.
    A kept video counts as posted when an earlier upload got its video id (a later step such as the
    thumbnail failed), or when the channel already has a video with its title."""
    uploads = Uploads(cfg)
    known = set(uploads.video_ids())
    dropped = 0
    for job in pending_jobs(cfg):
        video_id = job.meta.get("youtube_id")
        if video_id:
            if video_id not in known:
                slots, filled = upcoming_slots(cfg, now), uploads.filled()
                slot = _slot_for(cfg, job.meta.get("publish_at"), slots, filled)
                kind = slot.kind if slot else job.meta.get("format", "short")
                uploads.record(kind, job.id, video_id, job.meta.get("publish_at"), slot.key if slot else None,
                               at=now.isoformat(timespec="seconds"))
                known.add(video_id)
            print(f"{job.id} is already on YouTube as https://youtu.be/{video_id}; not uploading it again")
        elif any(_same_title(job.meta.get("title", ""), t) for t in channel_titles):
            print(f"{job.id} ({job.meta.get('title')}) is already on the channel; not uploading it again")
        else:
            continue
        shutil.rmtree(job.path)
        dropped += 1
    return dropped


def sync(cfg: Config, now: datetime) -> int:
    """Recover the schedule from the channel itself, so a lost or reset state cache can't double-book
    slots or repeat topics. Returns how many uploads were new to the local state."""
    from fyt import wiki

    try:
        videos = youtube.recent_uploads()
    except (Exception, SystemExit) as e:  # e.g. an upload-only token; the local state is all we have then
        print(f"::warning::could not read the channel's uploads to check the schedule: {e}")
        settle_posted(cfg, now)
        return 0
    uploads, topics = Uploads(cfg), Topics(cfg)
    known = set(uploads.video_ids())
    filled = uploads.filled()
    slots = upcoming_slots(cfg, now)
    added = 0
    for v in videos:
        m = ARTICLE.search(v["description"])
        if m:
            topics.mark_done(wiki.topic_for(m.group(1)))
        if v["id"] in known:
            continue
        slot = _slot_for(cfg, v["publish_at"], slots, filled)
        uploaded = v["uploaded"] and datetime.fromisoformat(v["uploaded"]).isoformat(timespec="seconds")
        uploads.record(slot.kind if slot else "channel", None, v["id"], v["publish_at"], slot.key if slot else None, at=uploaded)
        if slot:
            filled[slot.key] = (v["id"], v["publish_at"])
            print(f"slot {slot.at:%a %d %b %H:%M} already has https://youtu.be/{v['id']}")
        added += 1
    # A copy YouTube never processed doesn't count: the video is uploaded again under the same title.
    broken = uploads.broken_ids()
    settle_posted(cfg, now, [v.get("title", "") for v in videos if v["id"] not in broken])
    return added


def post_comments(cfg: Config, now: datetime) -> int:
    """Post the first comment on videos that have gone public since the last run."""
    if not youtube.can_manage():
        return 0
    uploads, posted = Uploads(cfg), 0
    for video_id, text in uploads.due_comments(now.isoformat()):
        try:
            youtube.post_comment(video_id, text)
        except Exception as e:  # e.g. comments turned off on the video; try again next run, up to 3 times
            print(f"warning: no comment on https://youtu.be/{video_id}: {e}")
            uploads.comment_done(video_id, ok=False)
            continue
        uploads.comment_done(video_id, ok=True)
        print(f"commented on https://youtu.be/{video_id}: {text}")
        posted += 1
    return posted


def fill(cfg: Config, now: datetime | None = None, rng: random.Random | None = None, clock=time.monotonic) -> int:
    """Make and upload videos for the empty slots. Returns how many slots were filled."""
    if cfg.require_review:
        raise SystemExit("fill uploads automatically: set require_review: false in channel.yaml")
    if not youtube.authorised():
        raise SystemExit("fill needs YouTube access: add the YOUTUBE_TOKEN_JSON secret")
    now = now or utcnow()
    started = clock()
    sync(cfg, now)
    budget = uploads_left_today(cfg, now)
    free = empty_slots(cfg, now)
    print(f"{len(free)} empty slots in the next {cfg.schedule.buffer_days:g} days; {budget} uploads left today")
    filled = 0

    # Videos made earlier whose upload failed go first: they cost no rendering.
    for job in pending_jobs(cfg):
        kind = job.meta.get("format", "short")
        slot = next((s for s in free if s.kind == kind), None)
        if slot is None or budget <= 0:
            continue
        result = _upload(cfg, job, slot, rng, now)
        if result:
            shutil.rmtree(job.path)
            free.remove(slot)
            budget -= 1
            filled += 1
        elif result is None:
            budget = 0

    topics = Topics(cfg)
    failures = 0
    for slot in list(free):
        if budget <= 0:
            print("daily upload quota used up; the next run continues")
            break
        elapsed = (clock() - started) / 60
        if elapsed + MAKE_MINUTES[slot.kind] > cfg.schedule.max_run_minutes:
            print(f"not enough time left in this run for a {slot.kind} video; the next run continues")
            continue  # a Short may still fit after a skipped long video
        job = pipeline.make_next(cfg.model_copy(update={"format": slot.kind}), topics)
        if job is None or job.meta.get("status") != "approved":
            failures += 1
            if failures >= 3:
                print("::warning::3 videos in a row failed; stopping this run")
                break
            continue
        result = _upload(cfg, job, slot, rng, now)
        if result:
            budget -= 1
            filled += 1
        else:
            _keep_pending(cfg, job)
            if result is None:
                budget = 0

    # The schedule comes first; bonus videos only use what's left of the quota and the run.
    if budget > 0 and failures < 3:
        filled += bonus(cfg, now, rng, clock, started, budget, topics)
    return filled


BONUS_MIN_FIT = {"short": "bonus_min_fit", "long": "bonus_long_min_fit", "news": "news_min_fit"}
BONUS_FORMAT = {"short": "short", "long": "long", "news": "long"}  # news explainers are long videos


def bonus_due(cfg: Config, fmt: str, now: datetime) -> bool:
    """Whether a bonus video of this kind (short, long or news) is allowed now."""
    g = cfg.growth
    per_day = {
        "short": g.bonus_shorts_per_day,
        "long": g.bonus_longs_per_week / 7,
        "news": g.news_longs_per_week / 7,
    }[fmt]
    if per_day <= 0:
        return False
    uploads = Uploads(cfg)
    skip = uploads.note(f"bonus-{fmt}-skip-until")  # nothing fitting was trending when we last looked
    if skip and skip > now.isoformat():
        return False
    last = uploads.last(f"bonus-{fmt}")
    return last is None or last <= (now - timedelta(days=1 / per_day)).isoformat(timespec="seconds")


def bonus(cfg: Config, now: datetime, rng, clock, started: float, budget: int, topics: Topics) -> int:
    """Extra videos on topics trending on Wikipedia that fit the channel, and a weekly news explainer.
    Returns how many were uploaded."""
    from fyt import growth, wiki

    made = 0
    for kind in ("short", "long", "news"):
        fmt = BONUS_FORMAT[kind]
        if budget <= 0 or not bonus_due(cfg, kind, now):
            continue
        if (clock() - started) / 60 + MAKE_MINUTES[fmt] > cfg.schedule.max_run_minutes:
            print(f"not enough time left for a bonus {kind} video")
            continue
        min_fit = getattr(cfg.growth, BONUS_MIN_FIT[kind])
        try:
            if kind == "news":
                title = growth.pick_news(cfg, set(topics.titles()), min_fit, cfg.growth.news_min_chars)
            else:
                min_chars = cfg.wikipedia.long_min_chars if fmt == "long" else cfg.wikipedia.min_chars
                title = growth.pick_trending(cfg, set(topics.titles()), min_fit, min_chars)
        except Exception as e:
            print(f"::warning::could not check {'news' if kind == 'news' else 'trending'} topics: {e}")
            continue
        if title is None:
            print(f"nothing fits the channel for a bonus {kind} video right now")
            Uploads(cfg).set_note(f"bonus-{kind}-skip-until", (now + timedelta(hours=6)).isoformat())
            continue
        topic = wiki.news_topic_for(title) if kind == "news" else wiki.topic_for(title)
        topics.add([topic])
        topic_id, _ = topics.find(topic)
        topics.set(topic_id, "in_progress")
        vcfg = cfg.model_copy(update={"format": fmt})
        try:
            job = pipeline.make_video(vcfg, topic)
        except Exception as e:
            topics.set(topic_id, "failed")
            print(f"::warning::bonus {kind} failed: {topic}: {e}")
            continue
        topics.set(topic_id, "done", job.id)
        if job.meta.get("status") != "approved":
            continue
        # Trending topics go out soon: at a random minute within the jitter window from now.
        result = _upload(cfg, job, Slot(utcnow(), fmt), rng, now, kind=f"bonus-{kind}")
        if result:
            budget -= 1
            made += 1
        elif result is None:
            budget = 0
    return made


def report(cfg: Config, now: datetime | None = None) -> tuple[str, list[Slot]]:
    """A markdown table of the coming slots, and the ones in the next 24 hours that are still empty."""
    now = now or utcnow()
    filled = Uploads(cfg).filled()
    rows = ["| Goes live (UTC) | Kind | Video |", "|---|---|---|"]
    for s in upcoming_slots(cfg, now):
        video = f"https://youtu.be/{filled[s.key][0]}" if s.key in filled else "**empty**"
        rows.append(f"| {s.at:%a %d %b %H:%M} | {s.kind} | {video} |")
    pending = pending_jobs(cfg)
    if pending:
        rows.append(f"\n{len(pending)} made video(s) waiting to be uploaded.")
    soon = [s for s in upcoming_slots(cfg, now) if s.key not in filled and s.at <= now + timedelta(days=1)]
    return "\n".join(rows), soon


def needed(cfg: Config, now: datetime | None = None) -> bool:
    """Whether a fill run has anything to do (so a run can skip installing the renderer)."""
    now = now or utcnow()
    work = bool(empty_slots(cfg, now)) or any(bonus_due(cfg, kind, now) for kind in BONUS_FORMAT)
    return work and uploads_left_today(cfg, now) > 0
