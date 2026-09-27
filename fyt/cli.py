"""Command line: python -m fyt <command>. Run with --help for details."""

from __future__ import annotations

import argparse
from pathlib import Path

from fyt import pipeline, tts
from fyt.config import ROOT, load_config
from fyt.store import Topics, find_job, list_jobs


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(prog="fyt", description="Faceless YouTube video pipeline")
    p.add_argument("--config", help="channel config (default: channel.yaml)")
    p.add_argument("--format", choices=["long", "short"], help="override the configured format")
    sub = p.add_subparsers(dest="cmd", required=True)

    d = sub.add_parser("demo", help="render the bundled demo script offline (no API keys needed)")
    d.add_argument("--voice", default="silent", choices=list(tts.PROVIDERS))

    m = sub.add_parser("make", help="build one video for a topic (no upload)")
    m.add_argument("topic")
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

    r = sub.add_parser("run", help="build the next N queued topics (uploads if review is off)")
    r.add_argument("--count", type=int, default=1)

    sub.add_parser("jobs", help="list jobs and their status")
    a = sub.add_parser("approve", help="mark a reviewed job as approved")
    a.add_argument("job")
    a.add_argument("--upload", action="store_true", help="upload right away")
    u = sub.add_parser("upload", help="upload an approved job")
    u.add_argument("job")
    u.add_argument("--force", action="store_true", help="upload even if not approved")
    sub.add_parser("auth", help="authorise YouTube uploads (opens a browser)")
    sub.add_parser("stats", help="show views for uploaded videos")

    args = p.parse_args(argv)
    cfg = load_config(args.config)
    if args.format:
        cfg.format = args.format

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
        else:
            from fyt import llm

            ideas = llm.ideate_topics(cfg, args.n, topics.titles(), pipeline.performance_summary(cfg))
            print(f"added {topics.add(ideas)}:")
            for idea in ideas:
                print(f"  - {idea}")
    elif args.cmd == "run":
        pipeline.run_queue(cfg, args.count)
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
    elif args.cmd == "stats":
        print(pipeline.performance_summary(cfg, limit=100) or "no uploaded videos yet")


if __name__ == "__main__":
    main()
