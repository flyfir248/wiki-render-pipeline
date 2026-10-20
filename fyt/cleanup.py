"""Delete old Actions runs once nothing needs them any more (`fyt cleanruns`, run by the workflow).

Deleting a run also deletes its videos artifact, and the pipeline fetches videos from there after
the YouTube upload: Reels and the other cross-posts go up when the Short goes public, and the
watchdog uploads a broken video again from it. So a run that uploaded videos is only deleted once
every one of them is confirmed: YouTube has processed it (or the watchdog has dealt with it), and
each platform that posts Shorts has posted it or given up on it. A run that uploaded nothing goes
after a day, except one whose artifact is still there for someone to download (a test render, or a
render with uploading off), which goes when the artifact expires. Failed runs stay a week, to read
their logs.
"""

from __future__ import annotations

import json
import os
import subprocess
from datetime import datetime, timedelta, timezone

from fyt import crosspost, instagram, youtube
from fyt.config import Config
from fyt.store import Uploads

KEEP_HOURS = 24  # how long a run stays in the Actions tab once nothing needs it
FAILED_DAYS = 7  # failed runs stay this long, to read their logs
ARTIFACT_DAYS = 8  # the videos artifact is kept 7 days; after that a run holds nothing to protect
MAX_TRIES = 6  # as in due_reels / due_crossposts: a post that failed this often isn't tried again
FAILED = {"failure", "timed_out", "startup_failure"}


def _gh(*args: str) -> str:
    return subprocess.run(["gh", *args], capture_output=True, text=True, check=True).stdout


def _time(s: str) -> datetime:
    t = datetime.fromisoformat(s.replace("Z", "+00:00"))
    return t if t.tzinfo else t.replace(tzinfo=timezone.utc)


def _platforms(cfg: Config) -> list[str]:
    """The platforms that post Shorts as they go public: these are what a Short's run is kept for."""
    on = ["instagram"] if cfg.instagram.enabled and cfg.instagram.publish and instagram.credentials() else []
    for name, (settings, has_secrets, *_) in crosspost.PLATFORMS.items():
        if settings(cfg).publish and has_secrets():
            on.append(name)
    return on


def _processed(ids: list[str]) -> dict[str, bool] | None:
    """Whether YouTube has finished each video; None when YouTube can't be asked (keep every run)."""
    if not ids:
        return {}
    if not youtube.authorised():
        return None
    from fyt import watchdog

    try:
        items = watchdog._video_status(ids)
    except Exception as e:
        print(f"::warning::could not ask YouTube how the uploads are doing, so no run with uploads is deleted: {e}")
        return None
    # A video missing from the answer was deleted in Studio: nothing will fetch its file again.
    return {i: i not in items or items[i].get("status", {}).get("uploadStatus") == "processed" for i in ids}


def needed_runs(cfg: Config, now: datetime) -> tuple[set[str], set[str]]:
    """(runs still needed, runs the state knows about), as run ids without the attempt."""
    uploads = Uploads(cfg)
    db = uploads.db
    since = (now - timedelta(days=ARTIFACT_DAYS)).isoformat(timespec="seconds")
    known = {r[0].split("-")[0] for r in db.execute("select run from uploads where run is not null union select run from reels where run is not null")}
    needed: set[str] = set()

    rows = db.execute("select run, youtube_id from uploads where run is not null and youtube_id is not null and problem is null and uploaded >= ?", (since,)).fetchall()
    done = _processed(sorted({vid for _, vid in rows}))
    for run, vid in rows:
        if done is None or not done[vid]:
            needed.add(run.split("-")[0])  # the watchdog may still need its file

    platforms = _platforms(cfg)
    window = (now - timedelta(hours=cfg.instagram.max_age_hours)).isoformat(timespec="seconds")
    broken = uploads.broken_ids()
    reels = db.execute("select youtube_id, run, due, tries, posted from reels where run is not null").fetchall()
    for vid, run, due, tries, posted in reels:
        if vid in broken or (due and due < window):
            continue  # never going up, or public too long ago to be posted any more
        if any(not _posted(db, vid, p, tries, posted) for p in platforms):
            needed.add(run.split("-")[0])
    return needed, known


def _posted(db, youtube_id: str, platform: str, tries: int, posted: str | None) -> bool:
    """Posted to `platform`, or given up on there."""
    if platform == "instagram":
        return bool(posted) or tries >= MAX_TRIES
    row = db.execute("select tries, posted from crossposts where youtube_id=? and platform=?", (youtube_id, platform)).fetchone()
    return bool(row and (row[1] or row[0] >= MAX_TRIES))


def to_delete(runs: list[dict], live: set[str], needed: set[str], known: set[str], now: datetime, own: str = "") -> list[str]:
    """The ids of the completed runs that can go."""
    out = []
    for r in runs:
        rid, age = str(r["id"]), now - _time(r["created_at"])
        if rid == own or r.get("status") != "completed" or age < timedelta(hours=KEEP_HOURS):
            continue
        if r.get("conclusion") in FAILED and age < timedelta(days=FAILED_DAYS):
            continue
        if age < timedelta(days=ARTIFACT_DAYS) and (rid in needed or (rid in live and rid not in known)):
            continue
        out.append(rid)
    return out


def run(cfg: Config, now: datetime | None = None) -> int:
    """Delete the runs nothing needs any more. Returns how many were deleted."""
    now = now or datetime.now(timezone.utc)
    repo = os.environ.get("GITHUB_REPOSITORY")
    if not repo:
        print("not in GitHub Actions; no runs deleted")
        return 0
    before = (now - timedelta(hours=KEEP_HOURS)).strftime("%Y-%m-%dT%H:%M:%SZ")
    try:
        live = set(_gh("api", "--paginate", f"repos/{repo}/actions/artifacts?per_page=100",
                       "--jq", ".artifacts[] | select(.expired | not) | .workflow_run.id").split())
        runs = [json.loads(line) for line in _gh(
            "api", "--paginate", f"repos/{repo}/actions/runs?status=completed&per_page=100&created=%3C{before}",
            "--jq", ".workflow_runs[] | {id, status, conclusion, created_at}",
        ).splitlines() if line.strip()]
    except (OSError, subprocess.CalledProcessError) as e:
        print(f"::warning::could not list the runs: {getattr(e, 'stderr', e)}")
        return 0
    needed, known = needed_runs(cfg, now)
    deleted = 0
    for rid in to_delete(runs, live, needed, known, now, os.environ.get("GITHUB_RUN_ID", "")):
        try:
            _gh("api", "-X", "DELETE", f"repos/{repo}/actions/runs/{rid}", "--silent")
            deleted += 1
        except (OSError, subprocess.CalledProcessError) as e:
            print(f"::warning::could not delete run {rid}: {getattr(e, 'stderr', e)}")
    print(f"kept {len(needed)} runs whose uploads aren't confirmed everywhere yet")
    return deleted
