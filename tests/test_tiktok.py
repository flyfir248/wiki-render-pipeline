import json
from urllib.parse import parse_qs, urlparse

import pytest

from fyt import crosspost, tiktok
from fyt.store import Uploads
from tests.test_crosspost import _cfg, _folder
from tests.test_instagram import _Resp


@pytest.fixture
def secrets(monkeypatch):
    monkeypatch.setenv("TIKTOK_CLIENT_KEY", "key")
    monkeypatch.setenv("TIKTOK_CLIENT_SECRET", "csecret")
    monkeypatch.setenv("TIKTOK_REFRESH_TOKEN", "r1")


class _TikTok:
    def __init__(self, options=("PUBLIC_TO_EVERYONE", "SELF_ONLY"), refresh="r2", status="SEND_TO_USER_INBOX"):
        self.calls, self.options, self.refresh, self.status = [], list(options), refresh, status

    def post(self, url, data=None, json=None, headers=None, timeout=None):
        self.calls.append(("post", url, data, json, headers))
        if url.endswith("/oauth/token/"):
            if data["grant_type"] == "authorization_code":
                return _Resp({"access_token": "a0", "refresh_token": "r1", "scope": "user.info.basic,video.upload"})
            return _Resp({"access_token": f"a-{data['refresh_token']}", "refresh_token": self.refresh})
        if url.endswith("/creator_info/query/"):
            data = {"creator_username": "weirdbuttrue", "privacy_level_options": self.options, "duet_disabled": True}
            return _Resp({"data": data, "error": {"code": "ok"}})
        if url.endswith("/video/init/"):
            return _Resp({"data": {"publish_id": "p1", "upload_url": "https://open-upload.tiktokapis.com/up?x=1"}, "error": {"code": "ok"}})
        if url.endswith("/status/fetch/"):
            return _Resp({"data": {"status": self.status, "publicaly_available_post_id": [7]}, "error": {"code": "ok"}})
        raise AssertionError(url)

    def put(self, url, data=None, headers=None, timeout=None):
        self.calls.append(("put", url, len(data), headers))
        return _Resp({})


def _video(tmp_path, monkeypatch):
    monkeypatch.setattr(tiktok.instagram, "for_instagram", lambda video, out: video)
    video = tmp_path / "video.mp4"
    video.write_bytes(b"x" * 1000)
    return video


def test_draft_goes_to_the_inbox_without_a_caption_and_puts_it_in_the_summary(tmp_path, monkeypatch, secrets):
    summary = tmp_path / "summary.md"
    monkeypatch.setenv("GITHUB_STEP_SUMMARY", str(summary))
    s = _TikTok()
    assert tiktok.post(_cfg(tmp_path), _video(tmp_path, monkeypatch), "Title\n\n#truestory", session=s, sleep=lambda _: None) == "p1"
    init = next(c for c in s.calls if c[1].endswith("/video/init/"))
    assert "/inbox/" in init[1] and init[3] == {"source_info": {"source": "FILE_UPLOAD", "video_size": 1000, "chunk_size": 1000, "total_chunk_count": 1}}
    assert init[4]["Authorization"] == "Bearer a-r1"
    put = next(c for c in s.calls if c[0] == "put")
    assert put[3]["Content-Range"] == "bytes 0-999/1000"
    assert "#truestory" in summary.read_text()


def test_direct_posts_publicly_when_offered_and_privately_when_not(tmp_path, monkeypatch, secrets):
    cfg = _cfg(tmp_path, tiktok={"mode": "direct"})
    s = _TikTok(status="PUBLISH_COMPLETE")
    tiktok.post(cfg, _video(tmp_path, monkeypatch), "hi", session=s, sleep=lambda _: None)
    info = next(c for c in s.calls if c[1].endswith("/video/init/"))[3]["post_info"]
    assert "/inbox/" not in next(c for c in s.calls if c[1].endswith("/video/init/"))[1]
    assert info["privacy_level"] == "PUBLIC_TO_EVERYONE" and info["is_aigc"] is True and info["disable_duet"] is True and info["title"] == "hi"

    s = _TikTok(options=["SELF_ONLY"], status="PUBLISH_COMPLETE")  # an app TikTok hasn't audited
    tiktok.post(cfg, _video(tmp_path, monkeypatch), "hi", session=s, sleep=lambda _: None)
    assert next(c for c in s.calls if c[1].endswith("/video/init/"))[3]["post_info"]["privacy_level"] == "SELF_ONLY"
    assert "only privately" in tiktok.check(cfg, s)


def test_a_failed_upload_raises(tmp_path, monkeypatch, secrets):
    with pytest.raises(RuntimeError, match="could not take"):
        tiktok.post(_cfg(tmp_path), _video(tmp_path, monkeypatch), "hi", session=_TikTok(status="FAILED"), sleep=lambda _: None)


def test_large_files_go_in_chunks_with_the_remainder_in_the_last():
    size = 150 * 1024 * 1024 + 5
    chunk, count = tiktok._chunks(size)
    assert (chunk, count) == (tiktok.CHUNK, 15)
    assert size - chunk * (count - 1) < 2 * tiktok.CHUNK


def test_a_newer_refresh_token_is_kept_encrypted_until_the_secret_changes(tmp_path, monkeypatch, secrets):
    cfg = _cfg(tmp_path)
    assert tiktok.access_token(cfg, _TikTok(refresh="r2")) == "a-r1"
    assert "r2" not in json.loads(Uploads(cfg).note("tiktok_token"))["token"]
    assert tiktok.access_token(cfg, _TikTok(refresh="r3")) == "a-r2"
    monkeypatch.setenv("TIKTOK_REFRESH_TOKEN", "fresh")
    assert tiktok.access_token(cfg, _TikTok()) == "a-fresh"


def test_the_sign_in_link_and_the_address_tiktok_sends_back(monkeypatch):
    query = parse_qs(urlparse(tiktok.authorize_url("key", "https://github.com/x/y")).query)
    assert query["client_key"] == ["key"] and query["scope"] == [tiktok.SCOPES] and query["redirect_uri"] == ["https://github.com/x/y"]
    s = _TikTok()
    got = tiktok.exchange_code("key", "sec", "https://github.com/x/y", "https://github.com/x/y?code=abc%2A1&scopes=video.upload&state=z", s)
    assert got["refresh_token"] == "r1" and s.calls[0][2]["code"] == "abc*1"
    with pytest.raises(RuntimeError, match="said no"):
        tiktok.exchange_code("key", "sec", "u", "https://github.com/x/y?error=access_denied", s)


def test_the_caption_names_the_channel_instead_of_the_bio(tmp_path):
    cfg = _cfg(tmp_path)
    text = tiktok.text(cfg, _folder(cfg).path, "yt1")
    assert "on YouTube: @FacelessYT" in text and "Link in bio" not in text
    assert "tiktok" in crosspost.PLATFORMS and crosspost._name("tiktok") == "TikTok"
