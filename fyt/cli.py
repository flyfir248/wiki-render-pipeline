"""Command line: python -m fyt <command>. Run with --help for details."""

from __future__ import annotations

import json

import argparse
from pathlib import Path

from fyt import manifest as story_manifest
from fyt import pipeline, tts
from fyt.config import ROOT, load_config
from fyt.store import Topics, Uploads, find_job, list_jobs


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(prog="fyt", description="Faceless YouTube video pipeline")
    p.add_argument("--config", help="channel config (default: channel.yaml)")
    p.add_argument("--format", choices=["long", "short"], help="override the configured format")
    sub = p.add_subparsers(dest="cmd", required=True)

    d = sub.add_parser("demo", help="render the bundled demo script offline (no API keys needed)")
    d.add_argument("--voice", default="silent", choices=list(tts.PROVIDERS))

    m = sub.add_parser("make", help="build one video for a topic (no upload)")
    m.add_argument("topic", help='a topic, or "wiki:<Article title>" to build it from Wikipedia')
    m.add_argument("--script", type=Path, help="use an existing script.json instead of calling Claude")
    m.add_argument("--manifest", type=Path, help="with --script: the story manifest already read from it (skips reading it again)")
    m.add_argument("--no-localize", action="store_true", help="skip translating the title and description (a test render)")
    m.add_argument("--no-research", action="store_true", help="skip web research")
    m.add_argument("--voice", choices=list(tts.PROVIDERS))

    t = sub.add_parser("topics", help="manage the topic queue")
    tsub = t.add_subparsers(dest="action", required=True)
    tsub.add_parser("list")
    ta = tsub.add_parser("add")
    ta.add_argument("topic", nargs="+")
    ti = tsub.add_parser("ideate", help="ask Claude for new topics")
    ti.add_argument("-n", type=int, default=10)
    tw = tsub.add_parser("wiki", help="queue niche Wikipedia articles (or name specific ones)")
    tw.add_argument("title", nargs="*", help="article titles; omit to pick from the configured sources")
    tw.add_argument("-n", type=int, default=5)

    r = sub.add_parser("run", help="build the next N queued topics (uploads if review is off)")
    r.add_argument("--count", type=int, default=1)
    r.add_argument("--no-upload", action="store_true", help="only make the videos, even if review is off")

    n = sub.add_parser("news", help="make a long explainer on a recent news incident now")
    n.add_argument("--title", help="its Wikipedia article title (default: the strongest incident in yesterday's news)")
    n.add_argument("--no-upload", action="store_true", help="only make the video, even if review is off")

    sub.add_parser("fill", help="make and schedule videos for the empty publish slots (see `schedule`)")
    b = sub.add_parser("buffer", help="show the coming publish slots and which are filled")
    b.add_argument("--check", action="store_true", help="exit with an error if a slot in the next 24 hours is empty")
    b.add_argument("--needed", action="store_true", help="print yes/no: whether `fill` has work to do")

    sub.add_parser("jobs", help="list jobs and their status")
    a = sub.add_parser("approve", help="mark a reviewed job as approved")
    a.add_argument("job")
    a.add_argument("--upload", action="store_true", help="upload right away")
    u = sub.add_parser("upload", help="upload an approved job")
    u.add_argument("job")
    u.add_argument("--force", action="store_true", help="upload even if not approved")
    rp = sub.add_parser("replace", help="upload a reviewed re-render in place of the same article's scheduled video (the old one goes private)")
    rp.add_argument("job")
    pb = sub.add_parser("publish", help="upload a reviewed test render: in place of its article's scheduled video, else into the next empty slot")
    pb.add_argument("job")
    sub.add_parser("auth", help="authorise YouTube uploads (opens a browser)")
    sub.add_parser("stats", help="show views for uploaded videos")
    w = sub.add_parser("watchdog", help="find uploads YouTube never processed and queue them to upload again")
    w.add_argument("--out", default="watchdog.md", help="where to write the report when something is found")
    sub.add_parser("comments", help="post the first comment on videos that have gone public")
    sub.add_parser("cleanruns", help="delete old Actions runs once their uploads are confirmed on every platform")
    sub.add_parser("relabel", help="clear YouTube's AI-content label on the channel's recent videos")
    pl = sub.add_parser("playlists", help="file the channel's videos into series playlists (long and Shorts)")
    pl.add_argument("--max", type=int, default=40, help="most changes to make (50 quota units each)")
    po = sub.add_parser("posts", help="draft this week's Community tab posts, when due")
    po.add_argument("--out", default="posts.md")
    po.add_argument("--now", action="store_true", help="draft them even if this week's are done")

    rl = sub.add_parser("reel", help="write a Short's Instagram caption (instagram.txt); --post also posts it as a Reel")
    rl.add_argument("job")
    rl.add_argument("--post", action="store_true", help="post it to Instagram now")
    rl = sub.add_parser("reels", help="post Shorts that are public on YouTube to Instagram, Facebook and Threads (*.publish)")
    rl.add_argument("--hours", type=float, default=None, help="look back this far for Shorts not posted yet (default: instagram.max_age_hours)")
    it = sub.add_parser("ig-token", help="make the INSTAGRAM_TOKEN and INSTAGRAM_USER_ID secrets from a Graph API Explorer token")
    it.add_argument("--app-id", required=True)
    it.add_argument("--app-secret", required=True)
    it.add_argument("--token", required=True, help="a user token from the Graph API Explorer")

    sh = sub.add_parser("sheet", help="lay a video's frames out on one image, to check a render by eye")
    sh.add_argument("source", type=Path, help="a rendered video, or a props.json to draw frames from directly")
    sh.add_argument("--every", type=float, default=1.0, help="seconds between frames (at most 60 frames)")
    sh.add_argument("--out", type=Path, help="where to save the sheet (default: next to the source)")
    sh.add_argument("--public", type=Path, help="the job's public dir, for a props.json (default: next to it)")

    bn = sub.add_parser("bench", help="render the six-scene quality benchmark reel (16:9 unless --format short) with contact sheets, timing, loudness and a scoring sheet")
    bn.add_argument("--out", type=Path, default=Path("jobs/bench"))
    bn.add_argument("--compare", type=Path, nargs=2, metavar=("BEFORE", "AFTER"), help="instead of rendering, lay two runs' frames side by side (run folders, e.g. jobs/bench/abc1234)")
    bn.add_argument("--only", default="", help="comma-separated scenes to render (gimli, voyager, ghost-army, krakatoa, london, storm)")

    kt = sub.add_parser("kit", help="fetch the CC0 character kit (rigged people, animals, shared clips) into the model library")
    kt.add_argument("--out", type=Path, default=Path("assets/models/_kit"))
    kt.add_argument("--add", type=Path, help="import a hand-downloaded pack (the base characters or farm animals zip) instead")
    kt.add_argument("--picks", type=Path, nargs="+", help="import the models assets/library-picks.json picks from the pack zips in these folders instead")
    kt.add_argument("--only", default="", help="with --picks: import only this pack's picks")
    kt.add_argument("--sets", type=Path, nargs="+", help="import the set pieces assets/set-picks.json picks from the pack zips in these folders instead")

    ct = sub.add_parser("catalog", help="inspect every library model and set piece, record what each can do (assets/catalog.json) and print a coverage report")
    ct.add_argument("--rig", action="store_true", help="first rig the still library animals that have no skeleton yet")
    ct.add_argument("--report", type=Path, help="also write the report here")

    ac = sub.add_parser("assetcheck", help="test story-driven 3D on a fixed panel of things, without making a video")
    ac.add_argument("--out", type=Path, default=Path("jobs/assetcheck"))

    args = p.parse_args(argv)
    cfg = load_config(args.config)
    if args.format:
        cfg.format = args.format

    if args.cmd == "sheet":
        from fyt.sheet import contact_sheet

        print(contact_sheet(args.source, args.out, args.every, args.public))
        if args.source.suffix != ".json":
            from fyt.qa import static_spans

            for a, b in static_spans(args.source):
                print(f"still from {a:.1f}s to {b:.1f}s")
        return
    if args.cmd == "bench":
        from fyt import bench

        if args.compare:
            before, after = args.compare
            print(bench.compare(before, after, args.out / f"compare-{before.name}-{after.name}.png"))
            return
        cfg.format = args.format or "long"
        only = [x.strip() for x in args.only.split(",") if x.strip()] or None
        print(json.dumps(bench.run(cfg, args.out, only), indent=2))
        return
    if args.cmd == "kit":
        from fyt import kit

        if args.sets:
            from fyt import sets

            print(json.dumps(sets.import_sets(args.sets), indent=2))
            return
        if args.picks:
            from fyt import packs

            print(json.dumps(packs.import_picks(args.picks, only=args.only), indent=2))
            return
        print(json.dumps(kit.add(args.add) if args.add else kit.fetch(args.out), indent=2))
        return
    if args.cmd == "catalog":
        from fyt import catalog, rigging

        if args.rig:
            print(json.dumps(rigging.rig_library(), indent=2))
        text = catalog.report(catalog.build())
        if args.report:
            args.report.parent.mkdir(parents=True, exist_ok=True)
            args.report.write_text(text)
        print(text)
        return
    if args.cmd == "assetcheck":
        from fyt import assetcheck

        rows = assetcheck.run(cfg, args.out)
        print((args.out / "report.md").read_text())
        return
    if args.cmd == "demo":
        cfg.stock_footage = False
        cfg.target_minutes = 0.5  # the demo script is short
        script = pipeline.load_script(ROOT / "fixtures" / f"demo_script_{cfg.format}.json")
        job = pipeline.make_video(cfg, "demo: compound interest", script=script, voice=args.voice)
        print(f"\nVideo: {job.file('video.mp4')}\nThumbnail: {job.file('thumbnail.png')}")
    elif args.cmd == "make":
        if args.no_research:
            cfg.research = False
        if args.no_localize:
            cfg.youtube.localize = []
        script = pipeline.load_script(args.script) if args.script else None
        story = story_manifest.Manifest.model_validate_json(args.manifest.read_text()) if args.manifest and script else None
        job = pipeline.make_video(cfg, args.topic, script=script, voice=args.voice, story=story)
        print(f"\nVideo: {job.file('video.mp4')}\nReview it, then: python -m fyt approve {job.id} --upload")
    elif args.cmd == "topics":
        topics = Topics(cfg)
        if args.action == "list":
            for row in topics.all():
                print(f"{row[0]:>4}  {row[2]:<12} {row[1]}" + (f"  -> {row[3]}" if row[3] else ""))
        elif args.action == "add":
            print(f"added {topics.add([' '.join(args.topic)])}")
        elif args.action == "wiki":
            from fyt import wiki

            titles = args.title or wiki.pick_articles(cfg, args.n, set(topics.titles()))
            print(f"added {topics.add([wiki.topic_for(t) for t in titles])}:")
            for t in titles:
                print(f"  - {t}")
        else:
            from fyt import llm

            ideas = llm.ideate_topics(cfg, args.n, topics.titles(), pipeline.performance_summary(cfg))
            print(f"added {topics.add(ideas)}:")
            for idea in ideas:
                print(f"  - {idea}")
    elif args.cmd == "fill":
        from fyt import schedule

        print(f"filled {schedule.fill(cfg)} slots")
    elif args.cmd == "buffer":
        from fyt import schedule

        if args.needed:
            print("yes" if schedule.needed(cfg) else "no")
            return
        table, soon = schedule.report(cfg)
        print(table)
        if args.check and soon:
            print(f"\n{len(soon)} slot(s) in the next 24 hours have no video yet.")
            raise SystemExit(1)
    elif args.cmd == "run":
        if args.no_upload:
            cfg.require_review = True
        done = pipeline.run_queue(cfg, args.count)
        if not done:
            raise SystemExit(f"no videos were made (asked for {args.count})")
        if len(done) < args.count:
            # Some videos are ready to download, so the run still counts as a success.
            print(f"::warning::only {len(done)} of {args.count} videos were made; see the log for why")
        for job in done:
            if job.meta.get("youtube_id"):
                print(f"{job.id}: https://youtu.be/{job.meta['youtube_id']}")
        if any(job.meta.get("status") == "upload_failed" for job in done):
            raise SystemExit("the video was made but the YouTube upload failed; see the error above")
    elif args.cmd == "news":
        from fyt import growth, wiki

        cfg.format = "long"
        if args.no_upload:
            cfg.require_review = True
        topics = Topics(cfg)
        title = args.title or growth.pick_news(cfg, set(topics.titles()), cfg.growth.news_min_fit, cfg.growth.news_min_chars)
        if not title:
            raise SystemExit("no recent incident is strong enough for an explainer right now")
        topic = wiki.news_topic_for(title)
        topics.add([topic])
        topic_id, _ = topics.find(topic)
        job = pipeline.make_video(cfg, topic)
        topics.set(topic_id, "done", job.id)
        if job.meta.get("status") == "approved":
            video_id = pipeline.upload_job(cfg, job)
            # Counted like the weekly explainer `fill` makes, so the week doesn't get a second one.
            Uploads(cfg).record("bonus-news", job.id, video_id, job.meta.get("publish_at"))
            print(f"{job.id}: https://youtu.be/{video_id}")
        else:
            print(f"{job.id}: {job.meta.get('status')}")
    elif args.cmd == "jobs":
        for j in list_jobs(cfg):
            m = j.meta
            extra = f" https://youtu.be/{m['youtube_id']}" if m.get("youtube_id") else ""
            print(f"{j.id:<60} {m.get('status', '?'):<10} {m.get('title', m.get('topic', ''))}{extra}")
    elif args.cmd == "approve":
        job = find_job(cfg, args.job)
        if job.meta.get("status") not in {"ready", "qa_failed"}:
            raise SystemExit(f"{job.id} is '{job.meta.get('status')}', nothing to approve")
        job.update(status="approved")
        print(f"approved {job.id}")
        if args.upload:
            pipeline.upload_job(cfg, job)
    elif args.cmd == "upload":
        pipeline.upload_job(cfg, find_job(cfg, args.job), force=args.force)
    elif args.cmd == "replace":
        from fyt import schedule

        schedule.replace(cfg, find_job(cfg, args.job))
    elif args.cmd == "publish":
        from fyt import schedule

        schedule.publish(cfg, find_job(cfg, args.job))
    elif args.cmd == "auth":
        from fyt import youtube

        youtube.auth()
    elif args.cmd == "comments":
        from datetime import datetime, timezone

        from fyt import schedule, youtube

        if youtube.authorised():
            print(f"posted {schedule.post_comments(cfg, datetime.now(timezone.utc))} comments")
    elif args.cmd == "cleanruns":
        from fyt import cleanup

        print(f"deleted {cleanup.run(cfg)} old runs")
    elif args.cmd == "watchdog":
        from fyt import watchdog

        print(f"{watchdog.run(cfg, args.out)} broken uploads found")
    elif args.cmd == "playlists":
        from fyt import playlists

        print(f"made {playlists.organise(cfg, args.max)} playlist changes")
    elif args.cmd == "posts":
        from datetime import datetime, timezone

        from fyt import posts

        if posts.write_drafts(cfg, datetime.now(timezone.utc), args.out, force=args.now):
            print(f"wrote this week's Community post drafts to {args.out}")
        else:
            print("no Community post drafts due")
    elif args.cmd == "reel":
        from fyt import instagram
        from fyt.models import Script

        job = find_job(cfg, args.job)
        path = instagram.write_caption(cfg, job, Script.model_validate_json(job.file("script.json").read_text()))
        print(path.read_text())
        if args.post:
            media_id = instagram.publish(cfg, job.file("video.mp4"), path.read_text().strip())
            if job.meta.get("youtube_id"):
                Uploads(cfg).queue_reel(job.meta["youtube_id"], job.id, None)
                Uploads(cfg).reel_done(job.meta["youtube_id"], media_id)
    elif args.cmd == "reels":
        import tempfile

        from fyt import crosspost, instagram

        if args.hours:  # catching up after the platforms were down: the runs keep their videos for a week
            cfg.instagram.max_age_hours = args.hours
        with tempfile.TemporaryDirectory() as tmp:  # run artifacts are fetched once for all three
            print(f"posted {instagram.post_due(cfg, tmp=Path(tmp))} Reels")
            for platform in crosspost.PLATFORMS:
                if getattr(cfg, platform).publish:
                    print(f"posted {crosspost.post_due(cfg, platform, tmp=Path(tmp))} to {platform.title()}")
    elif args.cmd == "ig-token":
        from fyt import instagram

        found = instagram.setup_token(args.app_id, args.app_secret, args.token)
        print(f"Instagram account @{found['username']} (linked to the Facebook Page {found['page']!r}).")
        print("Add these as repository secrets (Settings > Secrets and variables > Actions):\n")
        print(f"INSTAGRAM_USER_ID={found['user_id']}\nINSTAGRAM_TOKEN={found['token']}")
        if found["expires"]:
            print("\nThis token expires in about 60 days; run this again before then.")
    elif args.cmd == "relabel":
        from fyt import youtube

        ids = [v["id"] for v in youtube.recent_uploads(limit=200)]
        print(f"cleared the label on {youtube.set_synthetic_label(ids, cfg.youtube.contains_synthetic_media)} of {len(ids)} videos")
    elif args.cmd == "stats":
        from fyt import youtube

        if youtube.authorised():
            print(f"YouTube Analytics access: {'yes' if youtube.can_analyze() else 'no (add the yt-analytics.readonly scope)'}")
            if youtube.can_analyze():
                ids = [v["id"] for v in youtube.recent_uploads(limit=50)]
                try:
                    watched = youtube.retention(ids) if ids else {}
                    print(f"watch time read for {len(watched)} of {len(ids)} recent videos\n")
                except Exception as e:  # most often: the YouTube Analytics API isn't enabled in the Cloud project
                    print(f"could not read watch time: {e}\n")
                try:
                    print(growth_report(youtube.channel_growth()))
                except Exception as e:
                    print(f"could not read subscriber numbers: {e}\n")
        print(pipeline.performance_summary(cfg, limit=100) or "no uploaded videos yet")
        from fyt import insights

        for fmt in ("short", "long"):
            cfg.format = fmt
            lessons = insights.scene_lessons(cfg)
            print(f"\n{fmt} videos, scene by scene:\n{lessons or '(not enough watch-time data yet)'}")
        if youtube.authorised() and youtube.can_analyze():
            try:
                print("\n" + insights.timeliness_report(cfg))
            except Exception as e:
                print(f"\ncould not compare timely and evergreen topics: {e}")


def growth_report(rows: list[dict], days: int = 28) -> str:
    """Views and subscribers over the last `days`, with how many viewers per 1,000 subscribed."""
    lines = [f"Subscribers, last {days} days:"]
    for r in rows:
        rate = r["gained"] / r["views"] * 1000 if r["views"] else 0.0
        lines.append(f"- {r['kind']}: {r['views']} views, +{r['gained']} / -{r['lost']} subscribers ({rate:.1f} per 1,000 views)")
    return "\n".join(lines) + "\n"


if __name__ == "__main__":
    main()
