from datetime import datetime, timedelta, timezone

from fyt import cleanup, youtube
from fyt.config import Config
from fyt.store import Uploads

NOW = datetime(2026, 10, 20, 12, 0, tzinfo=timezone.utc)


def _iso(**ago):
    return (NOW - timedelta(**ago)).isoformat(timespec="seconds")


def _run(rid, conclusion="success", **ago):
    return {"id": int(rid), "status": "completed", "conclusion": conclusion, "created_at": _iso(**ago).replace("+00:00", "Z")}


def _setup(tmp_path, monkeypatch, statuses, instagram=True):
    cfg = Config(jobs_dir=str(tmp_path / "jobs"))
    cfg.instagram.enabled = cfg.instagram.publish = instagram
    monkeypatch.setenv("INSTAGRAM_TOKEN", "t")
    monkeypatch.setenv("INSTAGRAM_USER_ID", "u")
    monkeypatch.delenv("THREADS_TOKEN", raising=False)
    monkeypatch.setattr(youtube, "authorised", lambda: statuses is not None)
    from fyt import watchdog

    monkeypatch.setattr(watchdog, "_video_status", lambda ids: {i: {"status": {"uploadStatus": s}} for i, s in (statuses or {}).items()})
    return cfg, Uploads(cfg)


def _upload(uploads, run, vid, due=None, **ago):
    uploads.record("short", f"job-{vid}", vid, due, None, at=_iso(**ago))
    uploads.db.execute("update uploads set run=? where youtube_id=?", (f"{run}-1", vid))
    uploads.db.execute("insert into reels(youtube_id, job, run, due) values (?, ?, ?, ?)", (vid, f"job-{vid}", f"{run}-1", due))
    uploads.db.commit()


def test_a_run_is_kept_until_youtube_and_every_platform_confirm(tmp_path, monkeypatch):
    cfg, uploads = _setup(tmp_path, monkeypatch, {"a": "processed", "b": "uploaded", "c": "processed"})
    _upload(uploads, 1, "a", _iso(hours=30), days=2)  # public, Reel posted: done
    uploads.reel_done("a", "m1")
    _upload(uploads, 2, "b", _iso(hours=30), days=2)  # YouTube still processing
    _upload(uploads, 3, "c", _iso(hours=-10), days=2)  # not public yet: no Reel
    needed, known = cleanup.needed_runs(cfg, NOW)
    assert needed == {"2", "3"} and known == {"1", "2", "3"}


def test_a_reel_that_gave_up_or_aged_out_does_not_hold_the_run(tmp_path, monkeypatch):
    cfg, uploads = _setup(tmp_path, monkeypatch, {"a": "processed", "b": "processed", "c": "processed"})
    _upload(uploads, 1, "a", _iso(hours=10), days=2)
    uploads.db.execute("update reels set tries=6 where youtube_id='a'")
    _upload(uploads, 2, "b", _iso(hours=60), days=3)  # public 60 hours ago: past the 48-hour window
    _upload(uploads, 3, "c", _iso(hours=10), days=2)  # still being tried
    uploads.db.commit()
    assert cleanup.needed_runs(cfg, NOW)[0] == {"3"}


def test_platforms_that_are_off_are_not_waited_for(tmp_path, monkeypatch):
    cfg, uploads = _setup(tmp_path, monkeypatch, {"a": "processed"}, instagram=False)
    _upload(uploads, 1, "a", _iso(hours=10), days=2)
    assert cleanup.needed_runs(cfg, NOW)[0] == set()


def test_everything_is_kept_when_youtube_cannot_be_asked(tmp_path, monkeypatch):
    cfg, uploads = _setup(tmp_path, monkeypatch, None, instagram=False)
    _upload(uploads, 1, "a", _iso(hours=10), days=2)
    assert cleanup.needed_runs(cfg, NOW)[0] == {"1"}


def test_to_delete():
    runs = [
        _run(1, hours=30),  # nothing needs it
        _run(2, hours=5),  # too recent
        _run(3, "failure", days=3),  # failed: kept for its log
        _run(4, "failure", days=8),
        _run(5, hours=30),  # uploads not confirmed yet
        _run(6, days=9),  # unconfirmed but its artifact is long gone
        _run(7, hours=30),  # a test render with its video still downloadable
        _run(8, hours=30),  # uploads confirmed, artifact still live
        _run(9, hours=30),  # this run
    ]
    out = cleanup.to_delete(runs, live={"7", "8"}, needed={"5", "6"}, known={"5", "6", "8"}, now=NOW, own="9")
    assert out == ["1", "4", "6", "8"]
