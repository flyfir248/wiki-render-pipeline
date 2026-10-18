from fyt import pipeline, youtube
from fyt.config import Config
from fyt.store import Job, Topics


def _setup(tmp_path, monkeypatch):
    cfg = Config(jobs_dir=str(tmp_path), require_review=False)
    Topics(cfg).add(["A topic"])

    def make_video(cfg, topic):
        job = Job.create(cfg, topic)
        job.update(status="approved")
        return job

    monkeypatch.setattr(pipeline, "make_video", make_video)
    return cfg


def test_run_skips_upload_without_token(tmp_path, monkeypatch):
    cfg = _setup(tmp_path, monkeypatch)
    monkeypatch.setattr(youtube, "authorised", lambda: False)
    monkeypatch.setattr(pipeline, "upload_job", lambda cfg, job: (_ for _ in ()).throw(AssertionError("uploaded")))
    [job] = pipeline.run_queue(cfg, 1)
    assert job.meta["status"] == "ready"


def test_run_keeps_video_when_upload_fails(tmp_path, monkeypatch):
    cfg = _setup(tmp_path, monkeypatch)
    monkeypatch.setattr(youtube, "authorised", lambda: True)

    def boom(cfg, job):
        raise RuntimeError("quota exceeded")

    monkeypatch.setattr(pipeline, "upload_job", boom)
    [job] = pipeline.run_queue(cfg, 1)
    assert job.meta["status"] == "upload_failed"
    assert "quota" in job.meta["upload_error"]


class _Call:
    def __init__(self, result=None, error=None):
        self.result, self.error = result, error

    def execute(self):
        if self.error:
            raise self.error
        return self.result

    def next_chunk(self):
        return None, {"id": "vid1"}


class _FakeYouTube:
    def videos(self):
        return self

    def insert(self, **_):
        return _Call()

    def thumbnails(self):
        return self

    def set(self, **_):
        return _Call(error=TimeoutError("The read operation timed out"))


def test_upload_survives_a_thumbnail_timeout_and_reports_the_id_first(tmp_path, monkeypatch):
    from fyt.models import Script

    monkeypatch.setattr(youtube, "_service", lambda: _FakeYouTube())
    video, thumb = tmp_path / "v.mp4", tmp_path / "t.png"
    video.write_bytes(b"x")
    thumb.write_bytes(b"x")
    script = Script(title="T", description="D", tags=[], thumbnail_text="", thumbnail_kicker="", thumbnail_query="", scenes=[], sources=[])
    seen = []
    cfg = Config(jobs_dir=str(tmp_path))
    assert youtube.upload(cfg, script, video, thumb, None, on_uploaded=seen.append) == "vid1"
    assert seen == ["vid1"]


def test_upload_job_does_not_post_a_video_twice(tmp_path, monkeypatch):
    cfg = Config(jobs_dir=str(tmp_path))
    job = Job.create(cfg, "x")
    job.update(status="upload_failed", youtube_id="vid1")
    monkeypatch.setattr(youtube, "upload", lambda *a, **k: (_ for _ in ()).throw(AssertionError("uploaded again")))
    assert pipeline.upload_job(cfg, job) == "vid1"
    assert job.meta["status"] == "uploaded"


def test_performance_ranks_by_how_much_people_watched(tmp_path, monkeypatch):
    from fyt.store import Uploads

    cfg = Config(jobs_dir=str(tmp_path))
    for v in "abcde":
        Uploads(cfg).record("short", None, v, None)
    monkeypatch.setattr(youtube, "can_manage", lambda: True)
    monkeypatch.setattr(youtube, "can_analyze", lambda: True)
    monkeypatch.setattr(youtube, "stats", lambda ids: [{"id": v, "title": v.upper(), "views": 100, "likes": 1} for v in sorted(ids)])
    pct = {"a": 40, "b": 90, "c": 70, "d": 20, "e": 60}
    monkeypatch.setattr(youtube, "retention", lambda ids: {v: {"views": 100, "seconds": 20, "percent": p} for v, p in pct.items()})
    pipeline._performance.clear()
    summary = pipeline.performance_summary(cfg, limit=4)
    best, worst = summary.split("Lost viewers soonest")
    assert best.index("- B:") < best.index("- C:") and "- D:" in worst
    assert "watched 90%" in best


def test_upload_queues_the_first_comment(tmp_path, monkeypatch):
    from fyt.models import Script
    from fyt.store import Uploads

    cfg = Config(jobs_dir=str(tmp_path))
    job = Job.create(cfg, "x")
    job.update(status="approved")
    s = Script(title="T", description="D", tags=[], thumbnail_text="", thumbnail_kicker="", thumbnail_query="",
               scenes=[], sources=[], comment_question="Would you sit in front of it?")
    job.file("script.json").write_text(s.model_dump_json())
    monkeypatch.setattr(youtube, "upload", lambda *a, **k: "vid9")
    monkeypatch.setattr(youtube, "can_manage", lambda: False)
    pipeline.upload_job(cfg, job)
    assert Uploads(cfg).due_comments("2030-01-01") == [("vid9", "Would you sit in front of it?")]


def test_uploading_a_short_queues_it_for_instagram(tmp_path, monkeypatch):
    from fyt.models import Script
    from fyt.store import Uploads

    monkeypatch.delenv("GITHUB_RUN_ID", raising=False)
    cfg = Config(jobs_dir=str(tmp_path), format="short", instagram={"enabled": True})
    job = Job.create(cfg, "x")
    job.update(status="approved")
    s = Script(title="T", description="D", tags=[], thumbnail_text="", thumbnail_kicker="", thumbnail_query="",
               scenes=[], sources=[])
    job.file("script.json").write_text(s.model_dump_json())
    monkeypatch.setattr(youtube, "upload", lambda *a, **k: "vid9")
    monkeypatch.setattr(youtube, "can_manage", lambda: False)
    pipeline.upload_job(cfg, job)
    assert Uploads(cfg).due_reels("2030-01-01", "2000-01-01") == [("vid9", job.id, None)]
