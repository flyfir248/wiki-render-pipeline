import random
from datetime import datetime, timezone

import pytest

from fyt import pipeline, schedule, youtube
from fyt.config import Config
from fyt.store import Job, Uploads

MONDAY = datetime(2026, 9, 28, 19, 0, tzinfo=timezone.utc)


@pytest.fixture
def cfg(tmp_path, monkeypatch):
    monkeypatch.setattr(youtube, "authorised", lambda: True)
    monkeypatch.setattr(schedule, "utcnow", lambda: MONDAY)
    monkeypatch.setattr(youtube, "recent_uploads", lambda: [])
    c = Config(jobs_dir=str(tmp_path), require_review=False)
    c.youtube.publish_jitter_minutes = 90
    c.growth.bonus_shorts_per_day = 0  # tested separately
    c.growth.bonus_longs_per_week = 0
    return c


class FakeChannel:
    """Stands in for making and uploading videos."""

    def __init__(self, monkeypatch, fail_make=0, fail_upload=0, quota_after=None):
        self.made, self.uploaded = [], []
        self.fail_make, self.fail_upload, self.quota_after = fail_make, fail_upload, quota_after
        monkeypatch.setattr(pipeline, "make_next", self.make_next)
        monkeypatch.setattr(pipeline, "upload_job", self.upload_job)

    def make_next(self, cfg, topics):
        if self.fail_make:
            self.fail_make -= 1
            return None
        job = Job.create(cfg, f"topic {len(self.made)}")
        job.file("video.mp4").write_bytes(b"x")
        job.file("script.json").write_text("{}")
        job.update(status="approved")
        self.made.append(cfg.format)
        return job

    def upload_job(self, cfg, job, force=False, publish_at=None):
        if self.quota_after is not None and len(self.uploaded) >= self.quota_after:
            raise RuntimeError("quotaExceeded: The request cannot be completed because you have exceeded your quota.")
        if self.fail_upload:
            self.fail_upload -= 1
            raise RuntimeError("connection reset")
        self.uploaded.append((job.meta["format"], publish_at))
        job.update(status="uploaded", youtube_id=f"vid{len(self.uploaded)}")
        return f"vid{len(self.uploaded)}"


def test_slots_cover_the_buffer_and_the_weekly_long_video(cfg):
    slots = schedule.upcoming_slots(cfg, MONDAY)
    assert [(s.at.strftime("%a %H:%M"), s.kind) for s in slots] == [
        ("Mon 22:00", "short"),
        ("Tue 14:00", "short"),
        ("Tue 22:00", "short"),
        ("Wed 14:00", "short"),
    ]
    thursday = datetime(2026, 10, 1, 19, 0, tzinfo=timezone.utc)
    kinds = [(s.at.strftime("%a %H:%M"), s.kind) for s in schedule.upcoming_slots(cfg, thursday)]
    assert ("Sat 16:00", "long") in kinds  # made up to 3 days ahead


def test_fill_schedules_each_empty_slot_once(cfg, monkeypatch):
    ch = FakeChannel(monkeypatch)
    assert schedule.fill(cfg, now=MONDAY, rng=random.Random(1)) == 4
    assert ch.made == ["short"] * 4
    for (_, at), slot in zip(ch.uploaded, schedule.upcoming_slots(cfg, MONDAY)):
        assert slot.at <= at <= slot.at.replace(minute=30, hour=slot.at.hour + 1)  # random minute in the window
    assert schedule.fill(cfg, now=MONDAY) == 0  # nothing left to do
    assert not schedule.needed(cfg, MONDAY)
    _, soon = schedule.report(cfg, MONDAY)
    assert soon == []


def test_a_failed_video_is_retried_with_another_topic(cfg, monkeypatch):
    ch = FakeChannel(monkeypatch, fail_make=2)
    # Two videos fail; the later slots still get theirs, and the next run fills the rest.
    assert schedule.fill(cfg, now=MONDAY) == 2
    assert schedule.fill(cfg, now=MONDAY) == 2


def test_failed_upload_is_kept_and_uploaded_by_the_next_run(cfg, monkeypatch):
    ch = FakeChannel(monkeypatch, fail_upload=1)
    schedule.fill(cfg, now=MONDAY)
    assert len(ch.made) == 4 and len(ch.uploaded) == 3
    assert len(schedule.pending_jobs(cfg)) == 1
    ch.made.clear()
    assert schedule.fill(cfg, now=MONDAY) == 1
    assert ch.made == []  # uploaded the kept video instead of making a new one
    assert schedule.pending_jobs(cfg) == []


def test_daily_quota_is_respected(cfg, monkeypatch):
    cfg.schedule.buffer_days = 4  # more slots than one day's quota
    ch = FakeChannel(monkeypatch)
    assert schedule.fill(cfg, now=MONDAY) == 4
    assert len(ch.made) == 4
    assert schedule.uploads_left_today(cfg, MONDAY) == 0
    assert schedule.needed(cfg, MONDAY) is False


def test_quota_error_stops_the_run_and_keeps_the_video(cfg, monkeypatch):
    ch = FakeChannel(monkeypatch, quota_after=1)
    schedule.fill(cfg, now=MONDAY)
    assert len(ch.made) == 2  # stopped making after the quota error
    assert len(schedule.pending_jobs(cfg)) == 1


def test_no_time_for_a_long_video_still_makes_shorts(cfg, monkeypatch):
    friday = datetime(2026, 10, 2, 6, 0, tzinfo=timezone.utc)
    ch = FakeChannel(monkeypatch)
    ticks = iter([0] + [60 * 60] * 50)  # an hour has passed at the first check
    schedule.fill(cfg, now=friday, clock=lambda: next(ticks))
    assert "long" not in ch.made and "short" in ch.made


def test_check_flags_an_empty_slot_in_the_next_day(cfg):
    _, soon = schedule.report(cfg, MONDAY)
    assert [s.at.strftime("%a %H:%M") for s in soon] == ["Mon 22:00", "Tue 14:00"]


def test_one_off_uploads_count_toward_the_quota(cfg):
    Uploads(cfg).record("short", "job", "vid", None)
    assert schedule.uploads_left_today(cfg, datetime.now(timezone.utc)) == 3


def test_a_lost_state_is_recovered_from_the_channel(cfg, monkeypatch):
    """A fresh state.db (e.g. the cache was reset) must not double-book slots already scheduled on YouTube."""
    desc = 'Intro.\n\nBased on the Wikipedia article "Vril" (https://en.wikipedia.org/wiki/Vril), licensed CC BY-SA 4.0.'
    monkeypatch.setattr(
        youtube,
        "recent_uploads",
        lambda: [
            {"id": "old1", "publish_at": "2026-09-28T22:40:00Z", "uploaded": "2026-09-28T19:30:00Z", "description": desc},
            {"id": "old2", "publish_at": "2026-09-29T14:16:00Z", "uploaded": "2026-09-28T19:40:00Z", "description": ""},
            {"id": "live", "publish_at": None, "uploaded": "2026-09-27T14:00:00Z", "description": ""},
        ],
    )
    ch = FakeChannel(monkeypatch)
    assert schedule.fill(cfg, now=MONDAY, rng=random.Random(1)) == 2  # Mon 22:00 and Tue 14:00 were already on the channel
    days = [at.strftime("%a") for _, at in ch.uploaded]
    assert days == ["Tue", "Wed"] and ch.uploaded[0][1].hour >= 22 and ch.uploaded[1][1].hour < 16
    from fyt.store import Topics

    assert ("wiki:Vril", "done") in [(t, s) for _, t, s, _ in Topics(cfg).all()]
    assert schedule.uploads_left_today(cfg, MONDAY) == 0  # the two made Monday count toward the quota, plus two now


def test_a_video_whose_thumbnail_step_failed_is_never_uploaded_again(cfg, monkeypatch):
    """The video reached YouTube, then the thumbnail upload timed out: it fills its slot and is not re-posted."""
    ch = FakeChannel(monkeypatch)
    real_upload = ch.upload_job

    def flaky_upload(cfg, job, force=False, publish_at=None):
        if not ch.uploaded:
            real_upload(cfg, job, force, publish_at)
            job.update(status="approved")  # what the real pipeline leaves behind when a later step raises
            raise TimeoutError("The read operation timed out")
        return real_upload(cfg, job, force, publish_at)

    monkeypatch.setattr(pipeline, "upload_job", flaky_upload)
    assert schedule.fill(cfg, now=MONDAY) == 4
    assert len(ch.uploaded) == 4 and schedule.pending_jobs(cfg) == []
    assert schedule.fill(cfg, now=MONDAY) == 0
    assert len(ch.uploaded) == 4


def test_a_kept_video_already_on_the_channel_is_dropped(cfg, monkeypatch):
    """Videos kept by older versions (no video id saved) are matched to the channel by title."""
    job = Job.create(cfg, "wiki:Dreamachine")
    job.update(status="upload_failed", title="The Lamp That Makes You Dream", format="short")
    schedule._keep_pending(cfg, job)
    monkeypatch.setattr(
        youtube,
        "recent_uploads",
        lambda: [{"id": "dup", "publish_at": "2026-09-29T14:20:00Z", "uploaded": "2026-09-28T16:05:00Z",
                  "title": "The lamp that makes you dream!", "description": ""}],
    )
    ch = FakeChannel(monkeypatch)
    schedule.fill(cfg, now=MONDAY)
    assert schedule.pending_jobs(cfg) == []
    assert ch.made == ["short"] * 3  # Tue 14:00 already holds the earlier upload


def test_a_kept_video_with_a_video_id_fills_its_slot_without_the_channel(cfg, monkeypatch):
    def unreadable():
        raise RuntimeError("403")

    monkeypatch.setattr(youtube, "recent_uploads", unreadable)
    job = Job.create(cfg, "x")
    job.update(status="upload_failed", youtube_id="up1", publish_at="2026-09-29T14:20:00+00:00", format="short")
    schedule._keep_pending(cfg, job)
    ch = FakeChannel(monkeypatch)
    schedule.fill(cfg, now=MONDAY)
    assert ch.made == ["short"] * 3 and schedule.pending_jobs(cfg) == []
    assert Uploads(cfg).filled()["2026-09-29T14:00:00+00:00"][0] == "up1"


def test_first_comment_is_posted_once_the_video_is_public(cfg, monkeypatch):
    posted = []
    monkeypatch.setattr(youtube, "can_manage", lambda: True)
    monkeypatch.setattr(youtube, "post_comment", lambda vid, text: posted.append((vid, text)) or "c1")
    u = Uploads(cfg)
    u.queue_comment("v1", "Would you have tried it?", "2026-09-29T14:20:00+00:00")
    u.queue_comment("v2", "Older one?", None)
    assert schedule.post_comments(cfg, MONDAY) == 1  # v1 is still scheduled
    assert posted == [("v2", "Older one?")]
    later = datetime(2026, 9, 29, 15, 0, tzinfo=timezone.utc)
    assert schedule.post_comments(cfg, later) == 1
    assert schedule.post_comments(cfg, later) == 0  # never twice
    assert posted[-1] == ("v1", "Would you have tried it?")


def test_a_failing_comment_is_retried_at_most_three_times(cfg, monkeypatch):
    calls = []
    monkeypatch.setattr(youtube, "can_manage", lambda: True)
    monkeypatch.setattr(youtube, "post_comment", lambda vid, text: calls.append(vid) or (_ for _ in ()).throw(RuntimeError("403")))
    Uploads(cfg).queue_comment("v1", "Q?", None)
    for _ in range(5):
        schedule.post_comments(cfg, MONDAY)
    assert len(calls) == 3
