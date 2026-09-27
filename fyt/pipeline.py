"""End-to-end orchestration. Each step writes its output into the job folder,
so a failed run can be inspected and individual steps re-run."""

from __future__ import annotations

import json
from pathlib import Path

from fyt import llm, media, qa, render, tts, wiki, youtube
from fyt.config import Config
from fyt.models import Media, RenderProps, Script, ThumbnailProps
from fyt.store import Job, Topics, list_jobs
from fyt.timeline import build_props, to_srt


def log(job: Job, msg: str) -> None:
    print(f"[{job.id}] {msg}", flush=True)


def make_video(cfg: Config, topic: str, script: Script | None = None, voice: str | None = None) -> Job:
    """Topic -> rendered video + thumbnail + captions, ready for review/upload."""
    job = Job.create(cfg, topic)
    try:
        _make(cfg, job, topic, script, voice)
    except Exception as e:
        job.update(status="failed", error=f"{type(e).__name__}: {e}")
        raise
    return job


def _make(cfg: Config, job: Job, topic: str, script: Script | None, voice: str | None) -> None:
    if script is None:
        notes, article = "", None
        if wiki.is_wiki_topic(topic):
            log(job, "fetching Wikipedia article")
            article = wiki.fetch_article(cfg, topic[len(wiki.PREFIX) :])
            notes = wiki.notes(article)
            job.file("research.md").write_text(notes)
        elif cfg.research:
            log(job, "researching")
            notes = llm.research(cfg, topic)
            job.file("research.md").write_text(notes)
        log(job, "writing script")
        script = llm.write_script(cfg, article.title if article else topic, notes, from_wikipedia=article is not None)
        if article:
            script = wiki_attribute(script, article)
    job.file("script.json").write_text(script.model_dump_json(indent=2))
    job.update(status="scripted", title=script.title)

    problems = qa.check_script(cfg, script)
    if problems:
        job.update(status="qa_failed", problems=problems)
        raise RuntimeError("script failed QA: " + "; ".join(problems))

    provider = voice or cfg.voice.provider
    log(job, f"voicing {len(script.scenes)} scenes with {provider}")
    clips_dir = job.file("clips")
    clips_dir.mkdir(exist_ok=True)
    clips = [tts.synthesize(cfg, s.narration, clips_dir / f"{i:03}.wav", provider) for i, s in enumerate(script.scenes)]
    spans = tts.join_clips(clips, cfg.voice.gap_seconds, job.public / "voice.wav")
    voice_src = None if provider == "silent" else "voice.wav"

    log(job, "fetching visuals")
    used: set[str] = set()
    scene_media: dict[int, Media] = {}
    for i, s in enumerate(script.scenes):
        if s.type == "broll":
            m = media.fetch_broll(cfg, s.broll_query or s.heading or topic, job.public, f"s{i + 1}", used)
            if m:
                scene_media[i] = m
    music = media.pick_music(cfg, job.public)

    props = build_props(cfg, script, spans, [c.words for c in clips], scene_media, voice_src, music)
    job.file("props.json").write_text(props.model_dump_json(indent=2))
    job.file("captions.srt").write_text(to_srt(props.captions))

    log(job, f"rendering {props.duration:.0f}s {cfg.format} video")
    video = render.render(job.file("props.json"), job.public, job.file("video.mp4"))

    log(job, "rendering thumbnail")
    bg = media.fetch_photo(cfg, script.thumbnail_query, job.public, "thumb-bg", used) if cfg.stock_footage else None
    thumb = ThumbnailProps(
        format=cfg.format,
        title=script.thumbnail_text,
        kicker=script.thumbnail_kicker.upper(),
        theme=cfg.theme.model_dump(),
        background=bg,
    )
    job.file("thumbnail.json").write_text(thumb.model_dump_json(indent=2))
    render.render(job.file("thumbnail.json"), job.public, job.file("thumbnail.png"), still=True)

    problems = qa.check_render(cfg, props, video, voiced=provider != "silent")
    status = "qa_failed" if problems else ("ready" if cfg.require_review else "approved")
    job.update(status=status, problems=problems, duration=props.duration)
    log(job, f"done: {status}" + (f" -- {problems}" if problems else ""))


def wiki_attribute(script: Script, article: "wiki.Article") -> Script:
    """CC BY-SA requires attribution: put it in the description and sources."""
    description = script.description.rstrip()
    if article.attribution not in description:
        description += "\n\n" + article.attribution
    sources = script.sources if article.url in script.sources else [article.url, *script.sources]
    return script.model_copy(update={"description": description, "sources": sources})


def upload_job(cfg: Config, job: Job, force: bool = False) -> str:
    status = job.meta.get("status")
    if status == "uploaded":
        raise SystemExit(f"{job.id} is already uploaded: https://youtu.be/{job.meta.get('youtube_id')}")
    if status != "approved" and not force:
        raise SystemExit(f"{job.id} is '{status}'. Review it, then `python -m fyt approve {job.id}` (or --force).")
    script = Script.model_validate_json(job.file("script.json").read_text())
    video_id = youtube.upload(cfg, script, job.file("video.mp4"), job.file("thumbnail.png"), job.file("captions.srt"))
    job.update(status="uploaded", youtube_id=video_id)
    return video_id


def run_queue(cfg: Config, count: int = 1, ideate_when_empty: int = 10) -> list[Job]:
    """Take the next topics from the queue, build videos, upload the ones that need no review."""
    topics = Topics(cfg)
    done: list[Job] = []
    for _ in range(count):
        nxt = topics.next_pending()
        if nxt is None and ideate_when_empty:
            if cfg.seed_topics:
                topics.add(cfg.seed_topics)
            nxt = topics.next_pending()
            if nxt is None and cfg.source == "wikipedia":
                titles = wiki.pick_articles(cfg, min(ideate_when_empty, 3), set(topics.titles()))
                topics.add([wiki.topic_for(t) for t in titles])
                nxt = topics.next_pending()
            if nxt is None:
                topics.add(llm.ideate_topics(cfg, ideate_when_empty, topics.titles(), performance_summary(cfg)))
                nxt = topics.next_pending()
        if nxt is None:
            print("no topics available")
            break
        topic_id, topic = nxt
        topics.set(topic_id, "in_progress")
        try:
            job = make_video(cfg, topic)
        except Exception as e:
            topics.set(topic_id, "failed")
            print(f"failed: {topic}: {e}")
            continue
        topics.set(topic_id, "done", job.id)
        if job.meta.get("status") == "approved":
            upload_job(cfg, job)
        done.append(job)
    return done


def performance_summary(cfg: Config, limit: int = 10) -> str:
    """Top uploaded videos by views, fed back into topic ideation."""
    uploaded = {j.meta["youtube_id"]: j for j in list_jobs(cfg) if j.meta.get("youtube_id")}
    if not uploaded:
        return ""
    try:
        rows = youtube.stats(list(uploaded))
    except Exception as e:  # stats are a nice-to-have
        print(f"warning: could not fetch stats: {e}")
        return ""
    rows.sort(key=lambda r: r["views"], reverse=True)
    return "\n".join(f"- {r['title']}: {r['views']} views, {r['likes']} likes" for r in rows[:limit])


def load_script(path: Path) -> Script:
    return Script.model_validate(json.loads(path.read_text()))
