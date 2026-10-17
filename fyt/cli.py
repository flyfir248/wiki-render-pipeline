"""Command line: python -m fyt <command>. Run with --help for details."""

from __future__ import annotations

import argparse
from pathlib import Path

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
    sub.add_parser("auth", help="authorise YouTube uploads (opens a browser)")
    sub.add_parser("stats", help="show views for uploaded videos")
    w = sub.add_parser("watchdog", help="find uploads YouTube never processed and queue them to upload again")
    w.add_argument("--out", default="watchdog.md", help="where to write the report when something is found")
    sub.add_parser("comments", help="post the first comment on videos that have gone public")
    sub.add_parser("relabel", help="clear YouTube's AI-content label on the channel's recent videos")
    pl = sub.add_parser("playlists", help="file the channel's videos into series playlists (long and Shorts)")
    pl.add_argument("--max", type=int, default=40, help="most changes to make (50 quota units each)")
    po = sub.add_parser("posts", help="draft this week's Community tab posts, when due")
    po.add_argument("--out", default="posts.md")
    po.add_argument("--now", action="store_true", help="draft them even if this week's are done")

    sh = sub.add_parser("sheet", help="lay a video's frames out on one image, to check a render by eye")
    sh.add_argument("source", type=Path, help="a rendered video, or a props.json to draw frames from directly")
    sh.add_argument("--every", type=float, default=1.0, help="seconds between frames (at most 60 frames)")
    sh.add_argument("--out", type=Path, help="where to save the sheet (default: next to the source)")
    sh.add_argument("--public", type=Path, help="the job's public dir, for a props.json (default: next to it)")

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
        script = pipeline.load_script(args.script) if args.script else None
        job = pipeline.make_video(cfg, args.topic, script=script, voice=args.voice)
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
    elif args.cmd == "auth":
        from fyt import youtube

        youtube.auth()
    elif args.cmd == "comments":
        from datetime import datetime, timezone

        from fyt import schedule, youtube

        if youtube.authorised():
            print(f"posted {schedule.post_comments(cfg, datetime.now(timezone.utc))} comments")
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


def growth_report(rows: list[dict], days: int = 28) -> str:
    """Views and subscribers over the last `days`, with how many viewers per 1,000 subscribed."""
    lines = [f"Subscribers, last {days} days:"]
    for r in rows:
        rate = r["gained"] / r["views"] * 1000 if r["views"] else 0.0
        lines.append(f"- {r['kind']}: {r['views']} views, +{r['gained']} / -{r['lost']} subscribers ({rate:.1f} per 1,000 views)")
    return "\n".join(lines) + "\n"


if __name__ == "__main__":
    main()
