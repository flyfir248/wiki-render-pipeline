"""Shorts cross-posted to the Facebook Page, Threads and TikTok (fyt/tiktok.py), next to the Instagram Reels.

Both go out from the same queue as the Reels (fyt/instagram.py): a Short is posted once it is public
on YouTube, with its video file fetched from the run that made it. Unlike Instagram captions, links
can be tapped on both, so each post links straight to the Short on YouTube.

Facebook posts a Reel to the Page linked to the Instagram account, with the INSTAGRAM_TOKEN secret
(it needs pages_manage_posts as well). Threads has its own API and token: THREADS_TOKEN, a long-lived
token that lasts 60 days. With THREADS_APP_SECRET set too, the token is renewed every week and kept,
encrypted with the app secret, in state.db, so it never runs out. Setup: see the README.
"""

from __future__ import annotations

import base64
import hashlib
import json
import tempfile
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

from fyt import instagram, tiktok
from fyt.config import Config, secret
from fyt.models import Script
from fyt.store import Uploads

THREADS = "https://graph.threads.net"
THREADS_MAX = 500
FB_UPLOAD = "https://rupload.facebook.com/video-upload"
RENEW_AFTER = timedelta(days=7)


def _json(r: requests.Response, who: str) -> dict:
    try:
        return instagram._json(r)
    except RuntimeError as e:
        raise RuntimeError(str(e).replace("Instagram API", f"{who} API", 1)) from None


def _wait(check, who: str, sleep) -> None:
    """Calls check() until it returns True (done) or raises; check returns False while processing."""
    for _ in range(instagram.MAX_CHECKS):
        if check():
            return
        sleep(instagram.CHECK_EVERY)
    raise RuntimeError(f"{who} was still processing the video after {instagram.MAX_CHECKS * instagram.CHECK_EVERY // 60} minutes")


def _script(folder: Path) -> Script | None:
    path = folder / "script.json"
    return Script.model_validate_json(path.read_text()) if path.exists() else None


def facebook_text(cfg: Config, folder: Path, youtube_id: str) -> str:
    cta = f"Watch the full story on YouTube: https://youtu.be/{youtube_id}"
    script = _script(folder)
    if script:
        return instagram.caption(cfg, script, cta=cta)
    return instagram.caption_for(cfg, folder).replace(cfg.instagram.cta.strip(), cta)


def threads_text(cfg: Config, folder: Path, youtube_id: str) -> str:
    """Threads allows 500 characters: the hook, a line of the story, the link and the question."""
    script = _script(folder)
    title = script.title.strip() if script else instagram.caption_for(cfg, folder).split("\n\n")[0]
    link = f"▶️ Full story on YouTube: https://youtu.be/{youtube_id}"
    question = f"💬 {script.comment_question.strip()}" if script and script.comment_question.strip() else ""
    body = instagram._body(script.description) if script else ""
    fixed = "\n\n".join(p for p in (title, link, question) if p)
    room = THREADS_MAX - len(fixed) - 2
    if body and body != title and room > 40:
        if len(body) > room:
            body = body[: room - 3].rsplit(" ", 1)[0] + "..."
        return "\n\n".join(p for p in (title, body, link, question) if p)
    return fixed[:THREADS_MAX]


# Facebook


def page(cfg: Config, session=requests) -> tuple[str, str, str]:
    """(page id, page name, page token) of the Page the Instagram account is linked to."""
    creds = instagram.credentials()
    if not creds:
        raise RuntimeError("set INSTAGRAM_TOKEN and INSTAGRAM_USER_ID")
    token, ig_user = creds
    v = cfg.instagram.api_version
    auth = {"Authorization": f"OAuth {token}"}
    pages = _json(
        session.get(f"{instagram.GRAPH}/{v}/me/accounts", params={"fields": "id,name,access_token,instagram_business_account"}, headers=auth, timeout=30),
        "Facebook",
    ).get("data", [])
    for p in pages:
        if (p.get("instagram_business_account") or {}).get("id") == ig_user:
            return p["id"], p.get("name", ""), p["access_token"]
    if len(pages) == 1:
        return pages[0]["id"], pages[0].get("name", ""), pages[0]["access_token"]
    raise RuntimeError("the INSTAGRAM_TOKEN can't see the Facebook Page linked to the Instagram account (give it the Page as an asset)")


def post_facebook(cfg: Config, video: Path, text: str, session=requests, sleep=time.sleep) -> str:
    """Post a video as a Reel on the Page. Returns the video id."""
    page_id, _, token = page(cfg, session)
    v = cfg.instagram.api_version
    auth = {"Authorization": f"OAuth {token}"}
    reels = f"{instagram.GRAPH}/{v}/{page_id}/video_reels"
    start = _json(session.post(reels, data={"upload_phase": "start"}, headers=auth, timeout=60), "Facebook")
    video_id = start["video_id"]
    upload_url = start.get("upload_url") or f"{FB_UPLOAD}/{v}/{video_id}"
    with tempfile.TemporaryDirectory() as tmp:
        upload = instagram.for_instagram(video, Path(tmp) / "reel.mp4")
        r = None
        if cfg.instagram.host in instagram.HOSTS:
            try:
                url = instagram.HOSTS[cfg.instagram.host](upload, session)
                r = session.post(upload_url, headers={**auth, "file_url": url}, timeout=300)
                if r.status_code >= 400:  # Facebook couldn't fetch the link: send the file itself
                    print(f"::warning::Facebook couldn't fetch the video from its link ({r.status_code}: {r.text[:160]}); uploading the file")
                    r = None
            except RuntimeError as e:
                print(f"::warning::{e}; uploading the file to Facebook instead")
        if r is None:  # Facebook, unlike Instagram, takes the file directly
            with upload.open("rb") as f:
                r = session.post(upload_url, headers={**auth, "offset": "0", "file_size": str(upload.stat().st_size)}, data=f, timeout=900)
        _json(r, "Facebook upload")
    _json(
        session.post(reels, data={"upload_phase": "finish", "video_id": video_id, "video_state": "PUBLISHED", "description": text}, headers=auth, timeout=60),
        "Facebook",
    )

    def done() -> bool:
        status = _json(session.get(f"{instagram.GRAPH}/{v}/{video_id}", params={"fields": "status"}, headers=auth, timeout=60), "Facebook").get("status") or {}
        for phase in ("uploading_phase", "processing_phase", "publishing_phase"):
            if (status.get(phase) or {}).get("status") == "error":
                err = (status.get(phase) or {}).get("errors") or status.get("video_status")
                raise RuntimeError(f"Facebook could not {phase.split('_')[0]} the video: {err}")
        return (status.get("publishing_phase") or {}).get("status") == "complete"

    try:
        _wait(done, "Facebook", sleep)
    except RuntimeError as e:
        if "could not" in str(e):
            raise
        # The finish call already published it; a failed status read must not lead to a second post.
        print(f"::warning::Facebook took the Reel but its status couldn't be read ({e}); counted as posted")
    try:
        link = _json(session.get(f"{instagram.GRAPH}/{v}/{video_id}", params={"fields": "permalink_url"}, headers=auth, timeout=30), "Facebook").get("permalink_url")
    except Exception:
        link = None
    if link and link.startswith("/"):
        link = "https://www.facebook.com" + link
    print(f"posted to Facebook: {link or video_id}")
    return video_id


def check_facebook(cfg: Config, session=requests) -> str:
    try:
        page_id, name, token = page(cfg, session)
        perms = _json(
            session.get(f"{instagram.GRAPH}/{cfg.instagram.api_version}/me/permissions", headers={"Authorization": f"OAuth {instagram.credentials()[0]}"}, timeout=30),
            "Facebook",
        ).get("data", [])
    except RuntimeError as e:
        return f"::warning::can't post to Facebook yet: {e}"
    granted = {p.get("permission") for p in perms if p.get("status") == "granted"}
    if perms and "pages_manage_posts" not in granted:
        return "::warning::can't post to Facebook yet: the INSTAGRAM_TOKEN needs the pages_manage_posts permission"
    return f"Facebook works: can post to the Page {name}"


# Threads


def _key() -> bytes | None:
    app_secret = secret("THREADS_APP_SECRET")
    return base64.urlsafe_b64encode(hashlib.sha256(app_secret.encode()).digest()) if app_secret else None


def threads_token(cfg: Config, session=requests, now: datetime | None = None) -> str | None:
    """THREADS_TOKEN, or the renewed copy of it kept in state.db. Renewed weekly when THREADS_APP_SECRET is set."""
    given = secret("THREADS_TOKEN")
    if not given:
        return None
    key = _key()
    if not key:
        return given
    from cryptography.fernet import Fernet, InvalidToken

    now = now or datetime.now(timezone.utc)
    uploads = Uploads(cfg)
    fernet = Fernet(key)
    seen = hashlib.sha256(given.encode()).hexdigest()
    token, at = given, None
    stored = uploads.note("threads_token")
    if stored:
        try:
            kept = json.loads(stored)
            if kept.get("from") == seen:  # a new THREADS_TOKEN secret replaces the kept one
                token, at = fernet.decrypt(kept["token"].encode()).decode(), datetime.fromisoformat(kept["at"])
        except (ValueError, KeyError, InvalidToken):
            pass
    if at is None:  # first use of this secret: make it long-lived, in case it is a 1-hour token
        try:
            r = session.get(f"{THREADS}/access_token", params={"grant_type": "th_exchange_token", "client_secret": secret("THREADS_APP_SECRET"), "access_token": token}, timeout=30)
            token = _json(r, "Threads")["access_token"]
        except (RuntimeError, KeyError):
            pass  # already long-lived
        at = now
    elif now - at >= RENEW_AFTER:
        try:
            token = _json(session.get(f"{THREADS}/refresh_access_token", params={"grant_type": "th_refresh_token", "access_token": token}, timeout=30), "Threads")["access_token"]
            at = now
        except RuntimeError as e:
            print(f"::warning::could not renew the Threads token: {e}")
    uploads.set_note("threads_token", json.dumps({"from": seen, "at": at.isoformat(), "token": fernet.encrypt(token.encode()).decode()}))
    return token


def post_threads(cfg: Config, video: Path, text: str, session=requests, sleep=time.sleep) -> str:
    token = threads_token(cfg, session)
    if not token:
        raise RuntimeError("set THREADS_TOKEN")
    params = {"access_token": token}
    fields = {"media_type": "VIDEO", "text": text}
    if cfg.threads.topic.strip():
        fields["topic_tag"] = cfg.threads.topic.strip()
    host = instagram.HOSTS.get(cfg.instagram.host, instagram.litterbox)  # Threads only fetches from a link
    with tempfile.TemporaryDirectory() as tmp:
        fields["video_url"] = host(instagram.for_instagram(video, Path(tmp) / "reel.mp4"), session)
    container = _json(session.post(f"{THREADS}/v1.0/me/threads", data=fields, params=params, timeout=60), "Threads")["id"]

    def done() -> bool:
        state = _json(session.get(f"{THREADS}/v1.0/{container}", params={**params, "fields": "status,error_message"}, timeout=60), "Threads")
        if state.get("status") in {"ERROR", "EXPIRED"}:
            raise RuntimeError(f"Threads could not process the video: {state.get('error_message') or state.get('status')}")
        return state.get("status") == "FINISHED"

    _wait(done, "Threads", sleep)
    post = _json(session.post(f"{THREADS}/v1.0/me/threads_publish", data={"creation_id": container}, params=params, timeout=60), "Threads")["id"]
    try:
        link = _json(session.get(f"{THREADS}/v1.0/{post}", params={**params, "fields": "permalink"}, timeout=30), "Threads").get("permalink")
    except Exception:
        link = None
    print(f"posted to Threads: {link or post}")
    return post


def check_threads(cfg: Config, session=requests) -> str:
    try:
        token = threads_token(cfg, session)
        name = _json(session.get(f"{THREADS}/v1.0/me", params={"fields": "username", "access_token": token}, timeout=30), "Threads").get("username")
    except RuntimeError as e:
        return f"::warning::can't post to Threads yet: {e}"
    return f"Threads works: can post as @{name}"


PLATFORMS = {
    "facebook": (lambda cfg: cfg.facebook, lambda: bool(instagram.credentials()), check_facebook, facebook_text, post_facebook),
    "threads": (lambda cfg: cfg.threads, lambda: bool(secret("THREADS_TOKEN")), check_threads, threads_text, post_threads),
    "tiktok": (lambda cfg: cfg.tiktok, tiktok.has_secrets, tiktok.check, tiktok.text, tiktok.post),
}


def _name(platform: str) -> str:
    return {"tiktok": "TikTok"}.get(platform, platform.title())


def post_due(cfg: Config, platform: str, now: datetime | None = None, tmp: Path | None = None) -> int:
    """Post the Shorts that have gone public on YouTube to `platform`. Returns how many were posted."""
    settings, has_secrets, check, text_for, post = PLATFORMS[platform]
    conf = settings(cfg)
    if not conf.publish:
        return 0
    if not has_secrets():
        print(f"::warning::{platform}.publish is on but its secrets aren't set; nothing posted to {_name(platform)}")
        return 0
    works = check(cfg)
    if works.startswith("::warning::"):  # don't use up the Shorts' tries on a setup problem
        print(works)
        return 0
    now = now or datetime.now(timezone.utc)
    uploads = Uploads(cfg)
    since = (now - timedelta(hours=cfg.instagram.max_age_hours)).isoformat(timespec="seconds")
    uploads.queue_recent_shorts(since)
    posted = 0
    with tempfile.TemporaryDirectory() as own:
        for youtube_id, job_id, run in uploads.due_crossposts(platform, now.isoformat(timespec="seconds"), since)[: conf.max_per_run]:
            folder = instagram.find_files(cfg, job_id, run, tmp or Path(own)) if job_id else None
            if folder is None:
                print(f"::warning::no video file for https://youtu.be/{youtube_id}; not posted to {_name(platform)}")
                uploads.crosspost_done(youtube_id, platform, None)
                continue
            try:
                post_id = post(cfg, folder / "video.mp4", text_for(cfg, folder, youtube_id))
            except Exception as e:
                print(f"::warning::https://youtu.be/{youtube_id} not posted to {_name(platform)}: {e}")
                uploads.crosspost_done(youtube_id, platform, None)
                continue
            uploads.crosspost_done(youtube_id, platform, post_id)
            posted += 1
    return posted
