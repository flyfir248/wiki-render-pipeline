import json
from datetime import datetime, timedelta, timezone

from fyt import schedule, watchdog, youtube
from fyt.config import Config
from fyt.store import Uploads

NOW = datetime(2026, 10, 11, 18, 0, tzinfo=timezone.utc)


def _item(upload_status, processing=None, **status):
    item = {"status": {"uploadStatus": upload_status, **status}}
    if processing:
        item["processingDetails"] = {"processingStatus": processing}
    return item


def test_classify():
    old, fresh = NOW - timedelta(days=4), NOW - timedelta(hours=1)
    assert watchdog.classify(_item("processed", "succeeded"), old, NOW) is None
    assert watchdog.classify(_item("uploaded", "processing"), fresh, NOW) is None  # may still finish
    assert watchdog.classify(_item("uploaded"), old, NOW) == "not processed 96 hours after upload"
    assert watchdog.classify(_item("failed", failureReason="codec"), fresh, NOW) == "upload failed (codec)"
    assert watchdog.classify(_item("rejected", rejectionReason="duplicate"), fresh, NOW) == "upload rejected (duplicate)"
    assert watchdog.classify(_item("processed", "terminated"), fresh, NOW) == "processing terminated"
    assert watchdog.classify(None, old, NOW) is None  # deleted in Studio: on purpose


def _artifact(tmp_path, job_id):
    src = tmp_path / "artifact" / job_id
    src.mkdir(parents=True)
    (src / "video.mp4").write_bytes(b"v")
    (src / "job.json").write_text(json.dumps({"status": "uploaded", "youtube_id": "ghost", "format": "short"}))
    return src.parent


def test_check_frees_the_slot_and_queues_the_video_again(tmp_path, monkeypatch):
    cfg = Config(jobs_dir=str(tmp_path / "jobs"))
    uploads = Uploads(cfg)
    slot = (NOW + timedelta(hours=20)).isoformat()
    uploads.record("short", "20261007-job", "ghost", slot, slot, at=(NOW - timedelta(days=4)).isoformat())
    uploads.record("short", "20261010-job", "fine", None, None, at=(NOW - timedelta(days=1)).isoformat())
    uploads.db.execute("update uploads set run='111-1' where youtube_id='ghost'")
    uploads.db.commit()
    monkeypatch.setattr(watchdog, "_video_status", lambda ids: {"ghost": _item("uploaded"), "fine": _item("processed", "succeeded")})
    art = _artifact(tmp_path, "20261007-job")
    calls = []

    def gh(*args):
        calls.append(args)
        import shutil

        shutil.copytree(art, args[-1], dirs_exist_ok=True)
        return ""

    monkeypatch.setattr(watchdog, "_gh", gh)
    [found] = watchdog.check(cfg, NOW)
    assert found["youtube_id"] == "ghost" and found["requeued"]
    assert calls[0][:5] == ("run", "download", "111", "--name", "videos-111-1")
    assert slot not in Uploads(cfg).filled()
    assert Uploads(cfg).broken_ids() == {"ghost"}
    [job] = schedule.pending_jobs(cfg)
    assert job.meta["status"] == "approved" and job.meta["reupload_of"] == "ghost" and "youtube_id" not in job.meta
    assert watchdog.check(cfg, NOW) == []  # reported once
    assert "ghost" in watchdog.report([found])


def test_sync_does_not_drop_the_new_copy_because_the_broken_one_has_its_title(tmp_path, monkeypatch):
    cfg = Config(jobs_dir=str(tmp_path / "jobs"))
    uploads = Uploads(cfg)
    uploads.record("short", "j", "ghost", None, None, at=NOW.isoformat())
    uploads.mark_problem("ghost", "stuck")
    job_dir = cfg.jobs_path / "pending" / "j-again"
    job_dir.mkdir(parents=True)
    (job_dir / "job.json").write_text(json.dumps({"status": "approved", "title": "Same title", "format": "short"}))
    monkeypatch.setattr(
        youtube, "recent_uploads", lambda: [{"id": "ghost", "publish_at": None, "uploaded": None, "title": "Same title", "description": ""}]
    )
    schedule.sync(cfg, NOW)
    assert job_dir.exists()


def test_old_state_db_gains_the_new_columns(tmp_path):
    import sqlite3

    cfg = Config(jobs_dir=str(tmp_path))
    db = sqlite3.connect(tmp_path / "state.db")
    db.execute(
        "create table uploads (id integer primary key, slot text unique, kind text not null, job text,"
        " youtube_id text, publish_at text, uploaded text not null)"
    )
    db.execute("insert into uploads(kind, youtube_id, uploaded) values ('short', 'v', '2026-10-10T00:00:00+00:00')")
    db.commit()
    assert [r["youtube_id"] for r in Uploads(cfg).recent("2026-10-01")] == ["v"]


def test_upload_records_the_run(tmp_path, monkeypatch):
    monkeypatch.setenv("GITHUB_RUN_ID", "42")
    monkeypatch.setenv("GITHUB_RUN_ATTEMPT", "2")
    cfg = Config(jobs_dir=str(tmp_path))
    Uploads(cfg).record("short", "j", "v", None)
    assert Uploads(cfg).recent("2000")[0]["run"] == "42-2"
