"""End-to-end orchestration. Each step writes its output into the job folder,
so a failed run can be inspected and individual steps re-run."""

from __future__ import annotations

import json
import random
from datetime import datetime
from pathlib import Path

from fyt import artgen, growth, illustrate, insights, llm, media, qa, render, sfx, tts, wiki, youtube
from fyt.config import Config
from fyt.models import Media, RenderProps, Script, ThumbnailProps
from fyt.store import Job, Topics, Uploads, list_jobs
from fyt.timeline import build_props, to_srt


def log(job: Job, msg: str) -> None:
    print(f"[{job.id}] {msg}", flush=True)


def make_video(
    cfg: Config, topic: str, script: Script | None = None, voice: str | None = None, polish: bool | None = None
) -> Job:
    """Topic -> rendered video + thumbnail + captions, ready for review/upload.
    `polish` (default: when the script is written here) sharpens title, hook and thumbnail text."""
    job = Job.create(cfg, topic)
    try:
        _make(cfg, job, topic, script, voice, script is None if polish is None else polish)
    except Exception as e:
        job.update(status="failed", error=f"{type(e).__name__}: {e}")
        raise
    return job


def _make(cfg: Config, job: Job, topic: str, script: Script | None, voice: str | None, polish: bool = False) -> None:
    images: list[wiki.WikiImage] = []
    article = None
    if script is None:
        notes = ""
        if wiki.is_wiki_topic(topic):
            log(job, "fetching Wikipedia article")
            article = wiki.fetch_article(cfg, wiki.title_of(topic))
            notes = wiki.notes(article)
            job.file("research.md").write_text(notes)
            try:
                images = wiki.fetch_images(cfg, article.title)
            except Exception as e:  # images are a nice-to-have
                log(job, f"warning: no article images: {e}")
            log(job, f"{len(images)} article images available")
        elif cfg.research:
            log(job, "researching")
            notes = llm.research(cfg, topic)
            job.file("research.md").write_text(notes)
        subject = article.title if article else topic
        menu = wiki.image_menu(images)
        g = cfg.growth
        two_part = (
            cfg.format == "short" and article is not None and len(notes) >= g.two_part_min_chars
            and random.random() < g.two_part_share
        )
        news = wiki.is_news_topic(topic)
        two_part = two_part and not news
        log(job, "writing a news explainer" if news else "writing part 1 of a two-part script" if two_part else "writing script")
        script = _short_enough(
            cfg, job, subject, notes, article is not None, menu, llm.PART1_NOTE if two_part else "", news=news
        )
        if two_part:
            try:
                previous = " ".join(s.narration for s in script.scenes)
                note = llm.PART2_NOTE.format(previous=previous, message=script.core_message)
                log(job, "writing part 2")
                part2 = _short_enough(cfg, job, subject, notes, True, menu, note)
                job.file("part2.json").write_text(wiki_attribute(part2, article).model_dump_json(indent=2))
                last = script.scenes[-1]
                if "part two" not in last.narration.lower():
                    script.scenes[-1] = last.model_copy(update={"narration": last.narration.rstrip() + " Part two is up next."})
            except Exception as e:  # a single Short is still fine
                log(job, f"warning: no part 2 ({e}); making a single Short")
                two_part = False
        if article:
            script = wiki_attribute(script, article)
        if news and cfg.growth.news_series:
            script = script.model_copy(update={"series": cfg.growth.news_series})
    else:
        two_part = False
    # News titles stay as factual as the script wrote them; the polish pass is for curiosity hooks.
    if polish and cfg.growth.polish and not wiki.is_news_topic(topic):
        log(job, "sharpening title, hook and thumbnail text")
        try:
            # Part 1 ends on its cliffhanger, not a line looping back into the hook.
            script = growth.polish(cfg, script, performance_summary(cfg), loop=not two_part and not topic.startswith(CUT))
        except Exception as e:  # the unpolished script is still fine
            log(job, f"warning: polish failed: {e}")
    if two_part:
        script = script.model_copy(update={"title": f"{script.title[:88]} (Part 1)"})
        job.update(two_part=True)
    job.file("script.json").write_text(script.model_dump_json(indent=2))
    job.update(status="scripted", title=script.title, core_message=script.core_message)

    problems = qa.check_script(cfg, script)
    if problems:
        job.update(status="qa_failed", problems=problems)
        raise RuntimeError("script failed QA: " + "; ".join(problems))

    provider = voice or cfg.voice.provider
    log(job, f"voicing {len(script.scenes)} scenes with {provider}")
    clips_dir = job.file("clips")
    clips_dir.mkdir(exist_ok=True)
    clips = [tts.synthesize(cfg, s.narration, clips_dir / f"{i:03}.wav", provider) for i, s in enumerate(script.scenes)]
    spans = tts.join_clips(clips, cfg.voice.gap(cfg.format), job.public / "voice.wav")
    voice_src = None if provider == "silent" else "voice.wav"

    log(job, "fetching visuals")
    subject = article.title if article else (script.thumbnail_kicker or "")
    scene_media, credits, used = scene_visuals(cfg, job, script, images, topic, subject)
    if credits:
        script = script.model_copy(
            update={"description": script.description.rstrip() + "\n\nImages from Wikimedia Commons:\n" + "\n".join(credits)}
        )
        job.file("script.json").write_text(script.model_dump_json(indent=2))
    chapters = chapter_list(script, spans)
    if chapters:
        script = script.model_copy(update={"description": script.description.rstrip() + "\n\n" + chapters})
        job.file("script.json").write_text(script.model_dump_json(indent=2))
    job.file("youtube.txt").write_text(youtube.upload_sheet(cfg, script))
    music = media.pick_music(
        cfg, job.public, seconds=spans[-1][1] + 2 if spans else 60, seed=sum(map(ord, job.id)), mood=script.mood
    )

    if any(s.type == "story" for s in script.scenes):
        if cfg.story_art and artgen.provider():
            try:
                log(job, f"drawing story scenes ({artgen.provider()})")
                log(job, f"{artgen.illustrate(cfg, script, job.public, log=lambda m: log(job, m))} illustrations drawn")
            except Exception as e:  # emoji-style props below are the fallback
                log(job, f"warning: story art failed: {e}")
        try:
            missing = illustrate.add_props(script, job.public)
            if missing:
                log(job, f"{missing} story props had no matching illustration and are left out")
        except Exception as e:  # without illustrations, story scenes fall back to text
            log(job, f"warning: no story illustrations: {e}")
    effects = None
    if cfg.sound_effects:
        try:
            effects = sfx.write_all(job.public)
        except Exception as e:  # a video without sound effects is still a video
            log(job, f"warning: no sound effects: {e}")
    props = build_props(cfg, script, spans, [c.words for c in clips], scene_media, voice_src, music, effects)
    job.file("props.json").write_text(props.model_dump_json(indent=2))
    job.file("captions.srt").write_text(to_srt(props.captions))

    log(job, f"rendering {props.duration:.0f}s {cfg.format} video")
    video = render.render(job.file("props.json"), job.public, job.file("video.mp4"))

    log(job, "rendering thumbnail")
    # The subject's own photo makes a better thumbnail than a stock one.
    bg = next((m for i, m in sorted(scene_media.items()) if m.kind == "image" and ("wiki" in m.src or "commons" in m.src)), None)
    if bg is None and cfg.stock_footage:
        try:
            bg = media.fetch_photo(cfg, script.thumbnail_query, job.public, "thumb-bg", used)
        except Exception as e:
            log(job, f"warning: no stock thumbnail background: {e}")
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


def _short_enough(
    cfg: Config, job: Job, subject: str, notes: str, from_wiki: bool, menu: str, note: str = "", news: bool = False
) -> Script:
    """Write the script, asking once more for a shorter one when a Short runs long."""
    lessons = insights.scene_lessons(cfg)
    if lessons:
        log(job, "using watch-time lessons: " + lessons.replace("\n", " "))
    script = llm.write_script(
        cfg, subject, notes, from_wikipedia=from_wiki, images=menu, feedback=note, news=news, lessons=lessons
    )
    limit = llm.SHORT_WORDS * 1.25 if cfg.format == "short" else None
    if limit and narration_words(script) > limit:
        log(job, f"script is {narration_words(script)} words; asking for a shorter one")
        feedback = (
            f"Your previous draft had {narration_words(script)} words of narration. "
            f"This is a Short: keep the total narration under {llm.SHORT_WORDS} words."
        )
        script = llm.write_script(
            cfg,
            subject,
            notes,
            from_wikipedia=from_wiki,
            images=menu,
            feedback=f"{note}\n\n{feedback}".strip(),
            news=news,
            lessons=lessons,
        )
    return script


def chapter_list(script: Script, spans: list[tuple[float, float]]) -> str:
    """YouTube chapter timestamps for the description, or "" when YouTube wouldn't accept them
    (it needs at least 3 chapters, the first at 0:00, each at least 10 seconds long)."""
    marks = [c for c in script.chapters or [] if 0 <= c.scene < len(spans)]
    if len(marks) < 3 or marks[0].scene != 0:
        return ""
    starts = [0.0] + [spans[c.scene][0] for c in marks[1:]]
    ends = starts[1:] + [spans[-1][1]]
    if any(e - s < 10 for s, e in zip(starts, ends)):
        return ""
    stamp = lambda t: f"{int(t) // 60}:{int(t) % 60:02}"  # noqa: E731
    return "Chapters:\n" + "\n".join(f"{stamp(t)} {c.title}" for t, c in zip(starts, marks))


def narration_words(script: Script) -> int:
    return sum(len(s.narration.split()) for s in script.scenes)


def scene_visuals(
    cfg: Config, job: Job, script: Script, images: list["wiki.WikiImage"], topic: str, subject: str = ""
) -> tuple[dict[int, Media], list[str], set[str]]:
    """Pick a visual for each scene: the article image the script chose, else stock footage for
    the scene's search query. With `visuals_every_scene`, scenes still without one (charts, numbers,
    quotes) get a real photo behind them: a spare article image, a Wikimedia Commons photo, or a
    stock photo. Returns media per scene, image credits, and the stock ids used."""
    used: set[str] = set()
    scene_media: dict[int, Media] = {}
    credits: list[str] = []
    taken: set[int] = set()
    (job.public / "media").mkdir(parents=True, exist_ok=True)

    def use_image(i: int, im: "wiki.WikiImage", rel: str) -> bool:
        try:
            wiki.download_image(im, job.public / rel)
        except Exception as e:
            log(job, f"warning: could not download {im.title}: {e}")
            return False
        scene_media[i] = Media(src=rel, kind="image")
        credits.append(im.credit)
        return True

    def article_image(i: int, n: int) -> bool:
        im = images[n - 1]
        ext = im.url.rsplit(".", 1)[-1].split("?")[0].lower()
        if not use_image(i, im, f"media/wiki{n}.{ext if ext in ('jpg', 'jpeg', 'png', 'webp') else 'jpg'}"):
            return False
        taken.add(n)
        return True

    for i, s in enumerate(script.scenes):
        n = s.image
        if n is not None and 1 <= n <= len(images) and n not in taken and article_image(i, n):
            continue
        # Data scenes (charts, numbers, lists) get their photo in the second pass, behind the chart.
        wants_stock = s.type == "broll" or (s.broll_query and s.type in ("title", "statement", "quote"))
        if wants_stock:
            try:
                m = media.fetch_broll(cfg, s.broll_query or s.heading or topic, job.public, f"s{i + 1}", used)
            except Exception as e:  # stock footage is optional; fall back to the plain background
                log(job, f"warning: no stock footage for scene {i + 1}: {e}")
                m = None
            if m:
                scene_media[i] = m
    # Open on the subject: if the title scene has nothing, give it the first unused article image.
    if 0 not in scene_media and script.scenes and images:
        n = next((k for k in range(1, len(images) + 1) if k not in taken), None)
        if n is not None:
            article_image(0, n)

    if cfg.growth.visuals_every_scene:
        commons_seen: set[str] = set()

        def commons(query: str) -> list["wiki.WikiImage"]:
            try:
                found = wiki.search_commons(query)
            except Exception as e:  # Commons is a nice-to-have
                log(job, f"warning: Commons search failed for {query!r}: {e}")
                return []
            return [im for im in found if im.title not in commons_seen]

        for i, s in enumerate(script.scenes):
            if i in scene_media or s.type in ("map", "story"):  # these draw their own picture
                continue
            n = next((k for k in range(1, len(images) + 1) if k not in taken), None)
            if n is not None and article_image(i, n):
                continue
            query = s.broll_query or s.heading or ""
            found = (commons(f"{subject} {query}".strip()) if subject and query else []) or (commons(subject) if subject else [])
            if found and use_image(i, found[0], f"media/commons{i + 1}.jpg"):
                commons_seen.add(found[0].title)
                continue
            try:
                m = media.fetch_photo(cfg, query or subject or topic, job.public, f"p{i + 1}", used) if cfg.stock_footage else None
            except Exception as e:
                log(job, f"warning: no stock photo for scene {i + 1}: {e}")
                m = None
            if m:
                scene_media[i] = m

    kinds = [("wiki" in m.src or "commons" in m.src) for m in scene_media.values()]
    log(job, f"visuals: {sum(kinds)} Wikipedia/Commons images, {len(kinds) - sum(kinds)} stock, "
        f"{len(script.scenes) - len(scene_media)} scenes on plain background")
    return scene_media, credits, used


def wiki_attribute(script: Script, article: "wiki.Article") -> Script:
    """CC BY-SA requires attribution: put it in the description and sources."""
    description = script.description.rstrip()
    if article.attribution not in description:
        description += "\n\n" + article.attribution
    sources = script.sources if article.url in script.sources else [article.url, *script.sources]
    return script.model_copy(update={"description": description, "sources": sources})


def upload_job(cfg: Config, job: Job, force: bool = False, publish_at: datetime | None = None) -> str:
    status = job.meta.get("status")
    if job.meta.get("youtube_id") and status != "uploaded":
        # A previous attempt got the video onto YouTube, then failed on a later step.
        job.update(status="uploaded")
        return job.meta["youtube_id"]
    if status == "uploaded":
        raise SystemExit(f"{job.id} is already uploaded: https://youtu.be/{job.meta.get('youtube_id')}")
    if status not in ("approved", "upload_failed") and not force:
        raise SystemExit(f"{job.id} is '{status}'. Review it, then `python -m fyt approve {job.id}` (or --force).")
    script = Script.model_validate_json(job.file("script.json").read_text())
    cfg = cfg.model_copy(update={"format": job.meta.get("format", cfg.format)})  # e.g. #Shorts in the description
    # Decide the publish time here (it may be a random minute ahead) so the first comment waits for it.
    publish_at = publish_at or youtube.publish_time(cfg)
    posted_at = publish_at.isoformat() if publish_at else None
    video_id = youtube.upload(
        cfg,
        script,
        job.file("video.mp4"),
        job.file("thumbnail.png"),
        job.file("captions.srt"),
        publish_at=publish_at,
        on_uploaded=lambda vid: job.update(youtube_id=vid, publish_at=posted_at),
    )
    job.update(status="uploaded", youtube_id=video_id, publish_at=publish_at.isoformat() if publish_at else None)
    if script.comment_question.strip() and cfg.growth.first_comment:
        # Comments only work once the video is public, so `fill` posts it after the publish time.
        Uploads(cfg).queue_comment(video_id, script.comment_question.strip(), publish_at.isoformat() if publish_at else None)
    if script.series and youtube.can_manage():
        try:
            youtube.add_to_playlist(video_id, script.series)
        except Exception as e:  # the video is up; the playlist is a nice-to-have
            print(f"warning: not added to the {script.series!r} playlist: {e}")
    if cfg.format == "long":
        queue_cuts(cfg, script, video_id, news=wiki.is_news_topic(job.meta.get("topic", "")))
    if job.file("part2.json").exists():
        queue_part2(cfg, job, video_id)
    return video_id


def queue_part2(cfg: Config, job: Job, video_id: str) -> None:
    """Queue part 2 of a two-part Short; it fills the next Short slot and links back to part 1."""
    part2 = load_script(job.file("part2.json"))
    part1 = load_script(job.file("script.json"))
    part2 = part2.model_copy(
        update={
            "series": part1.series,  # the same playlist as part 1
            "title": f"{part2.title[:88]} (Part 2)",
            "description": f"Part 1: https://youtu.be/{video_id}\n\n{part2.description}",
        }
    )
    folder = cfg.jobs_path / "cuts"
    folder.mkdir(parents=True, exist_ok=True)
    name = f"{video_id}-part2"
    (folder / f"{name}.json").write_text(part2.model_dump_json(indent=2))
    Topics(cfg).add([CUT + name])
    print(f"queued part 2 of https://youtu.be/{video_id}")


CUT = "cut:"


def queue_cuts(cfg: Config, script: Script, video_id: str, news: bool = False) -> None:
    """Queue Shorts cut from a long video; they fill the next regular Short slots.
    Cuts from a news explainer keep its factual title and hook (no polish pass)."""
    try:
        cuts = growth.cut_scripts(cfg, script, video_id, cfg.growth.cuts_per_long)
    except Exception as e:
        print(f"warning: no Shorts cut from {video_id}: {e}")
        return
    folder = cfg.jobs_path / "cuts"
    folder.mkdir(parents=True, exist_ok=True)
    names = []
    for i, cut in enumerate(cuts, 1):
        name = f"{video_id}-{'news-' if news else ''}{i}"
        (folder / f"{name}.json").write_text(cut.model_dump_json(indent=2))
        names.append(CUT + name)
    if names:
        Topics(cfg).add(names)
        print(f"queued {len(names)} Shorts cut from https://youtu.be/{video_id}")


def next_topic(cfg: Config, topics: Topics, ideate_when_empty: int = 10) -> tuple[int, str] | None:
    """The next topic to make, refilling the queue when it runs dry."""
    if cfg.format == "long" and cfg.source == "wikipedia":
        nxt = long_topic(cfg, topics)
    else:
        nxt = topics.next_pending(prefix=CUT) or topics.next_pending(exclude_prefix=CUT)
    if nxt is None and ideate_when_empty:
        if cfg.seed_topics:
            topics.add(cfg.seed_topics)
        nxt = topics.next_pending()
        if nxt is None and cfg.source == "wikipedia":
            titles = growth.pick_topics(cfg, min(ideate_when_empty, 3), set(topics.titles()), performance=performance_summary(cfg))
            topics.add([wiki.topic_for(t) for t in titles])
            nxt = topics.next_pending()
        if nxt is None:
            topics.add(llm.ideate_topics(cfg, ideate_when_empty, topics.titles(), performance_summary(cfg)))
            nxt = topics.next_pending()
    return nxt


def make_next(cfg: Config, topics: Topics, attempts: int = 3) -> Job | None:
    """Make a video from the next topic that works, trying up to `attempts` topics."""
    for _ in range(attempts):
        try:
            nxt = next_topic(cfg, topics)
        except Exception as e:  # Wikipedia or the LLM is down
            print(f"::warning::could not pick a topic: {e}")
            return None
        if nxt is None:
            print("no topics available")
            return None
        topic_id, topic = nxt
        topics.set(topic_id, "in_progress")
        try:
            job = make_topic(cfg, topic)
        except Exception as e:
            topics.set(topic_id, "failed")
            print(f"::warning::failed: {topic}: {e}")
            continue
        topics.set(topic_id, "done", job.id)
        return job
    return None


def make_topic(cfg: Config, topic: str) -> Job:
    """A queued topic -> video. Cuts from long videos come with their script ready."""
    if not topic.startswith(CUT):
        return make_video(cfg, topic)
    path = cfg.jobs_path / "cuts" / f"{topic[len(CUT):]}.json"
    # Part 2 opens with its recap, which a new hook would replace.
    job = make_video(cfg, topic, script=load_script(path), polish=not topic.endswith("-part2") and "-news-" not in topic)
    path.unlink(missing_ok=True)
    return job


def run_queue(cfg: Config, count: int = 1, ideate_when_empty: int = 10) -> list[Job]:
    """Take the next topics from the queue, build videos, upload the ones that need no review."""
    topics = Topics(cfg)
    done: list[Job] = []
    for _ in range(count):
        nxt = next_topic(cfg, topics, ideate_when_empty)
        if nxt is None:
            print("no topics available")
            break
        topic_id, topic = nxt
        topics.set(topic_id, "in_progress")
        try:
            job = make_topic(cfg, topic)
        except Exception as e:
            topics.set(topic_id, "failed")
            print(f"failed: {topic}: {e}")
            continue
        topics.set(topic_id, "done", job.id)
        if job.meta.get("status") == "approved":
            if not youtube.authorised():
                print("::warning::not uploaded: add the YOUTUBE_TOKEN_JSON secret to turn on uploads")
                job.update(status="ready")
            else:
                try:
                    upload_job(cfg, job)
                    Uploads(cfg).record(cfg.format, job.id, job.meta["youtube_id"], job.meta.get("publish_at"))
                except Exception as e:  # keep the video; it is still saved with the run
                    print(f"::error::upload failed for {job.id}: {e}")
                    job.update(status="upload_failed", upload_error=str(e)[:500])
        done.append(job)
    return done


def long_topic(cfg: Config, topics: Topics) -> tuple[int, str] | None:
    """A fresh article with enough material for a long video. The queue is filled with
    Short-sized articles, so long videos pick their own."""
    titles = growth.pick_topics(
        cfg, 1, set(topics.titles()), min_chars=cfg.wikipedia.long_min_chars, performance=performance_summary(cfg)
    )
    if not titles:
        return None
    topics.add([wiki.topic_for(titles[0])])
    return topics.find(wiki.topic_for(titles[0]))


_performance: dict[tuple, str] = {}  # one lookup per run: every video made in it gets the same answer
MIN_VIEWS_FOR_RETENTION = 30  # below this, how long people watched is mostly noise


def performance_summary(cfg: Config, limit: int = 10) -> str:
    """What has worked on the channel, fed back into topic choice and packaging. With YouTube
    Analytics access: the videos people watched furthest and the ones they left soonest. Otherwise
    the top videos by views."""
    key = (str(cfg.jobs_path), limit)
    if key not in _performance:
        _performance[key] = _performance_summary(cfg, limit)
    return _performance[key]


def _performance_summary(cfg: Config, limit: int) -> str:
    uploaded = {j.meta["youtube_id"] for j in list_jobs(cfg) if j.meta.get("youtube_id")}
    uploaded |= set(Uploads(cfg).video_ids())
    if not uploaded or not youtube.can_manage():  # reading stats needs more than the upload scope
        return ""
    try:
        rows = youtube.stats(list(uploaded))
    except Exception as e:  # stats are a nice-to-have
        print(f"warning: could not fetch stats: {e}")
        return ""
    watched: dict[str, dict] = {}
    if youtube.can_analyze():
        try:
            watched = youtube.retention(list(uploaded))
        except Exception as e:
            print(f"warning: could not fetch watch time: {e}")
    rated = [r for r in rows if watched.get(r["id"], {}).get("views", 0) >= MIN_VIEWS_FOR_RETENTION]
    if len(rated) >= 4:
        rated.sort(key=lambda r: watched[r["id"]]["percent"], reverse=True)
        line = lambda r: (  # noqa: E731
            f"- {r['title']}: {r['views']} views, watched {watched[r['id']]['percent']:.0f}% on average"
        )
        keep = max(2, limit * 2 // 3)
        best = "\n".join(line(r) for r in rated[:keep])
        worst = "\n".join(line(r) for r in rated[keep:][-max(1, limit - keep):])
        return f"Held viewers best:\n{best}" + (f"\nLost viewers soonest (avoid what these did):\n{worst}" if worst else "")
    rows.sort(key=lambda r: r["views"], reverse=True)
    return "\n".join(f"- {r['title']}: {r['views']} views, {r['likes']} likes" for r in rows[:limit])


def load_script(path: Path) -> Script:
    return Script.model_validate(json.loads(path.read_text()))
