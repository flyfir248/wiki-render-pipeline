"""Catch videos YouTube never finished processing, and upload them again.

Now and then an upload reaches 100% but YouTube never processes it: Studio shows
"Processing will begin shortly" for days, the scheduled time passes and the video
never goes live. `fyt watchdog` asks YouTube how each recent upload is doing. A video
that failed, was rejected, or still isn't processed hours after its upload is marked
broken, its publish slot is freed, and its file (kept as the run's artifact for a
week) goes back in jobs/pending so `fill` uploads it again. Each one is listed in a
report the workflow sends as an issue, so the broken copy can be deleted in Studio.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fyt import youtube
from fyt.config import Config
from fyt.store import Uploads

STUCK_HOURS = 6  # a 10-minute 1080p video normally processes within the hour
LOOKBACK_DAYS = 7  # the run artifacts holding the files are kept for 7 days
FAILED = {"failed", "rejected"}
WORKFLOW = "daily-short.yml"


def classify(item: dict | None, uploaded: datetime, now: datetime) -> str | None:
    """Why this video is broken, or None when it's fine (or may still finish)."""
    if item is None:
        return None  # deleted, most likely on purpose in Studio: leave it be
    status = item.get("status", {})
    upload_status = status.get("uploadStatus")
    processing = item.get("processingDetails", {}).get("processingStatus")
    if upload_status in FAILED:
        reason = status.get("failureReason") or status.get("rejectionReason") or ""
        return f"upload {upload_status}" + (f" ({reason})" if reason else "")
    if processing in {"failed", "terminated"}:
        reason = item.get("processingDetails", {}).get("processingFailureReason", "")
        return f"processing {processing}" + (f" ({reason})" if reason else "")
    if upload_status == "uploaded" and now - uploaded > timedelta(hours=STUCK_HOURS):
        hours = int((now - uploaded).total_seconds() // 3600)
        return f"not processed {hours} hours after upload"
    return None


def _video_status(ids: list[str]) -> dict[str, dict]:
    yt = youtube._service()
    out: dict[str, dict] = {}
    for i in range(0, len(ids), 50):
        resp = yt.videos().list(part="status,processingDetails", id=",".join(ids[i : i + 50])).execute()
        out.update({item["id"]: item for item in resp.get("items", [])})
    return out


def _gh(*args: str) -> str:
    return subprocess.run(["gh", *args], capture_output=True, text=True, check=True).stdout


def _run_for(uploaded: datetime) -> str | None:
    """The workflow run (id-attempt) that was going when a video was uploaded, for uploads
    recorded before the run was stored with them."""
    try:
        runs = json.loads(_gh("run", "list", "--workflow", WORKFLOW, "--limit", "100", "--json", "databaseId,attempt,createdAt,updatedAt"))
    except (OSError, subprocess.CalledProcessError, ValueError):
        return None
    for r in runs:
        start = datetime.fromisoformat(r["createdAt"].replace("Z", "+00:00"))
        end = datetime.fromisoformat(r["updatedAt"].replace("Z", "+00:00"))
        if start <= uploaded <= end + timedelta(minutes=5):
            return f"{r['databaseId']}-{r.get('attempt', 1)}"
    return None


def requeue(cfg: Config, job_id: str, run: str, youtube_id: str) -> bool:
    """Fetch the video's files from its run's artifact into jobs/pending, ready to upload again."""
    run_id = run.split("-")[0]
    with tempfile.TemporaryDirectory() as tmp:
        try:
            _gh("run", "download", run_id, "--name", f"videos-{run}", "--dir", tmp)
        except (OSError, subprocess.CalledProcessError) as e:
            print(f"::warning::could not fetch the files of {job_id} from run {run}: {getattr(e, 'stderr', e)}")
            return False
        src = Path(tmp) / job_id
        if not (src / "video.mp4").exists() or not (src / "job.json").exists():
            print(f"::warning::run {run} has no video for {job_id}")
            return False
        dst = cfg.jobs_path / "pending" / f"{job_id}-again"
        if dst.exists():
            shutil.rmtree(dst)
        shutil.copytree(src, dst)
    meta_path = dst / "job.json"
    meta = json.loads(meta_path.read_text())
    for key in ("youtube_id", "publish_at", "upload_error"):
        meta.pop(key, None)
    meta.update(status="approved", reupload_of=youtube_id)
    meta_path.write_text(json.dumps(meta, indent=2))
    return True


def check(cfg: Config, now: datetime | None = None) -> list[dict]:
    """Find broken uploads, free their slots and queue them to upload again. Returns one entry per video."""
    now = now or datetime.now(timezone.utc)
    uploads = Uploads(cfg)
    recent = uploads.recent((now - timedelta(days=LOOKBACK_DAYS)).isoformat(timespec="seconds"))
    if not recent:
        return []
    statuses = _video_status([r["youtube_id"] for r in recent])
    found = []
    for r in recent:
        uploaded = datetime.fromisoformat(r["uploaded"].replace("Z", "+00:00"))
        if uploaded.tzinfo is None:
            uploaded = uploaded.replace(tzinfo=timezone.utc)
        problem = classify(statuses.get(r["youtube_id"]), uploaded, now)
        if not problem:
            continue
        uploads.mark_problem(r["youtube_id"], problem)
        run = r["run"] or _run_for(uploaded)
        again = bool(r["job"] and run and requeue(cfg, r["job"], run, r["youtube_id"]))
        print(f"::warning::https://youtu.be/{r['youtube_id']}: {problem}; " + ("uploading it again" if again else "could not upload it again"))
        found.append({**r, "problem": problem, "requeued": again})
    return found


def report(found: list[dict]) -> str:
    lines = [
        (
            "YouTube didn't finish these uploads, so they will never go live. "
            "Delete the broken copies in YouTube Studio (Content, then the three-dot menu on the video).\n"
        ),
        "| Video | Kind | Uploaded (UTC) | What went wrong | Next |",
        "|---|---|---|---|---|",
    ]
    for f in found:
        nxt = "uploaded again by the next run" if f["requeued"] else "file no longer available; its slot gets a new video"
        studio = f"https://studio.youtube.com/video/{f['youtube_id']}/edit"
        lines.append(f"| [{f['youtube_id']}]({studio}) | {f['kind']} | {f['uploaded'][:16].replace('T', ' ')} | {f['problem']} | {nxt} |")
    return "\n".join(lines) + "\n"


def run(cfg: Config, out: str) -> int:
    if not youtube.authorised() or not youtube.can_manage():
        print("watchdog needs a token with the full YouTube permission; skipped")
        return 0
    found = check(cfg)
    if found:
        Path(out).write_text(report(found))
    elif os.path.exists(out):
        os.remove(out)
    return len(found)
