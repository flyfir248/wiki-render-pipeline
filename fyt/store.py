"""Topic queue (SQLite) and per-job state (job.json in each job folder)."""

from __future__ import annotations

import json
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from fyt.config import Config


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class Topics:
    def __init__(self, cfg: Config):
        cfg.jobs_path.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(cfg.jobs_path / "state.db")
        self.db.execute(
            """create table if not exists topics (
                id integer primary key,
                topic text not null unique,
                status text not null default 'pending',  -- pending | in_progress | done | failed
                job text,
                created text not null
            )"""
        )
        self.db.commit()

    def add(self, topics: list[str]) -> int:
        cur = self.db.executemany(
            "insert or ignore into topics(topic, created) values (?, ?)", [(t.strip(), now()) for t in topics if t.strip()]
        )
        self.db.commit()
        return cur.rowcount

    def all(self) -> list[tuple]:
        return self.db.execute("select id, topic, status, job from topics order by id").fetchall()

    def titles(self) -> list[str]:
        return [r[0] for r in self.db.execute("select topic from topics")]

    def next_pending(self, prefix: str = "", exclude_prefix: str | None = None) -> tuple[int, str] | None:
        sql, args = "select id, topic from topics where status='pending' and topic like ?", [prefix + "%"]
        if exclude_prefix:
            sql += " and topic not like ?"
            args.append(exclude_prefix + "%")
        return self.db.execute(sql + " order by id limit 1", args).fetchone()

    def find(self, topic: str) -> tuple[int, str] | None:
        return self.db.execute("select id, topic from topics where topic=?", (topic.strip(),)).fetchone()

    def of_job(self, job: str) -> str | None:
        """The topic a job was made from, or None."""
        row = self.db.execute("select topic from topics where job=?", (job,)).fetchone()
        return row[0] if row else None

    def mark_done(self, topic: str) -> None:
        """Record a topic as already made (it stays done if it was)."""
        self.add([topic])
        self.db.execute("update topics set status='done' where topic=? and status='pending'", (topic.strip(),))
        self.db.commit()

    def set(self, topic_id: int, status: str, job: str | None = None) -> None:
        self.db.execute("update topics set status=?, job=coalesce(?, job) where id=?", (status, job, topic_id))
        self.db.commit()


class Uploads:
    """Every upload, and which publish slot it fills. Lives next to the topic queue in state.db."""

    def __init__(self, cfg: Config):
        cfg.jobs_path.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(cfg.jobs_path / "state.db")
        self.db.execute(
            """create table if not exists uploads (
                id integer primary key,
                slot text unique,          -- publish slot (UTC ISO time) this video fills; null for one-off uploads
                kind text not null,        -- short | long
                job text,
                youtube_id text,
                publish_at text,
                uploaded text not null
            )"""
        )
        # Added later; older state.db files get the columns here.
        have = {r[1] for r in self.db.execute("pragma table_info(uploads)")}
        if "run" not in have:  # the Actions run (id-attempt) whose artifact holds the video file
            self.db.execute("alter table uploads add column run text")
        if "problem" not in have:  # set when YouTube failed to process the video (see fyt/watchdog.py)
            self.db.execute("alter table uploads add column problem text")
        self.jobs = cfg.jobs_path
        # The scenes of each uploaded video (type, start, end), kept so watch-time curves can be
        # read scene by scene long after the job folder is gone.
        self.db.execute("create table if not exists outlines (youtube_id text primary key, outline text not null)")
        self.db.execute("create table if not exists notes (key text primary key, value text)")
        self.db.execute(
            """create table if not exists comments (
                youtube_id text primary key,
                text text not null,
                due text,                  -- when the video goes public (UTC ISO); null: already public
                tries integer not null default 0,
                posted text
            )"""
        )
        self.db.execute(
            """create table if not exists reels (
                youtube_id text primary key,
                job text,
                run text,                  -- the Actions run whose artifact holds the video file
                due text,                  -- when the Short goes public on YouTube (UTC ISO); null: already public
                tries integer not null default 0,
                media_id text,             -- the Reel's Instagram id, once posted
                posted text
            )"""
        )
        self.db.execute(
            """create table if not exists crossposts (
                youtube_id text not null,  -- a Short in reels
                platform text not null,    -- facebook, threads
                tries integer not null default 0,
                post_id text,
                posted text,
                primary key (youtube_id, platform)
            )"""
        )
        self.db.commit()

    def note(self, key: str) -> str | None:
        row = self.db.execute("select value from notes where key=?", (key,)).fetchone()
        return row[0] if row else None

    def set_note(self, key: str, value: str) -> None:
        self.db.execute("insert or replace into notes(key, value) values (?, ?)", (key, value))
        self.db.commit()

    def record(
        self, kind: str, job: str, youtube_id: str, publish_at: str | None, slot: str | None = None, at: str | None = None
    ) -> None:
        run = os.environ.get("GITHUB_RUN_ID")
        run = f"{run}-{os.environ.get('GITHUB_RUN_ATTEMPT', '1')}" if run else None
        self.db.execute(
            "insert into uploads(slot, kind, job, youtube_id, publish_at, uploaded, run) values (?, ?, ?, ?, ?, ?, ?)",
            (slot, kind, job, youtube_id, publish_at, at or now(), run),
        )
        # A video kept for a later run waits in jobs/pending.
        found = [p for p in (self.jobs / job / "props.json", self.jobs / "pending" / job / "props.json") if p.exists()] if job else []
        if youtube_id and found:
            self.save_outline(youtube_id, json.loads(found[0].read_text()))
        self.db.commit()

    def scheduled_for(self, slug: str, after: str) -> tuple[int, str, str | None, str, str] | None:
        """(row, youtube_id, slot, kind, publish_at) of the latest upload of the job slug (a job id without
        its time stamp) still due to go public after `after`."""
        return self.db.execute(
            "select id, youtube_id, slot, kind, publish_at from uploads where job like ? and youtube_id is not null"
            " and publish_at > ? order by id desc limit 1",
            (f"%-{slug}", after),
        ).fetchone()

    def upload_row(self, youtube_id: str) -> tuple[int, str, str | None, str, str] | None:
        return self.db.execute(
            "select id, youtube_id, slot, kind, publish_at from uploads where youtube_id=? order by id desc limit 1", (youtube_id,)
        ).fetchone()

    def retire(self, row: int, youtube_id: str) -> None:
        """An upload taken off the schedule: it frees its slot, and its comment and Reel are never posted."""
        self.db.execute("update uploads set slot=null, kind='replaced' where id=?", (row,))
        for table in ("comments", "reels", "crossposts"):
            self.db.execute(f"delete from {table} where youtube_id=?", (youtube_id,))
        self.db.commit()

    def save_outline(self, youtube_id: str, props: dict) -> None:
        outline = {
            "duration": props["duration"],
            "format": props.get("format"),
            "scenes": [[s["type"], s["start"], s["end"]] for s in props.get("scenes", [])],
        }
        self.db.execute("insert or replace into outlines(youtube_id, outline) values (?, ?)", (youtube_id, json.dumps(outline)))
        self.db.commit()

    def outlines(self) -> dict[str, dict]:
        return {vid: json.loads(o) for vid, o in self.db.execute("select youtube_id, outline from outlines")}

    def queue_comment(self, youtube_id: str, text: str, due: str | None) -> None:
        self.db.execute("insert or ignore into comments(youtube_id, text, due) values (?, ?, ?)", (youtube_id, text, due))
        self.db.commit()

    def due_comments(self, now: str, max_tries: int = 3) -> list[tuple[str, str]]:
        """(youtube_id, text) of comments whose video is public by now and that aren't posted yet."""
        rows = self.db.execute(
            "select youtube_id, text from comments where posted is null and tries < ? and (due is null or due <= ?)",
            (max_tries, now),
        )
        return rows.fetchall()

    def comment_done(self, youtube_id: str, ok: bool) -> None:
        if ok:
            self.db.execute("update comments set posted=? where youtube_id=?", (now(), youtube_id))
        else:
            self.db.execute("update comments set tries=tries+1 where youtube_id=?", (youtube_id,))
        self.db.commit()

    def queue_reel(self, youtube_id: str, job: str, due: str | None) -> None:
        run = os.environ.get("GITHUB_RUN_ID")
        run = f"{run}-{os.environ.get('GITHUB_RUN_ATTEMPT', '1')}" if run else None
        self.db.execute(
            "insert or ignore into reels(youtube_id, job, run, due) values (?, ?, ?, ?)", (youtube_id, job, run, due)
        )
        self.db.commit()

    def queue_recent_shorts(self, since: str) -> None:
        """Queue Shorts uploaded before Instagram posting was on, if they go public after `since`."""
        self.db.execute(
            "insert or ignore into reels(youtube_id, job, run, due) select youtube_id, job, run, publish_at from uploads"
            " where kind in ('short', 'timely-short', 'bonus-short') and job is not null and youtube_id is not null and problem is null"
            " and publish_at >= ?",
            (since,),
        )
        self.db.commit()

    def due_reels(self, now: str, since: str, max_tries: int = 6) -> list[tuple[str, str, str | None]]:
        """(youtube_id, job, run) of Shorts public on YouTube by now, but not since before `since`, not yet Reels."""
        rows = self.db.execute(
            "select youtube_id, job, run from reels where posted is null and tries < ?"
            " and coalesce(due, ?) <= ? and coalesce(due, ?) >= ? order by due",
            (max_tries, now, now, now, since),
        )
        return rows.fetchall()

    def reel_done(self, youtube_id: str, media_id: str | None) -> None:
        if media_id:
            self.db.execute("update reels set posted=?, media_id=? where youtube_id=?", (now(), media_id, youtube_id))
        else:
            self.db.execute("update reels set tries=tries+1 where youtube_id=?", (youtube_id,))
        self.db.commit()

    def due_crossposts(self, platform: str, now: str, since: str, max_tries: int = 6) -> list[tuple[str, str, str | None]]:
        """Like due_reels, for another platform: queued Shorts public by now, not yet posted there."""
        rows = self.db.execute(
            "select r.youtube_id, r.job, r.run from reels r left join crossposts c"
            " on c.youtube_id = r.youtube_id and c.platform = ?"
            " where c.posted is null and coalesce(c.tries, 0) < ?"
            " and coalesce(r.due, ?) <= ? and coalesce(r.due, ?) >= ? order by r.due",
            (platform, max_tries, now, now, now, since),
        )
        return rows.fetchall()

    def crosspost_done(self, youtube_id: str, platform: str, post_id: str | None) -> None:
        self.db.execute("insert or ignore into crossposts(youtube_id, platform) values (?, ?)", (youtube_id, platform))
        if post_id:
            self.db.execute(
                "update crossposts set posted=?, post_id=? where youtube_id=? and platform=?", (now(), post_id, youtube_id, platform)
            )
        else:
            self.db.execute("update crossposts set tries=tries+1 where youtube_id=? and platform=?", (youtube_id, platform))
        self.db.commit()

    def filled(self) -> dict[str, tuple[str, str]]:
        """slot -> (youtube_id, publish_at)"""
        rows = self.db.execute("select slot, youtube_id, publish_at from uploads where slot is not null")
        return {r[0]: (r[1], r[2]) for r in rows}

    def recent(self, since: str) -> list[dict]:
        """Uploads since this time (ISO) that have a video id and no problem recorded yet."""
        rows = self.db.execute(
            "select id, slot, kind, job, youtube_id, publish_at, uploaded, run from uploads"
            " where youtube_id is not null and problem is null and uploaded >= ?",
            (since,),
        )
        keys = ("id", "slot", "kind", "job", "youtube_id", "publish_at", "uploaded", "run")
        return [dict(zip(keys, r)) for r in rows]

    def mark_problem(self, youtube_id: str, problem: str) -> None:
        """Record that YouTube failed this video, and free its publish slot so it can be filled again."""
        self.db.execute("update uploads set problem=?, slot=null where youtube_id=?", (problem, youtube_id))
        self.db.commit()

    def broken_ids(self) -> set[str]:
        return {r[0] for r in self.db.execute("select youtube_id from uploads where problem is not null")}

    def video_ids(self) -> list[str]:
        return [r[0] for r in self.db.execute("select youtube_id from uploads where youtube_id is not null")]

    def last(self, kind: str) -> str | None:
        """When the last upload of this kind happened (ISO time), or None."""
        return self.db.execute("select max(uploaded) from uploads where kind=?", (kind,)).fetchone()[0]

    def publish_times(self, long: bool) -> list[str]:
        """When each Short (or each long video) went or goes public (ISO times). Uploads found on the
        channel without a known kind count as both, to be safe."""
        kinds = ("long", "bonus-long", "bonus-news")
        sql = "select publish_at from uploads where publish_at is not null and youtube_id is not null and problem is null and "
        sql += "(kind in (?, ?, ?) or kind='channel')" if long else "kind not in (?, ?, ?)"
        return [r[0] for r in self.db.execute(sql, kinds)]

    def count_since(self, since: str) -> int:
        return self.db.execute("select count(*) from uploads where uploaded >= ?", (since,)).fetchone()[0]


class Job:
    """A folder under jobs/ holding every artifact for one video."""

    def __init__(self, path: Path):
        self.path = path
        self.public = path / "public"
        self.meta_path = path / "job.json"
        self.meta: dict = json.loads(self.meta_path.read_text()) if self.meta_path.exists() else {}

    @classmethod
    def create(cls, cfg: Config, topic: str) -> "Job":
        slug = "".join(c if c.isalnum() else "-" for c in topic.lower())[:40].strip("-")
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        job = cls(cfg.jobs_path / f"{stamp}-{slug}")
        job.public.mkdir(parents=True)
        job.update(topic=topic, status="created", created=now(), format=cfg.format)
        return job

    @property
    def id(self) -> str:
        return self.path.name

    def update(self, **fields) -> None:
        self.meta.update(fields, updated=now())
        self.meta_path.write_text(json.dumps(self.meta, indent=2))

    def file(self, name: str) -> Path:
        return self.path / name


def list_jobs(cfg: Config) -> list[Job]:
    if not cfg.jobs_path.exists():
        return []
    return [Job(p) for p in sorted(cfg.jobs_path.iterdir()) if (p / "job.json").exists()]


def find_job(cfg: Config, ref: str) -> Job:
    p = Path(ref)
    if (p / "job.json").exists():
        return Job(p)
    matches = [j for j in list_jobs(cfg) if j.id.startswith(ref) or ref in j.id]
    if len(matches) != 1:
        raise SystemExit(f"job '{ref}' matched {len(matches)} jobs")
    return matches[0]
