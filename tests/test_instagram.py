from datetime import datetime, timedelta, timezone

from fyt import instagram
from fyt.config import Config
from fyt.models import Script
from fyt.store import Job, Uploads


def _script(**kw) -> Script:
    base = dict(
        title="The town that banned dying",
        description=(
            "In Longyearbyen, Norway, the dead don't decompose, so the town stopped burying anyone.\n\n"
            "Part 1: https://youtu.be/abc\n\n"
            'Based on the Wikipedia article "Longyearbyen" (https://en.wikipedia.org/wiki/Longyearbyen), licensed CC BY-SA 4.0.'
        ),
        tags=["Weird History", "Norway", "#Shorts", "permafrost", "Svalbard", "Arctic", "2015"],
        thumbnail_text="NO DYING",
        thumbnail_kicker="Norway",
        thumbnail_query="svalbard",
        scenes=[],
        sources=[],
        comment_question="Would you move there?",
    )
    return Script(**{**base, **kw})


def _cfg(tmp_path, **ig) -> Config:
    return Config(jobs_dir=str(tmp_path), instagram={"enabled": True, "youtube_handle": "@FacelessYT", "hashtags": ["truestory"], **ig})


def test_caption_has_hook_story_cta_credit_and_five_hashtags(tmp_path):
    text = instagram.caption(_cfg(tmp_path), _script())
    assert text.startswith("The town that banned dying\n\nIn Longyearbyen")
    assert "Link in bio (@FacelessYT)" in text
    assert "💬 Would you move there?" in text
    assert 'Source: Wikipedia, "Longyearbyen" (CC BY-SA 4.0)' in text
    assert "http" not in text  # links can't be tapped in captions
    assert text.splitlines()[-1] == "#truestory #weirdhistory #norway #permafrost #svalbard"


def test_caption_fits_instagrams_limit(tmp_path):
    text = instagram.caption(_cfg(tmp_path), _script(description="word " * 2000))
    assert len(text) <= instagram.MAX_CAPTION
    assert text.endswith("#svalbard")


class _Resp:
    def __init__(self, data, status=200):
        self.data, self.status_code, self.text = data, status, str(data)

    def json(self):
        return self.data


class _Session:
    def __init__(self, statuses):
        self.calls, self.statuses = [], list(statuses)

    def post(self, url, data=None, headers=None, timeout=None):
        self.calls.append(("post", url, data if isinstance(data, dict) else None, headers))
        if url.endswith("/media"):
            return _Resp({"id": "C1"})
        if "rupload" in url:
            return _Resp({"success": True})
        return _Resp({"id": "M1"})

    def get(self, url, params=None, headers=None, timeout=None):
        self.calls.append(("get", url, params, headers))
        if params and params.get("fields") == "permalink":
            return _Resp({"permalink": "https://www.instagram.com/reel/x/"})
        return _Resp({"status_code": self.statuses.pop(0)})


def test_publish_uploads_the_file_waits_and_publishes(tmp_path, monkeypatch):
    monkeypatch.setenv("INSTAGRAM_TOKEN", "tok")
    monkeypatch.setenv("INSTAGRAM_USER_ID", "17841")
    video = tmp_path / "video.mp4"
    video.write_bytes(b"x" * 10)
    s = _Session(["IN_PROGRESS", "FINISHED"])
    assert instagram.publish(_cfg(tmp_path), video, "hi", session=s, sleep=lambda _: None) == "M1"
    create, upload = s.calls[0], s.calls[1]
    assert create[2]["media_type"] == "REELS" and create[2]["upload_type"] == "resumable" and create[2]["caption"] == "hi"
    assert upload[1].endswith("/C1") and upload[3]["file_size"] == "10" and upload[3]["Authorization"] == "OAuth tok"
    assert s.calls[-2][1].endswith("/17841/media_publish")


def test_publish_stops_when_instagram_rejects_the_video(tmp_path, monkeypatch):
    monkeypatch.setenv("INSTAGRAM_TOKEN", "tok")
    monkeypatch.setenv("INSTAGRAM_USER_ID", "17841")
    video = tmp_path / "video.mp4"
    video.write_bytes(b"x")
    s = _Session(["ERROR"])
    try:
        instagram.publish(_cfg(tmp_path), video, "hi", session=s, sleep=lambda _: None)
    except RuntimeError as e:
        assert "could not process" in str(e)
    else:
        raise AssertionError("published a rejected video")
    assert not any(c[1].endswith("media_publish") for c in s.calls)


def _queued(tmp_path, due: datetime) -> Config:
    cfg = _cfg(tmp_path, publish=True)
    job = Job.create(cfg, "wiki:Longyearbyen")
    job.file("video.mp4").write_bytes(b"x")
    job.file("script.json").write_text(_script().model_dump_json())
    Uploads(cfg).queue_reel("yt1", job.id, due.isoformat(timespec="seconds"))
    return cfg


def test_reels_wait_until_the_short_is_public(tmp_path, monkeypatch):
    now = datetime(2026, 10, 17, 14, 0, tzinfo=timezone.utc)
    cfg = _queued(tmp_path, now + timedelta(hours=1))
    monkeypatch.setenv("INSTAGRAM_TOKEN", "tok")
    monkeypatch.setenv("INSTAGRAM_USER_ID", "1")
    posted = []
    monkeypatch.setattr(instagram, "publish", lambda cfg, video, text: posted.append(text) or "M1")
    assert instagram.post_due(cfg, now) == 0
    assert instagram.post_due(cfg, now + timedelta(hours=2)) == 1
    assert posted[0].startswith("The town that banned dying")
    assert instagram.post_due(cfg, now + timedelta(hours=8)) == 0  # posted once


def test_nothing_is_posted_until_publish_is_on(tmp_path, monkeypatch):
    now = datetime(2026, 10, 17, 14, 0, tzinfo=timezone.utc)
    cfg = _queued(tmp_path, now - timedelta(hours=1))
    cfg.instagram.publish = False
    monkeypatch.setenv("INSTAGRAM_TOKEN", "tok")
    monkeypatch.setenv("INSTAGRAM_USER_ID", "1")
    monkeypatch.setattr(instagram, "check", lambda cfg: "ok")
    monkeypatch.setattr(instagram, "publish", lambda *a: (_ for _ in ()).throw(AssertionError("posted")))
    assert instagram.post_due(cfg, now) == 0


def test_old_shorts_are_not_posted_as_a_backlog(tmp_path, monkeypatch):
    now = datetime(2026, 10, 17, 14, 0, tzinfo=timezone.utc)
    cfg = _queued(tmp_path, now - timedelta(days=5))
    monkeypatch.setenv("INSTAGRAM_TOKEN", "tok")
    monkeypatch.setenv("INSTAGRAM_USER_ID", "1")
    monkeypatch.setattr(instagram, "publish", lambda *a: (_ for _ in ()).throw(AssertionError("posted")))
    assert instagram.post_due(cfg, now) == 0


def test_with_posting_off_the_secrets_are_only_checked(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("INSTAGRAM_TOKEN", "tok")
    monkeypatch.setenv("INSTAGRAM_USER_ID", "1")
    monkeypatch.setattr(instagram, "check", lambda cfg: "Instagram secrets work: can post to @weirdbuttrue")
    monkeypatch.setattr(instagram, "publish", lambda *a: (_ for _ in ()).throw(AssertionError("posted")))
    assert instagram.post_due(_cfg(tmp_path), datetime(2026, 10, 17, tzinfo=timezone.utc)) == 0
    assert "@weirdbuttrue" in capsys.readouterr().out


def test_check_reports_the_account_and_quota(tmp_path, monkeypatch):
    monkeypatch.setenv("INSTAGRAM_TOKEN", "tok")
    monkeypatch.setenv("INSTAGRAM_USER_ID", "1")

    class S:
        def get(self, url, params=None, headers=None, timeout=None):
            if url.endswith("content_publishing_limit"):
                return _Resp({"data": [{"quota_usage": 2, "config": {"quota_total": 100}}]})
            return _Resp({"username": "weirdbuttrue"})

    assert instagram.check(_cfg(tmp_path), session=S()).endswith("@weirdbuttrue (2 of 100 posts used in the last 24 hours)")


def test_shorts_uploaded_before_posting_was_on_are_picked_up(tmp_path, monkeypatch):
    now = datetime(2026, 10, 17, 14, 0, tzinfo=timezone.utc)
    cfg = _cfg(tmp_path, publish=True)
    job = Job.create(cfg, "wiki:Longyearbyen")
    job.file("video.mp4").write_bytes(b"x")
    job.file("script.json").write_text(_script().model_dump_json())
    uploads = Uploads(cfg)
    uploads.record("short", job.id, "yt1", (now - timedelta(hours=1)).isoformat())
    uploads.record("long", job.id, "yt2", (now - timedelta(hours=1)).isoformat())
    uploads.record("short", job.id, "yt3", (now - timedelta(days=5)).isoformat())
    monkeypatch.setenv("INSTAGRAM_TOKEN", "tok")
    monkeypatch.setenv("INSTAGRAM_USER_ID", "1")
    posted = []
    monkeypatch.setattr(instagram, "publish", lambda cfg, video, text: posted.append(text) or "M1")
    assert instagram.post_due(cfg, now) == 1


def test_a_rejected_upload_reports_the_containers_status(tmp_path, monkeypatch):
    monkeypatch.setenv("INSTAGRAM_TOKEN", "tok")
    monkeypatch.setenv("INSTAGRAM_USER_ID", "1")
    video = tmp_path / "video.mp4"
    video.write_bytes(b"x")

    class S(_Session):
        def post(self, url, data=None, headers=None, timeout=None):
            if "rupload" in url:
                return _Resp({"debug_info": {"type": "ProcessingFailedError"}}, status=400)
            return super().post(url, data, headers, timeout)

        def get(self, url, params=None, headers=None, timeout=None):
            return _Resp({"status": "Error: video codec not supported"})

    try:
        instagram.publish(_cfg(tmp_path), video, "hi", session=S([]), sleep=lambda _: None)
    except RuntimeError as e:
        assert "codec not supported" in str(e)
    else:
        raise AssertionError("no error")


def test_with_a_temporary_host_instagram_fetches_the_video_from_its_link(tmp_path, monkeypatch):
    monkeypatch.setenv("INSTAGRAM_TOKEN", "tok")
    monkeypatch.setenv("INSTAGRAM_USER_ID", "17841")
    video = tmp_path / "video.mp4"
    video.write_bytes(b"x")

    class S(_Session):
        def post(self, url, data=None, headers=None, timeout=None, files=None):
            if url == instagram.LITTERBOX:
                assert "python-requests" not in headers["User-Agent"]
                assert files["fileToUpload"][2] == "video/mp4" and data["time"] == "1h"
                r = _Resp({})
                r.text = "https://litter.catbox.moe/abc.mp4"
                return r
            return super().post(url, data, headers, timeout)

    s = S(["FINISHED"])
    assert instagram.publish(_cfg(tmp_path, host="litterbox"), video, "hi", session=s, sleep=lambda _: None) == "M1"
    create = s.calls[0]
    assert create[2]["video_url"] == "https://litter.catbox.moe/abc.mp4" and "upload_type" not in create[2]
    assert not any("rupload" in c[1] for c in s.calls)
