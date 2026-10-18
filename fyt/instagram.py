"""Shorts cross-posted as Instagram Reels, to bring Instagram viewers to the YouTube channel.

Every Short gets instagram.txt next to its video: a caption written for Instagram (the hook, a line
of the story, a call to action pointing to the channel, the source credit and at most five
hashtags). Links in captions can't be tapped on Instagram, so the call to action points to the
link in the profile's bio, which is set by hand in the app.

Posting goes through the Instagram Graph API with Facebook Login, the only route that takes a
video file straight from disk (a resumable upload to rupload.facebook.com); the Instagram Login
route needs the video at a public URL first. A Short is queued when it is uploaded to YouTube and
posted by `fyt reels` once it is public there, so the Reel never comes out before the Short.
Setup: see "Instagram Reels" in the README.
"""

from __future__ import annotations

import re
import subprocess
import tempfile
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

from fyt.config import Config, secret
from fyt.models import Script
from fyt.store import Job, Uploads

GRAPH = "https://graph.facebook.com"
RUPLOAD = "https://rupload.facebook.com/ig-api-upload"
LITTERBOX = "https://litterbox.catbox.moe/resources/internals/api.php"
USER_AGENT = "FacelessYT/0.1 (https://github.com/flyfir248/FacelessYT)"
MAX_CAPTION = 2200
BODY_CHARS = 300
CHECK_EVERY = 15  # seconds between checks while Instagram processes the video
MAX_CHECKS = 40  # 10 minutes
SKIP_TAGS = {"shorts", "youtubeshorts", "short", "youtube", "reels"}
ATTRIBUTION = re.compile(r'Based on the Wikipedia article "(.+?)" \((.+?)\), licensed (CC BY-SA [\d.]+)\.')
WORKFLOW = "daily-short.yml"


def hashtag(tag: str) -> str:
    """'Weird history' -> 'weirdhistory'; '' when nothing usable is left."""
    return re.sub(r"[^\w]", "", tag.lower().lstrip("#"), flags=re.UNICODE).strip("_")[:30]


def hashtags(cfg: Config, script: Script) -> list[str]:
    out: list[str] = []
    for tag in [*cfg.instagram.hashtags, *script.tags]:
        h = hashtag(tag)
        if h and not h.isdigit() and h not in SKIP_TAGS and h not in out:
            out.append(h)
    return out[: cfg.instagram.max_hashtags]


def _body(description: str) -> str:
    """The first paragraph of the YouTube description that reads as story: no links, credits or chapters."""
    for para in re.split(r"\n\s*\n", description):
        para = " ".join(para.split())
        if not para or "http" in para or ATTRIBUTION.search(para) or para.endswith(":") or re.match(r"\d+:\d\d", para):
            continue
        if len(para) <= BODY_CHARS:
            return para
        cut = para[:BODY_CHARS]
        end = max(cut.rfind(". "), cut.rfind("! "), cut.rfind("? "))
        return cut[: end + 1] if end > 80 else cut.rsplit(" ", 1)[0] + "..."
    return ""


def caption(cfg: Config, script: Script, cta: str | None = None) -> str:
    """`cta` replaces instagram.cta, e.g. with a link where links can be tapped."""
    ig = cfg.instagram
    parts = [script.title.strip()]
    body = _body(script.description)
    if body and body != parts[0]:
        parts.append(body)
    cta = (ig.cta if cta is None else cta).strip()
    if cta:
        handle = ig.youtube_handle.strip()
        parts.append(f"▶️ {cta}" + (f" ({handle})" if handle and handle not in cta else ""))
    if script.comment_question.strip():
        parts.append(f"💬 {script.comment_question.strip()}")
    credit = ATTRIBUTION.search(script.description)
    if credit:
        parts.append(f'Source: Wikipedia, "{credit.group(1)}" ({credit.group(3)})')
    tags = " ".join(f"#{h}" for h in hashtags(cfg, script))
    text = "\n\n".join(parts)
    room = MAX_CAPTION - (len(tags) + 2 if tags else 0)
    return (text[:room].rstrip() + ("\n\n" + tags if tags else "")).strip()


def write_caption(cfg: Config, job: Job, script: Script) -> Path:
    path = job.file("instagram.txt")
    path.write_text(caption(cfg, script) + "\n")
    return path


def credentials() -> tuple[str, str] | None:
    token, user = secret("INSTAGRAM_TOKEN"), secret("INSTAGRAM_USER_ID")
    return (token, user) if token and user else None


def _json(r: requests.Response) -> dict:
    try:
        data = r.json()
    except ValueError:
        data = {}
    if r.status_code >= 400 or "error" in data:
        err = data.get("error", {})
        msg = err.get("error_user_msg") or err.get("message") or r.text[:300]
        raise RuntimeError(f"Instagram API {r.status_code}: {msg}")
    return data


def for_instagram(video: Path, out: Path) -> Path:
    """A copy in the exact format Instagram's Reels spec asks for: H.264 yuv420p (limited range),
    AAC 48 kHz, 30 fps, the moov atom first and no extra metadata boxes. Falls back to the original."""
    import imageio_ffmpeg

    cmd = [
        imageio_ffmpeg.get_ffmpeg_exe(), "-loglevel", "error", "-y", "-i", str(video),
        "-map", "0:v:0", "-map", "0:a:0?", "-map_metadata", "-1",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-profile:v", "high", "-level", "4.1",
        "-pix_fmt", "yuv420p", "-color_range", "tv", "-r", "30", "-maxrate", "20M", "-bufsize", "40M",
        "-c:a", "aac", "-b:a", "128k", "-ar", "48000", "-ac", "2", "-movflags", "+faststart", str(out),
    ]
    try:
        subprocess.run(cmd, capture_output=True, text=True, check=True, timeout=600)
        return out
    except (OSError, subprocess.SubprocessError) as e:
        print(f"::warning::could not re-encode {video.name} for Instagram, sending it as is: {getattr(e, 'stderr', e)}")
        return video


def litterbox(video: Path, session=requests) -> str:
    """A public link to the video that litterbox.catbox.moe deletes after an hour, for Instagram to fetch."""
    with video.open("rb") as f:
        r = session.post(
            LITTERBOX,
            data={"reqtype": "fileupload", "time": "1h"},
            files={"fileToUpload": ("reel.mp4", f, "video/mp4")},
            headers={"User-Agent": USER_AGENT},  # it answers 412 to python-requests' default agent
            timeout=600,
        )
    url = r.text.strip()
    if r.status_code >= 400 or not url.startswith("https://"):
        raise RuntimeError(f"temporary host refused the video ({r.status_code}): {url[:200]}")
    return url


HOSTS = {"litterbox": litterbox}


def publish(cfg: Config, video: Path, text: str, session=requests, sleep=time.sleep) -> str:
    """Post a video as a Reel. Returns the Reel's media id."""
    creds = credentials()
    if not creds:
        raise RuntimeError("set INSTAGRAM_TOKEN and INSTAGRAM_USER_ID (see `python -m fyt ig-token`)")
    token, user = creds
    v = cfg.instagram.api_version
    auth = {"Authorization": f"OAuth {token}"}
    fields = {
        "media_type": "REELS",
        "caption": text,
        "share_to_feed": "true" if cfg.instagram.share_to_feed else "false",
        "thumb_offset": str(int(cfg.instagram.cover_seconds * 1000)),
    }
    with tempfile.TemporaryDirectory() as tmp:
        upload = for_instagram(video, Path(tmp) / "reel.mp4")
        if cfg.instagram.host in HOSTS:
            # Instagram fetches the video from a public link.
            fields["video_url"] = HOSTS[cfg.instagram.host](upload, session)
            container = _json(session.post(f"{GRAPH}/{v}/{user}/media", data=fields, headers=auth, timeout=60))["id"]
        else:
            created = _json(session.post(f"{GRAPH}/{v}/{user}/media", data={**fields, "upload_type": "resumable"}, headers=auth, timeout=60))
            container = created["id"]
            with upload.open("rb") as f:
                r = session.post(
                    created.get("uri") or f"{RUPLOAD}/{v}/{container}",
                    headers={**auth, "offset": "0", "file_size": str(upload.stat().st_size)},
                    data=f,
                    timeout=900,
                )
            try:
                _json(r)
            except RuntimeError as e:
                try:  # the container's own status usually names what Instagram didn't like
                    state = session.get(f"{GRAPH}/{v}/{container}", params={"fields": "status,status_code,video_status"}, headers=auth, timeout=30).text
                except Exception:
                    state = "(no status)"
                raise RuntimeError(f"{e}; container {container}: {state[:500]}") from None
    for _ in range(MAX_CHECKS):
        state = _json(session.get(f"{GRAPH}/{v}/{container}", params={"fields": "status_code,status"}, headers=auth, timeout=60))
        code = state.get("status_code")
        if code == "FINISHED":
            break
        if code in {"ERROR", "EXPIRED"}:
            raise RuntimeError(f"Instagram could not process the video: {state.get('status') or code}")
        sleep(CHECK_EVERY)
    else:
        raise RuntimeError(f"Instagram was still processing the video after {MAX_CHECKS * CHECK_EVERY // 60} minutes")
    media = _json(session.post(f"{GRAPH}/{v}/{user}/media_publish", data={"creation_id": container}, headers=auth, timeout=60))["id"]
    try:
        link = _json(session.get(f"{GRAPH}/{v}/{media}", params={"fields": "permalink"}, headers=auth, timeout=30)).get("permalink")
    except Exception:
        link = None
    print(f"posted to Instagram: {link or media}")
    return media


def check(cfg: Config, session=requests) -> str:
    """Whether the secrets can post to the account, without posting anything."""
    token, user = credentials()
    v = cfg.instagram.api_version
    auth = {"Authorization": f"OAuth {token}"}
    try:
        name = _json(session.get(f"{GRAPH}/{v}/{user}", params={"fields": "username"}, headers=auth, timeout=30)).get("username")
        limit = _json(session.get(f"{GRAPH}/{v}/{user}/content_publishing_limit", params={"fields": "quota_usage,config"}, headers=auth, timeout=30))
    except RuntimeError as e:
        return f"::warning::the Instagram secrets don't work yet: {e}"
    used = (limit.get("data") or [{}])[0]
    total = (used.get("config") or {}).get("quota_total", "?")
    return f"Instagram secrets work: can post to @{name} ({used.get('quota_usage', 0)} of {total} posts used in the last 24 hours)"


def _from_artifact(run: str, job_id: str, into: Path) -> Path | None:
    """The job's folder from the Actions run that made it (artifacts are kept for a week)."""
    dest = into / run
    if not dest.exists():
        try:
            subprocess.run(
                ["gh", "run", "download", run.split("-")[0], "--name", f"videos-{run}", "--dir", str(dest)],
                capture_output=True, text=True, check=True,
            )
        except (OSError, subprocess.CalledProcessError) as e:
            print(f"::warning::could not fetch run {run}'s videos: {getattr(e, 'stderr', e)}")
            dest.mkdir(parents=True, exist_ok=True)  # don't try again this run
    return dest / job_id if (dest / job_id / "video.mp4").exists() else None


def find_files(cfg: Config, job_id: str, run: str | None, tmp: Path) -> Path | None:
    for folder in (cfg.jobs_path / job_id, cfg.jobs_path / "pending" / job_id):
        if (folder / "video.mp4").exists():
            return folder
    return _from_artifact(run, job_id, tmp) if run else None


def caption_for(cfg: Config, folder: Path) -> str:
    if (folder / "instagram.txt").exists():
        return (folder / "instagram.txt").read_text().strip()
    return caption(cfg, Script.model_validate_json((folder / "script.json").read_text()))


def post_due(cfg: Config, now: datetime | None = None, tmp: Path | None = None) -> int:
    """Post the Shorts that have gone public on YouTube as Reels. Returns how many were posted."""
    ig = cfg.instagram
    if not credentials():
        print("no INSTAGRAM_TOKEN / INSTAGRAM_USER_ID; Reels not posted")
        return 0
    if not (ig.enabled and ig.publish):
        print("Instagram posting is off (instagram.enabled and instagram.publish in channel.yaml)")
        print(check(cfg))  # so the secrets can be tested before posting is turned on
        return 0
    now = now or datetime.now(timezone.utc)
    uploads = Uploads(cfg)
    since = (now - timedelta(hours=ig.max_age_hours)).isoformat(timespec="seconds")
    uploads.queue_recent_shorts(since)
    due = uploads.due_reels(now.isoformat(timespec="seconds"), since)
    posted = 0
    with tempfile.TemporaryDirectory() as own:  # `tmp`: where run artifacts fetched for other platforms are kept
        for youtube_id, job_id, run in due[: ig.max_per_run]:
            folder = find_files(cfg, job_id, run, tmp or Path(own)) if job_id else None
            if folder is None:
                print(f"::warning::no video file for https://youtu.be/{youtube_id}; not posted to Instagram")
                uploads.reel_done(youtube_id, None)
                continue
            try:
                media = publish(cfg, folder / "video.mp4", caption_for(cfg, folder))
            except Exception as e:
                print(f"::warning::https://youtu.be/{youtube_id} not posted to Instagram: {e}")
                uploads.reel_done(youtube_id, None)
                continue
            uploads.reel_done(youtube_id, media)
            posted += 1
    return posted


def setup_token(app_id: str, app_secret: str, user_token: str, session=requests, version: str = "v25.0") -> dict:
    """Turn a short-lived user token from the Graph API Explorer into the two secrets the workflow needs.
    The Page token made from a long-lived user token doesn't expire."""
    long_lived = _json(
        session.get(
            f"{GRAPH}/{version}/oauth/access_token",
            params={"grant_type": "fb_exchange_token", "client_id": app_id, "client_secret": app_secret, "fb_exchange_token": user_token},
            timeout=30,
        )
    )["access_token"]
    pages = _json(
        session.get(
            f"{GRAPH}/{version}/me/accounts",
            params={"fields": "name,access_token,instagram_business_account{id,username}", "access_token": long_lived},
            timeout=30,
        )
    ).get("data", [])
    linked = [p for p in pages if p.get("instagram_business_account")]
    if not linked:
        raise RuntimeError(
            "none of your Facebook Pages has an Instagram professional account linked "
            "(Instagram app: Settings > Account type and tools, then link it to a Page)"
        )
    page = linked[0]
    account = page["instagram_business_account"]
    for token, lasting in ((page["access_token"], True), (long_lived, False)):
        try:  # needs instagram_content_publish: proves the token can post
            _json(session.get(f"{GRAPH}/{version}/{account['id']}/content_publishing_limit", params={"access_token": token}, timeout=30))
        except RuntimeError as e:
            last = e
            continue
        return {"page": page["name"], "username": account.get("username"), "user_id": account["id"], "token": token, "expires": not lasting}
    raise RuntimeError(f"the token can't publish to @{account.get('username')}: {last}")
