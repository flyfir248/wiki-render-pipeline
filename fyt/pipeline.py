"""End-to-end orchestration. Each step writes its output into the job folder,
so a failed run can be inspected and individual steps re-run."""

from __future__ import annotations

import json
import random
import re
from datetime import datetime
from pathlib import Path

from fyt import artdirect, artgen, assetlib, assets, cutout, factcheck, growth, illustrate, insights, instagram, llm, localize, media, playlists, qa, qcheck, relevance, render, sfx, sheet, shotlist, storyboard, tts, visualplan, wiki, worldgen, youtube
from fyt import manifest as story_manifest
from fyt.config import Config
from fyt.models import DRAWN, Media, RenderProps, Script, ThumbnailProps
from fyt.store import Job, Topics, Uploads, list_jobs
from fyt.timeline import build_props, to_srt


def log(job: Job, msg: str) -> None:
    print(f"[{job.id}] {msg}", flush=True)
    try:  # kept with the job too, so a test render's report carries its log
        with open(job.file("log.txt"), "a") as f:
            f.write(msg + "\n")
    except OSError:
        pass


def make_video(
    cfg: Config, topic: str, script: Script | None = None, voice: str | None = None, polish: bool | None = None,
    story: "story_manifest.Manifest | None" = None,
) -> Job:
    """Topic -> rendered video + thumbnail + captions, ready for review/upload.
    `polish` (default: when the script is written here) sharpens title, hook and thumbnail text.
    `story`, a manifest already read from this same script, skips reading it again (a test re-render)."""
    job = Job.create(cfg, topic)
    try:
        _make(cfg, job, topic, script, voice, script is None if polish is None else polish, story)
    except Exception as e:
        job.update(status="failed", error=f"{type(e).__name__}: {e}")
        raise
    return job


def _make(cfg: Config, job: Job, topic: str, script: Script | None, voice: str | None, polish: bool = False,
          given_story: "story_manifest.Manifest | None" = None) -> None:
    images: list[wiki.WikiImage] = []
    article = None
    written = script is None
    notes = ""
    if script is None:
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
                if cfg.fact_check:
                    log(job, "checking part 2's facts against the source")
                    part2, wrong = factcheck.verify(cfg, part2, notes, log=lambda m: log(job, m))
                    if wrong:
                        raise RuntimeError("part 2 failed the fact check: " + "; ".join(wrong))
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
    if written:
        script = keep_short(cfg, job, script)
        script = make_sense(cfg, job, script)
        script = check_facts(cfg, job, script, notes)
    # the script as written and checked, before any visual is planned: a test can re-render from it
    job.file("written.json").write_text(script.model_dump_json(indent=2))
    if given_story is not None:
        story = given_story
        job.file("manifest.json").write_text(story_manifest.dumps(story))
        log(job, f"story (given): {', '.join(e.name for e in story.entities) or 'no showable entities'}; {len(story.moments)} moments")
    else:
        story = read_story(cfg, job, script, notes)
    script = plan_visuals(cfg, job, script, notes, story)
    script, found = story_models(cfg, job, script, story)
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
    if cfg.format == "long" and cfg.long_min_minutes and spans and spans[-1][1] < cfg.long_min_minutes * 60:
        minutes = spans[-1][1] / 60
        print(f"::warning::{job.id} narration runs {minutes:.1f} min, under the {cfg.long_min_minutes:g} min for mid-roll ads")
    job.update(narration_seconds=round(spans[-1][1], 1) if spans else 0)
    voice_src = None if provider == "silent" else "voice.wav"

    log(job, "fetching visuals")
    subject = article.title if article else (script.thumbnail_kicker or "")
    scene_media, credits, used = scene_visuals(cfg, job, script, images, topic, subject)
    shots = extra_shots(cfg, job, script, images, spans, scene_media, credits, used, subject)
    if cfg.collage.enabled:
        scene_media, shots = collage(cfg, job, scene_media, shots)
    if credits:
        script = script.model_copy(
            update={"description": script.description.rstrip() + "\n\nImages from Wikimedia Commons:\n" + "\n".join(credits)}
        )
        job.file("script.json").write_text(script.model_dump_json(indent=2))
    model_credits = assetlib.credits(found)
    if model_credits:
        script = script.model_copy(
            update={"description": script.description.rstrip() + "\n\n3D models:\n" + "\n".join(model_credits)}
        )
        job.file("script.json").write_text(script.model_dump_json(indent=2))
    chapters = chapter_list(script, spans)
    if chapters:
        script = script.model_copy(update={"description": script.description.rstrip() + "\n\n" + chapters})
        job.file("script.json").write_text(script.model_dump_json(indent=2))
    job.file("youtube.txt").write_text(youtube.upload_sheet(cfg, script))
    if cfg.format == "short" and cfg.instagram.enabled:
        instagram.write_caption(cfg, job, script)
    if cfg.youtube.localize:
        log(job, f"translating the title and description ({', '.join(cfg.youtube.localize)})")
        translated = localize.translate(cfg, script, log=lambda m: log(job, m))
        if translated:
            job.file("localizations.json").write_text(json.dumps(translated, ensure_ascii=False, indent=2))
    music = media.pick_music(
        cfg, job.public, seconds=spans[-1][1] + 2 if spans else 60, seed=sum(map(ord, job.id)), mood=script.mood
    )

    drawn = 0
    if any(s.type == "story" for s in script.scenes):
        if cfg.story_art and artgen.provider():
            try:
                log(job, f"drawing story scenes ({artgen.provider()})")
                drawn = artgen.illustrate(cfg, script, job.public, log=lambda m: log(job, m))
                log(job, f"{drawn} illustrations drawn")
            except Exception as e:  # emoji-style props below are the fallback
                log(job, f"warning: story art failed: {e}")
        try:
            missing = illustrate.add_props(script, job.public)
            if missing:
                log(job, f"{missing} story props had no matching illustration and are left out")
        except Exception as e:  # without illustrations, story scenes fall back to text
            log(job, f"warning: no story illustrations: {e}")
    drawn += stage_backdrops(cfg, job, script)
    script = relevance_gate(cfg, job, script, story, spans, [c.words for c in clips], scene_media, shots)
    beats = {}
    if cfg.storyboard and artgen.provider() and not artgen.out_of_allowance():
        staged = script
        script, back = visualplan.painted(script)
        if back:
            log(job, f"scenes {[i + 1 for i in back]}: illustrative 3D swapped for painted storyboard pictures, so the video keeps one style")
            job.file("script.json").write_text(script.model_dump_json(indent=2))
        try:
            log(job, "storyboarding: an illustration for each sentence")
            beats = storyboard.make(
                cfg, script, spans, [c.words for c in clips], job.public, log=lambda m: log(job, m), drawn=drawn,
                known={e.name: e.look for e in story.entities} if story else None,
            )
        except Exception as e:  # the scenes still have their own graphics and photos
            log(job, f"warning: storyboard failed: {e}")
        undrawn = [i for i in back if not beats.get(i)]
        if undrawn:  # a painted picture that never came: the 3D scene beats a bare text card
            script = script.model_copy(update={"scenes": [staged.scenes[i] if i in undrawn else sc for i, sc in enumerate(script.scenes)]})
            log(job, f"scenes {[i + 1 for i in undrawn]}: no painted picture was drawn, so their 3D scenes stay")
            job.file("script.json").write_text(script.model_dump_json(indent=2))
    effects = None
    if cfg.sound_effects:
        try:
            effects = sfx.write_all(job.public)
        except Exception as e:  # a video without sound effects is still a video
            log(job, f"warning: no sound effects: {e}")
    missing = assets.stage(script, job.public)
    if missing:
        log(job, f"warning: library models missing, drawing the procedural ones: {missing}")
        script = script.model_copy(update={"scenes": [
            s.model_copy(update={"model": assets.generic(s), "label": assets.label(s, assets.generic(s))}) if (s.model or {}).get("src") in missing else s
            for s in script.scenes
        ]})
    profile = artdirect.choose(script, news=wiki.is_news_topic(topic)) if cfg.visuals.art_direction else None
    if profile:
        log(job, f"art direction: {profile}")
        job.update(art_direction=profile)
    plan_report = json.loads(job.file("visualplan.json").read_text()) if job.file("visualplan.json").exists() else None
    words = [c.words for c in clips]
    for attempt in (1, 2):
        props = build_props(cfg, script, spans, words, scene_media, voice_src, music, effects, shots, beats, look=profile)
        job.file("props.json").write_text(props.model_dump_json(indent=2))
        job.file("captions.srt").write_text(to_srt(props.captions))
        job.file("shotlist.json").write_text(shotlist.dumps(shotlist.build(script, props, profile, plan_report)))
        before = qcheck.before_render(cfg, script, props, job.public)
        for w in before.warnings:
            log(job, f"quality: {w}")
        if before.problems:
            job.file("qc.json").write_text(json.dumps(before.as_dict(), indent=2))
            job.update(status="qa_failed", problems=before.problems)
            raise RuntimeError("failed the quality gate before rendering: " + "; ".join(before.problems))

        log(job, f"rendering {props.duration:.0f}s {cfg.format} video")
        video = render.render(job.file("props.json"), job.public, job.file("video.mp4"))
        after = qcheck.after_render(cfg, script, props, video, voiced=provider != "silent")
        for w in after.warnings:
            log(job, f"quality: {w}")
        if after.repair and attempt == 1:
            # A 3D scene that failed to draw goes back to the scene it replaced, and the video renders again.
            script = qcheck.repaired(script, after.repair)
            job.file("script.json").write_text(script.model_dump_json(indent=2))
            continue
        break
    qc = before.as_dict()
    qc["checks"] |= after.checks
    qc["problems"] += after.problems
    qc["warnings"] += after.warnings
    qc["repaired"] = after.repair if attempt == 2 else []
    try:  # the 3D scenes judged as pictures: flat frames and unpolished shots, kept with their frames
        look = qcheck.look_check(cfg, script, props, video, job.file("look"))
        frames = look.checks.pop("look_frames", [])
        job.file("look.json").write_text(json.dumps({"warnings": look.warnings, "frames": frames}, indent=2))
        for w in look.warnings:
            log(job, f"look: {w}")
        qc["checks"] |= look.checks
        qc["warnings"] += look.warnings
    except Exception as e:
        log(job, f"warning: could not check the 3D look: {str(e)[:160]}")

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

    problems = qa.check_render(cfg, props, video, voiced=provider != "silent") + qc["problems"]
    try:  # a held picture loses viewers: say where, so the template or script can be fixed
        for a, b in qa.static_spans(video, until=props.duration - props.endCard):
            log(job, f"warning: the picture barely changes from {a:.0f}s to {b:.0f}s")
            qc["warnings"].append(f"the picture barely changes from {a:.0f}s to {b:.0f}s")
    except Exception as e:
        log(job, f"warning: could not check for still stretches: {e}")
    try:  # kept with the job, so a person reviewing it sees the whole video at a glance
        sheet.contact_sheet(video, job.file("contact.png"), every=1.0 if cfg.format == "short" else 4.0)
    except Exception as e:
        log(job, f"warning: no contact sheet: {e}")
    job.file("qc.json").write_text(json.dumps(qc, indent=2))
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
    limit = llm.SHORT_MAX_WORDS if cfg.format == "short" else None
    if limit and narration_words(script) > limit:
        log(job, f"script is {narration_words(script)} words; asking for a shorter one")
        feedback = (
            f"Your previous draft had {narration_words(script)} words of narration. "
            f"This is a Short: keep the total narration under {llm.SHORT_WORDS} words."
        )
        retry = llm.write_script(
            cfg,
            subject,
            notes,
            from_wikipedia=from_wiki,
            images=menu,
            feedback=f"{note}\n\n{feedback}".strip(),
            news=news,
            lessons=lessons,
        )
        if narration_words(retry) < narration_words(script):
            script = retry
    elif limit and narration_words(script) < llm.SHORT_MIN_WORDS:
        # Too thin a Short skips the context, and then the story makes no sense to a newcomer.
        log(job, f"script is only {narration_words(script)} words; asking for a fuller one")
        feedback = (
            f"Your previous draft had only {narration_words(script)} words of narration, too few to follow. "
            f"Write about {llm.SHORT_WORDS} words: say who or what this is and why the hook is true before the build."
        )
        retry = llm.write_script(
            cfg,
            subject,
            notes,
            from_wikipedia=from_wiki,
            images=menu,
            feedback=f"{note}\n\n{feedback}".strip(),
            news=news,
            lessons=lessons,
        )
        if narration_words(script) < narration_words(retry) <= limit:
            script = retry
    return script


def keep_short(cfg: Config, job: Job, script: Script) -> Script:
    """A Short over about 40 seconds loses viewers before its payoff: tighten its narration once."""
    words = narration_words(script)
    if cfg.format != "short" or words <= llm.SHORT_MAX_WORDS:
        return script
    log(job, f"script is {words} words; tightening it to about {llm.SHORT_WORDS}")
    try:
        tight = llm.tighten(cfg, script)
    except Exception as e:  # a long Short is still a Short
        log(job, f"warning: could not tighten the script: {e}")
        return script
    return tight if narration_words(tight) < words else script


def make_sense(cfg: Config, job: Job, script: Script) -> Script:
    """A Short is heard once at speed: check it tells one followable story, and fix the lines that don't."""
    if cfg.format != "short":
        return script
    try:
        fixed, problems = llm.mend(cfg, script)
    except Exception as e:  # the script as written is still a Short
        log(job, f"warning: could not check the story: {e}")
        return script
    if problems:
        log(job, "story fixed where it lost the thread: " + "; ".join(problems))
    return fixed


def check_facts(cfg: Config, job: Job, script: Script, notes: str) -> Script:
    """Every figure, date, name and quote, said or shown, must match the source before the video is made.
    Claims that are wrong are rewritten from the source once; any that still fail stop the video, and so
    does a check that can't run: a wrong fact on a public video costs more than one skipped topic."""
    if not cfg.fact_check or not notes.strip():
        return script
    log(job, "checking facts against the source")
    try:
        script, problems = factcheck.verify(cfg, script, notes, log=lambda m: log(job, m))
    except Exception as e:
        problems = [f"the fact check could not run: {e}"]
    if problems:
        cut = without_failed_scenes(script, problems)
        if cut is not None:
            log(job, f"dropped the scenes the source doesn't back after a rewrite: {'; '.join(problems)[:300]}")
            return cut
        job.file("script.json").write_text(script.model_dump_json(indent=2))
        job.update(status="qa_failed", problems=problems)
        raise RuntimeError("script failed the fact check: " + "; ".join(problems))
    log(job, "facts check out")
    return script


MIN_SCENES_LEFT = 5


def without_failed_scenes(script: Script, problems: list[str]) -> Script | None:
    """The script with the scenes that still fail the fact check taken out, when that is a clean cut:
    every problem names a scene, the opening scene is not one of them, at most two go, and at least
    MIN_SCENES_LEFT remain. Otherwise None, and the video stops. A claim cut is a claim not made."""
    bad = set()
    for p in problems:
        m = re.match(r"scene (\d+):", p)
        if not m:
            return None
        bad.add(int(m.group(1)))
    n = len(script.scenes)
    if 1 in bad or len(bad) > 2 or n - len(bad) < MIN_SCENES_LEFT or any(not 1 <= k <= n for k in bad):
        return None
    return script.model_copy(update={"scenes": [sc for i, sc in enumerate(script.scenes, 1) if i not in bad]})


def read_story(cfg: Config, job: Job, script: Script, notes: str) -> "story_manifest.Manifest | None":
    """The story's asset manifest (fyt/manifest.py): its entities, places and showable moments, read
    from the fact-checked script before any picture is chosen. Written to manifest.json."""
    if not (cfg.visuals.plan and cfg.visuals.story_assets):
        return None
    log(job, "reading the story: what it shows")
    try:
        story = story_manifest.analyse(cfg, script, notes)
    except Exception as e:  # without it, 3D comes only from the catalog's guarded keyword plan
        log(job, f"warning: could not read the story's entities ({str(e)[:160]}); 3D limited to the catalog's guarded plan")
        return None
    job.file("manifest.json").write_text(story_manifest.dumps(story))
    log(job, f"story: {', '.join(e.name for e in story.entities) or 'no showable entities'}; {len(story.moments)} moments")
    return story


def story_models(cfg: Config, job: Job, script: Script, story: "story_manifest.Manifest | None") -> tuple[Script, dict]:
    """Models for the entities the plan put on the 3D stage (fyt/assetlib.py), one per entity for the
    whole video; a stage scene whose entity has no usable model goes back to its 2D scene. The video's
    asset registry is written to assets.json."""
    if story is None:
        return script, {}
    wanted = assetlib.wanted(script, story)
    if cfg.visuals.story_worlds:
        # People and animals are always generated in their story world: a found mesh has no rig our verbs can drive.
        # and a river or an airport is its set, not a model to find
        wanted = {k: v for k, v in wanted.items() if worldgen.archetype_of(story_manifest.entity(story, k)) not in worldgen.LIVING
                  and not worldgen.is_place(story_manifest.entity(story, k))}
    if wanted and "image_to_3d" in cfg.visuals.asset_sources:
        log(job, assetlib.generator_status(cfg))
    found = assetlib.resolve_all(cfg, story, wanted, log=lambda m: log(job, m)) if wanted else {}
    srcs = assetlib.stage(found, job.public)
    if cfg.visuals.story_worlds:
        script, back = story_worlds(cfg, job, script, story, found, srcs)
    else:
        script, back = assetlib.attach(script, story, found, srcs)
    if back:
        log(job, f"scenes {[i + 1 for i in back]}: no model of their entity, so they stay 2D")
    job.file("assets.json").write_text(json.dumps(assetlib.registry(story, found), indent=2))
    return script, found


def story_worlds(cfg: Config, job: Job, script: Script, story: "story_manifest.Manifest", found: dict, srcs: dict[str, str]) -> tuple[Script, list[int]]:
    """Each stage scene's world generated for this story (fyt/worldgen.py): a build for every entity in
    it, a setting for its place, and a shot that blocks who does what. Found models draw the non-living
    things they match; everything else is procedural. The record of how each asset was made goes to
    world.json. Returns (script, scene indexes put back to 2D)."""
    staged = [i + 1 for i, s in enumerate(script.scenes) if s.type == "world" and s.subject == "stage" and story_manifest.entity(story, s.subject_name)]
    if not staged:
        return script, []
    ids = list(dict.fromkeys(e.id for k in staged for e in story_manifest.in_scene(story, k) if not worldgen.is_place(e)))
    log(job, f"building the story world: {len(ids)} entities for {len(staged)} scenes")
    style, builds, settings, made = worldgen.design(cfg, script, story, ids, log=lambda m: log(job, m))
    shots, made["direction"] = worldgen.direct(cfg, script, story, builds, staged, log=lambda m: log(job, m))
    models = {}
    for eid, a in found.items():
        if eid in srcs:
            models[eid] = {"id": a["key"], "src": srcs[eid], "fit": a.get("fit") or assetlib.facing(story_manifest.entity(story, eid)),
                           "clips": a.get("clips", []), "licence": a.get("licence"), "title": a.get("title")}
    seed = sum(map(ord, script.title)) & 0xFFFF
    scenes, back = list(script.scenes), []
    for i, s in enumerate(scenes):
        if s.type != "world" or s.subject != "stage":
            continue
        shot = shots.get(i + 1)
        e = story_manifest.entity(story, s.subject_name)
        if shot is None or e is None:
            scenes[i] = assetlib.back_to_2d(s)
            back.append(i)
            continue
        lead = shot.actors[0].entity
        m = models.get(lead) if builds[lead].archetype not in worldgen.LIVING else None
        model = {"id": m["id"] if m else f"world:{lead}", "level": "found" if m else "procedural", "title": (m or {}).get("title"),
                 "kind": "object", "src": (m or {}).get("src"), "params": {}, "sources": [], "licence": (m or {}).get("licence"),
                 "notes": f"story world: {builds[lead].archetype} built for {story_manifest.entity(story, lead).name}"}
        lead_e = story_manifest.entity(story, lead)
        label = "ILLUSTRATION" if s.illustrative else "RECONSTRUCTION" if (m and lead_e.certain) else "RECONSTRUCTION · ILLUSTRATIVE"
        scenes[i] = s.model_copy(update={"subject_name": lead, "world": worldgen.world_of(style, seed, shot, builds, settings, models),
                                         "model": model, "label": label})
    job.file("world.json").write_text(json.dumps(worldgen.record(style, builds, settings, shots, made, models), indent=2))
    log(job, f"story world ({style}): cast {made['cast']}, sets {made['sets']}, direction {made['direction']}; "
             + ", ".join(f"{b.entity} as {b.archetype}" for b in builds.values()))
    return script.model_copy(update={"scenes": scenes}), back


def stage_backdrops(cfg: Config, job: Job, script: Script) -> int:
    """A painted plate of its place behind each stage scene, in the house style, one per place."""
    if not artgen.provider():
        return 0
    made = 0
    vertical = cfg.format == "short"
    for i, s in enumerate(script.scenes):
        if s.type != "world" or s.subject != "stage" or s.world or not s.backdrop or artgen.out_of_allowance():
            continue
        name = f"art/plate-{artgen._key(s.backdrop, str(vertical))}.jpg"
        try:
            if not (job.public / name).exists():
                (job.public / "art").mkdir(parents=True, exist_ok=True)
                artgen.generate(f"{artgen.PLATE.format(scene=s.backdrop)} {artgen.STYLE}", vertical, seed=11 + i).save(job.public / name, quality=90)
                made += 1
            script.scenes[i] = s.model_copy(update={"backdrop_src": name})
        except Exception as e:  # the stage draws its own sky and ground instead
            log(job, f"warning: no painted place for scene {i + 1}: {e}")
    return made


def relevance_gate(cfg: Config, job: Job, script: Script, story, spans, words, scene_media, shots) -> Script:
    """Every 3D scene shows what the story is about (fyt/relevance.py), or goes back to 2D."""
    text = relevance.text_gate(script, story)
    if text:
        for i, why in text.items():
            log(job, f"scene {i + 1}: 3D dropped: {why}")
        script = relevance.apply(script, text)
    checked = [i for i, s in enumerate(script.scenes) if relevance.is_3d(s)]
    picture: dict[int, str] = {}
    if checked and cfg.review_model:
        missing = assets.stage(script, job.public)
        if missing:
            script = qcheck.repaired(script, [i for i, s in enumerate(script.scenes) if (s.model or {}).get("src") in missing])
        props = build_props(cfg, script, spans, words, scene_media, None, None, None, shots, {})
        job.file("gate-props.json").write_text(props.model_dump_json())
        log(job, f"relevance: checking {len(checked)} 3D scenes by eye")
        picture = relevance.picture_gate(cfg, script, story, props, job.file("gate-props.json"), job.public, job.file("gate"), log=lambda m: log(job, m))
        for i, why in picture.items():
            log(job, f"scene {i + 1}: 3D dropped: {why}")
            m = script.scenes[i].model or {}
            if m.get("level") in ("found", "generated") and m.get("id"):
                assetlib.forget(m["id"], why)  # the next video searches past it
        script = relevance.apply(script, picture)
    job.file("relevance.json").write_text(relevance.dumps(text, picture, checked))
    if text or picture:
        job.file("script.json").write_text(script.model_dump_json(indent=2))
    return script


def plan_visuals(cfg: Config, job: Job, script: Script, notes: str, story=None) -> Script:
    """Every video's visual plan (fyt/visualplan.py): which moments become 3D reconstructions, guarded
    so they show only what the narration says. Written to visualplan.json next to the script."""
    if not cfg.visuals.plan:
        return assets.resolve(visualplan.apply(script, [], notes)[0])
    log(job, "planning the visuals")
    try:
        planned, report = visualplan.plan(cfg, script, notes, log=lambda m: log(job, m), story=story)
    except Exception as e:  # the scriptwriter's own scenes still make a video
        log(job, f"warning: visual planning failed: {e}")
        return assets.resolve(visualplan.apply(script, [], notes)[0])
    job.file("visualplan.json").write_text(visualplan.dumps(report))
    log(job, visualplan.summary(report))
    if report["dropped_for_budget"]:
        log(job, f"kept within the 3D render budget: scenes {report['dropped_for_budget']} keep their 2D template")
    job.update(visual_plan=visualplan.summary(report))
    return planned


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
            if i in scene_media or s.type in DRAWN:
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


MAX_EXTRA_SHOTS = 2  # per scene; the renderer re-frames the photos it has for any further cuts


def extra_shots(
    cfg: Config,
    job: Job,
    script: Script,
    images: list["wiki.WikiImage"],
    spans: list[tuple[float, float]],
    scene_media: dict[int, Media],
    credits: list[str],
    used: set[str],
    subject: str = "",
) -> dict[int, list[Media]]:
    """More photos for a Short's longer scenes, so the picture changes every `shot_seconds`: spare
    article images first, then Wikimedia Commons, then stock photos. Adds their credits."""
    every = cfg.growth.shot_seconds
    if cfg.format != "short" or not every or not spans:
        return {}
    (job.public / "media").mkdir(parents=True, exist_ok=True)
    taken = {m.src for m in scene_media.values()}
    spare = [(k, im) for k, im in enumerate(images, 1) if not any(src.startswith(f"media/wiki{k}.") for src in taken)]
    seen = {c.split(" (")[0] for c in credits}
    shots: dict[int, list[Media]] = {}
    commons_cache: dict[str, list["wiki.WikiImage"]] = {}

    def commons(query: str) -> list["wiki.WikiImage"]:
        if query not in commons_cache:
            try:
                commons_cache[query] = wiki.search_commons(query)
            except Exception as e:  # Commons is a nice-to-have
                log(job, f"warning: Commons search failed for {query!r}: {e}")
                commons_cache[query] = []
        return [im for im in commons_cache[query] if im.title.removeprefix("File:") not in seen]

    def download(im: "wiki.WikiImage", rel: str) -> Media | None:
        seen.add(im.title.removeprefix("File:"))  # tried once, whatever happens
        try:
            wiki.download_image(im, job.public / rel)
        except Exception as e:
            log(job, f"warning: could not download {im.title}: {e}")
            return None
        credits.append(im.credit)
        return Media(src=rel, kind="image")

    for i, s in enumerate(script.scenes):
        m = scene_media.get(i)
        if m is None or m.kind != "image" or s.type in DRAWN:
            continue
        start = 0.0 if i == 0 else spans[i][0]
        end = spans[i + 1][0] if i + 1 < len(spans) else spans[i][1]
        want = min(MAX_EXTRA_SHOTS, int((end - start) // every) - 1)
        got: list[Media] = []
        while len(got) < want:
            name = f"media/shot{i + 1}-{len(got) + 1}"
            if spare:
                _, im = spare.pop(0)
                found = download(im, f"{name}.jpg")
            else:
                query = s.broll_query or s.heading or ""
                hits = (commons(f"{subject} {query}".strip()) if subject and query else []) or (commons(subject) if subject else [])
                found = download(hits[0], f"{name}.jpg") if hits else None
                if not found and cfg.stock_footage:
                    try:
                        found = media.fetch_photo(cfg, query or subject, job.public, name.removeprefix("media/"), used)
                    except Exception as e:
                        log(job, f"warning: no stock photo for scene {i + 1}: {e}")
                if not found:
                    break
            if found:
                got.append(found)
        if got:
            shots[i] = got
    if shots:
        log(job, f"cutaways: {sum(len(v) for v in shots.values())} extra photos across {len(shots)} scenes")
    return shots


def collage(
    cfg: Config, job: Job, scene_media: dict[int, Media], shots: dict[int, list[Media]]
) -> tuple[dict[int, Media], dict[int, list[Media]]]:
    """Give every photo its collage print and, where it has a clear subject, a cut-out (fyt/cutout.py).
    A photo that can't be styled stays as it is; if the model can't be loaded, all of them do."""
    done: dict[str, Media] = {}
    cuts = 0

    def styled(m: Media) -> Media:
        nonlocal cuts
        if m.kind != "image":
            return m
        if m.src not in done:
            try:
                bg, cut, aspect = cutout.stylize(cfg, job.public, m.src, seed=len(done))
                done[m.src] = m.model_copy(update={"styled": bg, "cutout": cut, "aspect": aspect})
                cuts += cut is not None
            except Exception as e:
                log(job, f"warning: no collage for {m.src}: {e}")
                done[m.src] = m
        return done[m.src]

    photos = [m for m in [*scene_media.values(), *(m for ms in shots.values() for m in ms)] if m.kind == "image"]
    if not photos:
        return scene_media, shots
    try:
        cutout._load(cfg)
    except Exception as e:
        log(job, f"warning: collage look skipped, cut-out model unavailable: {e}")
        return scene_media, shots
    scene_media = {i: styled(m) for i, m in scene_media.items()}
    shots = {i: [styled(m) for m in ms] for i, ms in shots.items()}
    log(job, f"collage: {len(done)} photos styled, {cuts} with a cut-out subject")
    return scene_media, shots


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
        localizations=json.loads(job.file("localizations.json").read_text()) if job.file("localizations.json").exists() else None,
    )
    job.update(status="uploaded", youtube_id=video_id, publish_at=publish_at.isoformat() if publish_at else None)
    if script.comment_question.strip() and cfg.growth.first_comment:
        # Comments only work once the video is public, so `fill` posts it after the publish time.
        Uploads(cfg).queue_comment(video_id, script.comment_question.strip(), publish_at.isoformat() if publish_at else None)
    if cfg.format == "short" and cfg.instagram.enabled:
        # Posted as a Reel by `fyt reels` once the Short is public on YouTube.
        Uploads(cfg).queue_reel(video_id, job.id, publish_at.isoformat() if publish_at else None)
    if script.series and youtube.can_manage():
        try:
            playlists.file_upload(cfg, video_id, script.series)
        except Exception as e:  # the video is up; the playlist is a nice-to-have
            print(f"warning: not added to the {script.series!r} playlist: {e}")
    if cfg.format == "long" and not job.meta.get("reupload_of"):  # the first upload already queued its Shorts
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
    gained: dict[str, int] = {}
    if youtube.can_analyze():
        try:
            watched = youtube.retention(list(uploaded))
        except Exception as e:
            print(f"warning: could not fetch watch time: {e}")
        try:
            gained = youtube.subscribers_gained(list(uploaded))
        except (Exception, SystemExit) as e:  # a nice-to-have on top of watch time
            print(f"warning: could not fetch subscribers gained: {e}")
    subs = lambda r: f", {_subscribers(gained[r['id']])}" if r["id"] in gained else ""  # noqa: E731
    converted = subscriber_winners(rows, gained)
    rated = [r for r in rows if watched.get(r["id"], {}).get("views", 0) >= MIN_VIEWS_FOR_RETENTION]
    if len(rated) >= 4:
        rated.sort(key=lambda r: watched[r["id"]]["percent"], reverse=True)
        line = lambda r: (  # noqa: E731
            f"- {r['title']}: {r['views']} views, watched {watched[r['id']]['percent']:.0f}% on average{subs(r)}"
        )
        keep = max(2, limit * 2 // 3)
        best = "\n".join(line(r) for r in rated[:keep])
        worst = "\n".join(line(r) for r in rated[keep:][-max(1, limit - keep):])
        return (
            f"Held viewers best:\n{best}"
            + (f"\nLost viewers soonest (avoid what these did):\n{worst}" if worst else "")
            + converted
        )
    rows.sort(key=lambda r: r["views"], reverse=True)
    return "\n".join(f"- {r['title']}: {r['views']} views, {r['likes']} likes{subs(r)}" for r in rows[:limit]) + converted


MIN_VIEWS_FOR_CONVERSION = 100  # below this, one subscriber swings the rate too much


def _subscribers(n: int) -> str:
    return f"{n} new subscriber{'' if n == 1 else 's'}"


def subscriber_winners(rows: list[dict], gained: dict[str, int], limit: int = 5) -> str:
    """The videos that turned the largest share of their viewers into subscribers: what makes
    someone want more of the channel, not just finish one video."""
    rated = [r for r in rows if gained.get(r["id"], 0) > 0 and r["views"] >= MIN_VIEWS_FOR_CONVERSION]
    if not rated:
        return ""
    rated.sort(key=lambda r: gained[r["id"]] / r["views"], reverse=True)
    lines = "\n".join(
        f"- {r['title']}: {_subscribers(gained[r['id']])} from {r['views']} views" for r in rated[:limit]
    )
    return f"\nWon the most subscribers per view (topics and titles viewers want a whole channel of):\n{lines}"


def load_script(path: Path) -> Script:
    return Script.model_validate(json.loads(path.read_text()))
