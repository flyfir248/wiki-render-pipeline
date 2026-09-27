"""Topic queue (SQLite) and per-job state (job.json in each job folder)."""

from __future__ import annotations

import json
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

    def next_pending(self) -> tuple[int, str] | None:
        return self.db.execute("select id, topic from topics where status='pending' order by id limit 1").fetchone()

    def set(self, topic_id: int, status: str, job: str | None = None) -> None:
        self.db.execute("update topics set status=?, job=coalesce(?, job) where id=?", (status, job, topic_id))
        self.db.commit()


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
