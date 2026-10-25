"""Shorts cross-posted to TikTok, from the same queue as the Reels (fyt/crosspost.py registers it).

TikTok's Content Posting API has two routes. `draft` (video.upload) sends the video to the TikTok app's
inbox: TikTok notifies the account, and the post is finished in the app (caption, sound, Everyone).
`direct` (video.publish) posts it outright, but TikTok keeps every post from an app it hasn't audited
private, and only lets such an app post to private accounts. TikTok's guidelines say they don't
approve a tool that only uploads to your own accounts, so `draft` is the route that ends in a public
post. Links in TikTok captions can't be tapped, so the caption names the YouTube channel instead.

Access: TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET from the TikTok developer app, and
TIKTOK_REFRESH_TOKEN, made once with `fyt tiktok-token`. TikTok access tokens last a day and are made
fresh each run; the refresh token lasts a year from its last use, and TikTok can hand back a new one,
which is kept, encrypted with the client secret, in state.db. Setup: see "TikTok" in the README.
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import tempfile
import time
from pathlib import Path
from urllib.parse import parse_qs, quote, urlencode, urlparse

import requests

from fyt import instagram
from fyt.config import Config, secret
from fyt.models import Script
from fyt.store import Uploads

API = "https://open.tiktokapis.com/v2"
AUTHORIZE = "https://www.tiktok.com/v2/auth/authorize/"
SCOPES = "user.info.basic,video.upload,video.publish"
MAX_CAPTION = 2200
SINGLE_CHUNK = 64 * 1024 * 1024  # TikTok takes a file up to this size in one piece
CHUNK = 10 * 1024 * 1024  # larger files go in chunks of 5 to 64 MB; the last one takes the rest


def _json(r: requests.Response, who: str = "TikTok") -> dict:
    """The body of a TikTok answer, or a RuntimeError with TikTok's own words."""
    try:
        data = r.json()
    except ValueError:
        data = {}
    err = data.get("error")
    if isinstance(err, dict) and err.get("code") not in (None, "ok"):
        raise RuntimeError(f"{who} API {r.status_code}: {err.get('code')}: {err.get('message') or ''}".rstrip(": "))
    if isinstance(err, str):  # the OAuth endpoint answers {"error": "...", "error_description": "..."}
        raise RuntimeError(f"{who} API {r.status_code}: {err}: {data.get('error_description') or ''}".rstrip(": "))
    if r.status_code >= 400:
        raise RuntimeError(f"{who} API {r.status_code}: {r.text[:300]}")
    return data


def text(cfg: Config, folder: Path, youtube_id: str) -> str:
    """The Instagram caption with a call to action that names the YouTube channel (no link in bio)."""
    handle = cfg.instagram.youtube_handle.strip()
    cta = cfg.tiktok.cta.strip() + (f" {handle}" if handle and handle not in cfg.tiktok.cta else "")
    path = folder / "script.json"
    script = Script.model_validate_json(path.read_text()) if path.exists() else None
    if script:
        return instagram.caption(cfg, script, cta=cta)[:MAX_CAPTION]
    return instagram.caption_for(cfg, folder).replace(cfg.instagram.cta.strip(), cta)[:MAX_CAPTION]


# Access


def has_secrets() -> bool:
    return all(secret(k) for k in ("TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET", "TIKTOK_REFRESH_TOKEN"))


def _token_request(fields: dict, session=requests) -> dict:
    r = session.post(f"{API}/oauth/token/", data=fields, headers={"Content-Type": "application/x-www-form-urlencoded"}, timeout=30)
    return _json(r, "TikTok login")


def authorize_url(client_key: str, redirect_uri: str, state: str | None = None) -> str:
    state = state or base64.urlsafe_b64encode(os.urandom(12)).decode()
    query = {"client_key": client_key, "scope": SCOPES, "response_type": "code", "redirect_uri": redirect_uri, "state": state}
    return f"{AUTHORIZE}?{urlencode(query, quote_via=quote, safe=',')}"


def exchange_code(client_key: str, client_secret: str, redirect_uri: str, code_or_url: str, session=requests) -> dict:
    """The tokens for the code TikTok put in the address it sent the browser back to (or the code itself)."""
    code = code_or_url.strip()
    if code.startswith("http"):
        query = parse_qs(urlparse(code).query)
        if "error" in query:
            raise RuntimeError(f"TikTok said no: {query['error'][0]}: {query.get('error_description', [''])[0]}")
        if "code" not in query:
            raise RuntimeError("that address has no code= in it; copy the whole address TikTok sent you to")
        code = query["code"][0]
    fields = {"client_key": client_key, "client_secret": client_secret, "code": code, "grant_type": "authorization_code", "redirect_uri": redirect_uri}
    return _token_request(fields, session)


def _fernet():
    from cryptography.fernet import Fernet

    return Fernet(base64.urlsafe_b64encode(hashlib.sha256(secret("TIKTOK_CLIENT_SECRET").encode()).digest()))


def access_token(cfg: Config, session=requests) -> str:
    """A fresh access token from the refresh token (the secret's, or the newer one kept in state.db)."""
    from cryptography.fernet import InvalidToken

    if not has_secrets():
        raise RuntimeError("set TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET and TIKTOK_REFRESH_TOKEN")
    given = secret("TIKTOK_REFRESH_TOKEN")
    seen = hashlib.sha256(given.encode()).hexdigest()
    uploads = Uploads(cfg)
    refresh = given
    stored = uploads.note("tiktok_token")
    if stored:
        try:
            kept = json.loads(stored)
            if kept.get("from") == seen:  # a new TIKTOK_REFRESH_TOKEN secret replaces the kept one
                refresh = _fernet().decrypt(kept["token"].encode()).decode()
        except (ValueError, KeyError, InvalidToken):
            pass
    fields = {"client_key": secret("TIKTOK_CLIENT_KEY"), "client_secret": secret("TIKTOK_CLIENT_SECRET"), "grant_type": "refresh_token", "refresh_token": refresh}
    try:
        got = _token_request(fields, session)
    except RuntimeError:
        if refresh == given:
            raise
        got = _token_request({**fields, "refresh_token": given}, session)  # the kept one was refused: try the secret's
    new = got.get("refresh_token") or refresh
    uploads.set_note("tiktok_token", json.dumps({"from": seen, "token": _fernet().encrypt(new.encode()).decode()}))
    return got["access_token"]


def _headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json; charset=UTF-8"}


def creator(token: str, session=requests) -> dict:
    """What the account allows: privacy_level_options, comment/duet/stitch_disabled, max_video_post_duration_sec."""
    return _json(session.post(f"{API}/post/publish/creator_info/query/", headers=_headers(token), timeout=30)).get("data", {})


def check(cfg: Config, session=requests) -> str:
    try:
        token = access_token(cfg, session)
        if cfg.tiktok.mode == "direct":
            info = creator(token, session)
            name, options = info.get("creator_username") or info.get("creator_nickname"), info.get("privacy_level_options") or []
            if "PUBLIC_TO_EVERYONE" not in options:
                return f"TikTok works: can post as @{name}, but only privately until TikTok audits the app (it offers {', '.join(options) or 'nothing'})"
            return f"TikTok works: can post as @{name}"
        r = session.get(f"{API}/user/info/", params={"fields": "open_id,display_name"}, headers=_headers(token), timeout=30)
        name = (_json(r).get("data", {}).get("user") or {}).get("display_name")
    except RuntimeError as e:
        return f"::warning::can't post to TikTok yet: {e}"
    return f"TikTok works: can send drafts to {name}'s TikTok inbox"


# Posting


def _chunks(size: int) -> tuple[int, int]:
    """(chunk_size, total_chunk_count) as TikTok counts them: the last chunk takes the remainder."""
    if size <= SINGLE_CHUNK:
        return size, 1
    return CHUNK, size // CHUNK


def _upload(upload_url: str, video: Path, chunk: int, count: int, session) -> None:
    size = video.stat().st_size
    with video.open("rb") as f:
        for i in range(count):
            first = i * chunk
            last = size - 1 if i == count - 1 else first + chunk - 1
            body = f.read(last - first + 1)
            headers = {"Content-Type": "video/mp4", "Content-Length": str(len(body)), "Content-Range": f"bytes {first}-{last}/{size}"}
            r = session.put(upload_url, data=body, headers=headers, timeout=600)
            if r.status_code >= 400:
                raise RuntimeError(f"TikTok upload {r.status_code}: {r.text[:300]}")


def _summary(lines: str) -> None:
    """Add to the run's summary page, where the drafts' captions wait to be pasted in the app."""
    path = os.environ.get("GITHUB_STEP_SUMMARY")
    if path:
        with open(path, "a") as f:
            f.write(lines + "\n")


def post(cfg: Config, video: Path, caption: str, session=requests, sleep=time.sleep) -> str:
    """Send the video to TikTok (a draft in the app's inbox, or a post). Returns the publish id."""
    from fyt.crosspost import _wait

    tt = cfg.tiktok
    token = access_token(cfg, session)
    with tempfile.TemporaryDirectory() as tmp:
        upload = instagram.for_instagram(video, Path(tmp) / "tiktok.mp4")  # 9:16 H.264 + AAC suits TikTok too
        size = upload.stat().st_size
        chunk, count = _chunks(size)
        source = {"source": "FILE_UPLOAD", "video_size": size, "chunk_size": chunk, "total_chunk_count": count}
        if tt.mode == "direct":
            info = creator(token, session)
            options = info.get("privacy_level_options") or []
            privacy = tt.privacy if tt.privacy in options else "SELF_ONLY"
            if privacy != tt.privacy:
                print(f"::warning::TikTok only offers {', '.join(options)} to this app, so the post is {privacy}")
            body = {
                "post_info": {
                    "title": caption,
                    "privacy_level": privacy,
                    "disable_comment": bool(info.get("comment_disabled")),
                    "disable_duet": bool(info.get("duet_disabled")),
                    "disable_stitch": bool(info.get("stitch_disabled")),
                    "video_cover_timestamp_ms": int(cfg.instagram.cover_seconds * 1000),
                    "brand_content_toggle": False,
                    "brand_organic_toggle": False,
                    "is_aigc": tt.ai_label,
                },
                "source_info": source,
            }
            init = f"{API}/post/publish/video/init/"
        else:
            body, init = {"source_info": source}, f"{API}/post/publish/inbox/video/init/"
        data = _json(session.post(init, json=body, headers=_headers(token), timeout=60)).get("data", {})
        publish_id = data["publish_id"]
        _upload(data["upload_url"], upload, chunk, count, session)

    finished = {"SEND_TO_USER_INBOX"} if tt.mode == "draft" else {"PUBLISH_COMPLETE"}
    result: dict = {}

    def done() -> bool:
        state = _json(session.post(f"{API}/post/publish/status/fetch/", json={"publish_id": publish_id}, headers=_headers(token), timeout=60))
        result.update(state.get("data", {}))
        if result.get("status") == "FAILED":
            raise RuntimeError(f"TikTok could not take the video: {result.get('fail_reason') or 'no reason given'}")
        return result.get("status") in finished or result.get("status") == "PUBLISH_COMPLETE"

    try:
        _wait(done, "TikTok", sleep)
    except RuntimeError as e:
        if "could not" in str(e):
            raise
        # The upload went through; a slow status must not lead to a second copy.
        print(f"::warning::TikTok took the video but hadn't finished with it ({e}); counted as sent")
    if tt.mode == "draft":
        print(f"sent to the TikTok inbox: {video.parent.name}")
        _summary(f"### TikTok draft: {caption.splitlines()[0]}\nOpen the TikTok app's inbox, tap the draft, paste this caption and post it to Everyone.\n\n```\n{caption}\n```\n")
    else:
        ids = result.get("publicaly_available_post_id") or []  # sic: TikTok's own spelling
        print(f"posted to TikTok: {ids[0] if ids else publish_id}")
    return publish_id
