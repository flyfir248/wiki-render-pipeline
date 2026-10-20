import json
from datetime import datetime, timedelta, timezone

from fyt import crosspost, instagram
from fyt.config import Config
from fyt.store import Job, Uploads
from tests.test_instagram import _Resp, _script


def _cfg(tmp_path, **kw) -> Config:
    return Config(
        jobs_dir=str(tmp_path),
        instagram={"enabled": True, "publish": True, "youtube_handle": "@FacelessYT", "hashtags": ["truestory"], "host": "litterbox"},
        **kw,
    )


def _folder(cfg):
    job = Job.create(cfg, "wiki:Longyearbyen")
    job.file("video.mp4").write_bytes(b"x")
    job.file("script.json").write_text(_script().model_dump_json())
    return job


def test_facebook_text_links_the_short_instead_of_the_bio(tmp_path):
    cfg = _cfg(tmp_path)
    text = crosspost.facebook_text(cfg, _folder(cfg).path, "yt1")
    assert "Watch the full story on YouTube: https://youtu.be/yt1" in text
    assert "Link in bio" not in text
    assert text.splitlines()[-1].startswith("#truestory")


def test_threads_text_fits_500_characters_with_the_link(tmp_path):
    cfg = _cfg(tmp_path)
    job = _folder(cfg)
    job.file("script.json").write_text(_script(description="word " * 400).model_dump_json())
    text = crosspost.threads_text(cfg, job.path, "yt1")
    assert len(text) <= crosspost.THREADS_MAX
    assert text.startswith("The town that banned dying")
    assert "https://youtu.be/yt1" in text and "💬 Would you move there?" in text


class _FB:
    def __init__(self):
        self.calls = []

    def get(self, url, params=None, headers=None, timeout=None):
        self.calls.append(("get", url, params, headers))
        if url.endswith("/me/accounts"):
            return _Resp({"data": [{"id": "P1", "name": "WeirdButTrue", "access_token": "ptok", "instagram_business_account": {"id": "17841"}}]})
        if params and params.get("fields") == "permalink_url":
            return _Resp({"permalink_url": "/reel/123"})
        return _Resp({"status": {"video_status": "ready", "processing_phase": {"status": "complete"}, "publishing_phase": {"status": "complete"}}})

    def post(self, url, data=None, headers=None, timeout=None, files=None):
        self.calls.append(("post", url, data if isinstance(data, dict) else None, headers))
        if url == instagram.LITTERBOX:
            r = _Resp({})
            r.text = "https://litter.catbox.moe/abc.mp4"
            return r
        if url.endswith("/video_reels") and data["upload_phase"] == "start":
            return _Resp({"video_id": "V1", "upload_url": "https://rupload.facebook.com/video-upload/v26.0/V1"})
        return _Resp({"success": True})


def test_facebook_posts_a_reel_to_the_linked_page_from_a_link(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("INSTAGRAM_TOKEN", "tok")
    monkeypatch.setenv("INSTAGRAM_USER_ID", "17841")
    video = tmp_path / "video.mp4"
    video.write_bytes(b"x")
    s = _FB()
    assert crosspost.post_facebook(_cfg(tmp_path), video, "hi", session=s, sleep=lambda _: None) == "V1"
    upload = next(c for c in s.calls if "rupload" in c[1])
    assert upload[3]["file_url"] == "https://litter.catbox.moe/abc.mp4" and upload[3]["Authorization"] == "OAuth ptok"
    finish = [c for c in s.calls if c[1].endswith("/P1/video_reels")][-1]
    assert finish[2] == {"upload_phase": "finish", "video_id": "V1", "video_state": "PUBLISHED", "description": "hi"}
    assert "https://www.facebook.com/reel/123" in capsys.readouterr().out


def test_facebook_gets_the_file_itself_when_it_cant_fetch_the_link(tmp_path, monkeypatch):
    monkeypatch.setenv("INSTAGRAM_TOKEN", "tok")
    monkeypatch.setenv("INSTAGRAM_USER_ID", "17841")
    video = tmp_path / "video.mp4"
    video.write_bytes(b"x")

    class S(_FB):
        def post(self, url, data=None, headers=None, timeout=None, files=None):
            if "rupload" in url and "file_url" in headers:
                self.calls.append(("post", url, None, headers))
                return _Resp({"debug_info": {"type": "FileUrlProcessingError"}}, status=422)
            return super().post(url, data, headers, timeout, files)

    s = S()
    assert crosspost.post_facebook(_cfg(tmp_path), video, "hi", session=s, sleep=lambda _: None) == "V1"
    uploads = [c[3] for c in s.calls if "rupload" in c[1]]
    assert "file_url" in uploads[0] and uploads[1]["file_size"] == "1" and "file_url" not in uploads[1]


class _Threads:
    def __init__(self, refreshed="tok2"):
        self.calls, self.refreshed = [], refreshed

    def get(self, url, params=None, headers=None, timeout=None):
        self.calls.append(("get", url, params))
        if url.endswith("/access_token"):
            return _Resp({"error": {"message": "already long-lived"}}, status=400)
        if url.endswith("/refresh_access_token"):
            return _Resp({"access_token": self.refreshed})
        if params.get("fields") == "permalink":
            return _Resp({"permalink": "https://www.threads.com/@x/post/1"})
        return _Resp({"status": "FINISHED"})

    def post(self, url, data=None, params=None, headers=None, timeout=None, files=None):
        self.calls.append(("post", url, data, params))
        if url == instagram.LITTERBOX:
            r = _Resp({})
            r.text = "https://litter.catbox.moe/abc.mp4"
            return r
        return _Resp({"id": "T1"})


def test_threads_posts_the_video_from_a_link(tmp_path, monkeypatch):
    monkeypatch.setenv("THREADS_TOKEN", "tok")
    video = tmp_path / "video.mp4"
    video.write_bytes(b"x")
    s = _Threads()
    assert crosspost.post_threads(_cfg(tmp_path, threads={"topic": "Weird History"}), video, "hi", session=s, sleep=lambda _: None) == "T1"
    create = next(c for c in s.calls if c[1].endswith("/me/threads"))
    assert create[2]["video_url"] == "https://litter.catbox.moe/abc.mp4" and create[2]["topic_tag"] == "Weird History"
    assert create[3]["access_token"] == "tok"


def test_threads_token_is_renewed_weekly_and_kept_encrypted(tmp_path, monkeypatch):
    monkeypatch.setenv("THREADS_TOKEN", "tok")
    monkeypatch.setenv("THREADS_APP_SECRET", "appsecret")
    cfg = _cfg(tmp_path)
    t0 = datetime(2026, 10, 18, tzinfo=timezone.utc)
    assert crosspost.threads_token(cfg, _Threads(), now=t0) == "tok"
    assert "tok" not in json.loads(Uploads(cfg).note("threads_token"))["token"]
    assert crosspost.threads_token(cfg, _Threads(), now=t0 + timedelta(days=1)) == "tok"
    assert crosspost.threads_token(cfg, _Threads("tok2"), now=t0 + timedelta(days=8)) == "tok2"
    assert crosspost.threads_token(cfg, _Threads("tok3"), now=t0 + timedelta(days=9)) == "tok2"
    monkeypatch.setenv("THREADS_TOKEN", "new")  # a new secret replaces the kept token
    assert crosspost.threads_token(cfg, _Threads(), now=t0 + timedelta(days=10)) == "new"


def test_each_platform_posts_a_short_once_and_setup_problems_cost_no_tries(tmp_path, monkeypatch):
    now = datetime(2026, 10, 17, 14, 0, tzinfo=timezone.utc)
    cfg = _cfg(tmp_path, facebook={"publish": True})
    job = _folder(cfg)
    Uploads(cfg).queue_reel("yt1", job.id, (now - timedelta(hours=1)).isoformat(timespec="seconds"))
    monkeypatch.setenv("INSTAGRAM_TOKEN", "tok")
    monkeypatch.setenv("INSTAGRAM_USER_ID", "1")
    check = {"result": "::warning::can't post to Facebook yet: no permission"}
    posted = []
    monkeypatch.setitem(
        crosspost.PLATFORMS, "facebook",
        (lambda c: c.facebook, lambda: True, lambda c: check["result"], crosspost.facebook_text, lambda c, v, t: posted.append(t) or "V1"),
    )
    for _ in range(8):
        assert crosspost.post_due(cfg, "facebook", now) == 0
    check["result"] = "Facebook works"
    assert crosspost.post_due(cfg, "facebook", now) == 1
    assert "https://youtu.be/yt1" in posted[0]
    assert crosspost.post_due(cfg, "facebook", now) == 0
    assert Uploads(cfg).due_reels(now.isoformat(), (now - timedelta(days=2)).isoformat())  # Instagram's own queue is untouched


def test_a_facebook_reel_whose_status_cant_be_read_counts_as_posted(tmp_path, monkeypatch):
    monkeypatch.setenv("INSTAGRAM_TOKEN", "tok")
    monkeypatch.setenv("INSTAGRAM_USER_ID", "17841")
    video = tmp_path / "video.mp4"
    video.write_bytes(b"x")

    class S(_FB):
        def get(self, url, params=None, headers=None, timeout=None):
            if params and params.get("fields") == "status":
                return _Resp({"error": {"message": "Unsupported get request. Object with ID 'V1' does not exist"}}, status=400)
            return super().get(url, params, headers, timeout)

    assert crosspost.post_facebook(_cfg(tmp_path), video, "hi", session=S(), sleep=lambda _: None) == "V1"
