"""YouTube Data API v3: OAuth, upload (video + thumbnail + captions), stats.

Setup (once): create an OAuth client of type "Desktop app" in Google Cloud with
the YouTube Data API v3 enabled, save it as secrets/client_secret.json, then run
`python -m fyt auth`.

Note: Google may lock uploads from an unaudited API project to private
(see README).
"""

from __future__ import annotations

import json
import os
import random
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fyt.config import ROOT, Config
from fyt.models import Script

SCOPES = [
    "https://www.googleapis.com/auth/youtube.upload",
    "https://www.googleapis.com/auth/youtube.force-ssl",  # captions, playlists, comments, stats
    "https://www.googleapis.com/auth/yt-analytics.readonly",  # how long viewers watch each video
]
ANALYTICS_SCOPE = SCOPES[2]
SECRETS = ROOT / "secrets"
CLIENT_SECRET = SECRETS / "client_secret.json"
TOKEN = SECRETS / "token.json"
MIN_PUBLISH_LEAD_MINUTES = 15
RETRIABLE_STATUS = {500, 502, 503, 504}


def auth() -> None:
    from google_auth_oauthlib.flow import InstalledAppFlow

    if not CLIENT_SECRET.exists():
        raise SystemExit(f"Missing {CLIENT_SECRET}. Download a Desktop OAuth client JSON from Google Cloud.")
    flow = InstalledAppFlow.from_client_secrets_file(str(CLIENT_SECRET), SCOPES)
    creds = flow.run_local_server(port=0, open_browser=True)
    TOKEN.write_text(creds.to_json())
    print(f"Saved credentials to {TOKEN}")


def authorised() -> bool:
    """Whether uploads can run: a token from `fyt auth` or the YOUTUBE_TOKEN_JSON secret."""
    return TOKEN.exists() or bool(os.environ.get("YOUTUBE_TOKEN_JSON", "").strip())


FULL_SCOPE = "https://www.googleapis.com/auth/youtube.force-ssl"


def _scopes() -> list[str]:
    try:
        raw = TOKEN.read_text() if TOKEN.exists() else os.environ.get("YOUTUBE_TOKEN_JSON", "")
        scopes = json.loads(raw).get("scopes")
    except (OSError, ValueError):
        return []
    return scopes.split() if isinstance(scopes, str) else list(scopes or [])  # unknown: assume none


def can_manage() -> bool:
    """Whether the token may do more than upload (caption tracks, playlists, comments, stats).
    Tokens made with only the upload scope get 403 for those."""
    scopes = _scopes()
    return FULL_SCOPE in scopes or "https://www.googleapis.com/auth/youtube" in scopes


def can_analyze() -> bool:
    """Whether the token may read YouTube Analytics (watch time per video)."""
    return ANALYTICS_SCOPE in _scopes()


def playlists() -> dict[str, dict]:
    """The channel's playlists by title: id and description."""
    yt = _service()
    out: dict[str, dict] = {}
    request = yt.playlists().list(part="snippet", mine=True, maxResults=50)
    while request is not None:
        resp = request.execute()
        for p in resp.get("items", []):
            out[p["snippet"]["title"]] = {"id": p["id"], "description": p["snippet"].get("description", "")}
        request = yt.playlists().list_next(request, resp)
    return out


def create_playlist(name: str, description: str = "", privacy: str = "public") -> str:
    body = {"snippet": {"title": name, "description": description}, "status": {"privacyStatus": privacy}}
    return _service().playlists().insert(part="snippet,status", body=body).execute()["id"]


def describe_playlist(playlist_id: str, name: str, description: str) -> None:
    body = {"id": playlist_id, "snippet": {"title": name, "description": description}}
    _service().playlists().update(part="snippet", body=body).execute()


def playlist_items(playlist_id: str) -> dict[str, str]:
    """video id -> playlist item id, for every video in the playlist."""
    yt = _service()
    out: dict[str, str] = {}
    request = yt.playlistItems().list(part="contentDetails", playlistId=playlist_id, maxResults=50)
    while request is not None:
        resp = request.execute()
        for item in resp.get("items", []):
            out[item["contentDetails"]["videoId"]] = item["id"]
        request = yt.playlistItems().list_next(request, resp)
    return out


def add_playlist_item(playlist_id: str, video_id: str, top: bool = True) -> None:
    """Add a video at the top of the playlist (a new upload, so the newest is first) or at the end."""
    body = {"snippet": {"playlistId": playlist_id, "resourceId": {"kind": "youtube#video", "videoId": video_id}}}
    if top:
        body["snippet"]["position"] = 0
    _service().playlistItems().insert(part="snippet", body=body).execute()


def remove_playlist_item(item_id: str) -> None:
    _service().playlistItems().delete(id=item_id).execute()


def add_to_playlist(video_id: str, name: str, description: str = "", privacy: str = "public") -> None:
    """File the video under a playlist with this name, creating it the first time."""
    found = playlists().get(name)
    playlist_id = found["id"] if found else create_playlist(name, description, privacy)
    add_playlist_item(playlist_id, video_id)


def _service():
    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials
    from googleapiclient.discovery import build

    # In CI the token comes from a secret; locally from `fyt auth`.
    if not TOKEN.exists() and os.environ.get("YOUTUBE_TOKEN_JSON", "").strip():
        SECRETS.mkdir(exist_ok=True)
        TOKEN.write_text(os.environ["YOUTUBE_TOKEN_JSON"])
    if not TOKEN.exists():
        raise SystemExit("Not authorised. Run `python -m fyt auth` first.")
    # No scopes here: refreshing then keeps whatever the login granted. Asking for
    # scopes the token wasn't granted (e.g. one made in the OAuth Playground)
    # fails with invalid_scope.
    creds = Credentials.from_authorized_user_file(str(TOKEN))
    if not creds.valid and creds.refresh_token:
        creds.refresh(Request())
        TOKEN.write_text(creds.to_json())
    return build("youtube", "v3", credentials=creds, cache_discovery=False)


def publish_time(cfg: Config, now: datetime | None = None, rng: random.Random | None = None) -> datetime | None:
    """When a scheduled upload goes public, or None to publish right away."""
    y = cfg.youtube
    if y.publish_delay_hours is None and not y.publish_jitter_minutes:
        return None
    delay = timedelta(hours=y.publish_delay_hours or 0)
    if y.publish_jitter_minutes:
        delay += timedelta(minutes=(rng or random).uniform(0, y.publish_jitter_minutes))
    # YouTube needs publishAt in the future, with some room for the upload itself.
    delay = max(delay, timedelta(minutes=MIN_PUBLISH_LEAD_MINUTES))
    return (now or datetime.now(timezone.utc)) + delay


def build_body(
    cfg: Config,
    script: Script,
    now: datetime | None = None,
    rng: random.Random | None = None,
    publish_at: datetime | None = None,
) -> dict:
    description = script.description.strip()
    if script.sources:
        description += "\n\nSources:\n" + "\n".join(f"- {s}" for s in script.sources)
    if script.series:
        description += f"\n\nSeries: {script.series}"
    if cfg.format == "short":
        description += "\n\n#Shorts"
    status = {
        "privacyStatus": cfg.youtube.privacy,
        "selfDeclaredMadeForKids": cfg.youtube.made_for_kids,
        "containsSyntheticMedia": cfg.youtube.contains_synthetic_media,
    }
    publish = publish_at or publish_time(cfg, now, rng)
    if publish is not None:
        status["privacyStatus"] = "private"  # required for scheduled publishing
        status["publishAt"] = publish.strftime("%Y-%m-%dT%H:%M:%SZ")
    return {
        "snippet": {
            "title": script.title[:100],
            "description": description[:5000],
            "tags": script.tags,
            "categoryId": cfg.youtube.category_id,
            "defaultLanguage": cfg.channel.language,
            "defaultAudioLanguage": cfg.channel.language,
        },
        "status": status,
    }


def upload_sheet(cfg: Config, script: Script) -> str:
    """Title, description and tags to paste into YouTube Studio for a manual upload."""
    body = build_body(cfg, script)["snippet"]
    return (
        f"TITLE\n{body['title']}\n\n"
        f"DESCRIPTION\n{body['description']}\n\n"
        f"TAGS\n{', '.join(body['tags'])}\n\n"
        "Also: upload thumbnail.png as the thumbnail and captions.srt as subtitles.\n"
    )


def upload(
    cfg: Config,
    script: Script,
    video: Path,
    thumbnail: Path | None,
    srt: Path | None,
    publish_at: datetime | None = None,
    on_uploaded=None,
) -> str:
    """Upload the video, then its thumbnail and caption track. Returns the video id.
    `on_uploaded(video_id)` runs as soon as the video exists on YouTube, so a caller can record it
    even if a later step fails: retrying the whole upload would post the same video twice."""
    from googleapiclient.errors import HttpError
    from googleapiclient.http import MediaFileUpload

    yt = _service()
    request = yt.videos().insert(
        part="snippet,status",
        body=build_body(cfg, script, publish_at=publish_at),
        media_body=MediaFileUpload(str(video), mimetype="video/mp4", chunksize=8 * 1024 * 1024, resumable=True),
    )
    response, failures = None, 0
    while response is None:
        try:
            status, response = request.next_chunk()
        except (HttpError, OSError) as e:
            # A resumable upload picks up where it stopped; retry server errors and dropped connections.
            retriable = not isinstance(e, HttpError) or e.status_code in RETRIABLE_STATUS
            failures += 1
            if not retriable or failures > 5:
                raise
            wait = min(2**failures, 60)
            print(f"upload interrupted ({e}); retrying in {wait}s")
            time.sleep(wait)
            continue
        if status:
            print(f"upload {int(status.progress() * 100)}%")
    video_id = response["id"]
    print(f"uploaded https://youtu.be/{video_id}")
    if on_uploaded:
        on_uploaded(video_id)

    # From here on the video is up: nothing may fail the upload, or a retry would post it again.
    if thumbnail and thumbnail.exists():
        try:
            yt.thumbnails().set(videoId=video_id, media_body=MediaFileUpload(str(thumbnail))).execute()
        except HttpError as e:  # custom thumbnails need a phone-verified channel
            print(f"warning: thumbnail not set ({e.status_code}); verify the channel at youtube.com/verify")
        except Exception as e:  # e.g. "The read operation timed out"
            print(f"warning: thumbnail not set ({e})")
    if srt and srt.exists() and cfg.youtube.upload_captions and can_manage():
        try:
            yt.captions().insert(
                part="snippet",
                body={"snippet": {"videoId": video_id, "language": cfg.channel.language, "name": "", "isDraft": False}},
                media_body=MediaFileUpload(str(srt), mimetype="application/octet-stream"),
            ).execute()
        except HttpError as e:  # the video is up; missing captions shouldn't fail the run
            print(f"warning: captions not uploaded ({e.status_code})")
        except Exception as e:
            print(f"warning: captions not uploaded ({e})")
    return video_id


def set_synthetic_label(video_ids: list[str], value: bool) -> int:
    """Set YouTube's "altered or synthetic content" label on videos already uploaded.
    Returns how many changed. videos.update replaces the whole status, so the current one is sent back."""
    yt = _service()
    changed = 0
    for i in range(0, len(video_ids), 50):
        resp = yt.videos().list(part="status", id=",".join(video_ids[i : i + 50])).execute()
        for item in resp.get("items", []):
            status = item["status"]
            if status.get("containsSyntheticMedia", False) == value:
                continue
            keep = ("privacyStatus", "publishAt", "license", "embeddable", "publicStatsViewable", "selfDeclaredMadeForKids")
            body = {k: status[k] for k in keep if k in status}
            body["containsSyntheticMedia"] = value
            yt.videos().update(part="status", body={"id": item["id"], "status": body}).execute()
            changed += 1
    return changed


def post_comment(video_id: str, text: str) -> str:
    """Post a top-level comment from the channel on its own video. Returns the comment id.
    (The API can't pin it; pin it in YouTube Studio if you like.)"""
    resp = _service().commentThreads().insert(
        part="snippet",
        body={"snippet": {"videoId": video_id, "topLevelComment": {"snippet": {"textOriginal": text}}}},
    ).execute()
    return resp["id"]


def retention(video_ids: list[str], since: str = "2020-01-01") -> dict[str, dict]:
    """Per video: views, average seconds watched and average percentage watched, from YouTube Analytics."""
    yta = _analytics()
    out: dict[str, dict] = {}
    today = datetime.now(timezone.utc).date().isoformat()
    for i in range(0, len(video_ids), 50):
        resp = yta.reports().query(
            ids="channel==MINE",
            startDate=since,
            endDate=today,
            metrics="views,averageViewDuration,averageViewPercentage",
            dimensions="video",
            filters="video==" + ",".join(video_ids[i : i + 50]),
            maxResults=50,
        ).execute()
        for vid, views, seconds, percent in resp.get("rows", []):
            out[vid] = {"views": int(views), "seconds": float(seconds), "percent": float(percent)}
    return out


def thumbnail_clicks(video_ids: list[str], since: str = "2020-01-01") -> dict[str, dict]:
    """Per video: how often its thumbnail was shown on YouTube and the share of those that were clicked."""
    yta = _analytics()
    out: dict[str, dict] = {}
    today = datetime.now(timezone.utc).date().isoformat()
    for i in range(0, len(video_ids), 50):
        resp = yta.reports().query(
            ids="channel==MINE",
            startDate=since,
            endDate=today,
            metrics="videoThumbnailImpressions,videoThumbnailImpressionsClickRate",
            dimensions="video",
            filters="video==" + ",".join(video_ids[i : i + 50]),
            maxResults=50,
        ).execute()
        for vid, shown, rate in resp.get("rows", []):
            out[vid] = {"impressions": int(shown), "click_rate": float(rate)}
    return out


def _analytics():
    from google.oauth2.credentials import Credentials
    from googleapiclient.discovery import build

    _service()  # refreshes the token file
    return build("youtubeAnalytics", "v2", credentials=Credentials.from_authorized_user_file(str(TOKEN)), cache_discovery=False)


def retention_curve(video_id: str, since: str = "2020-01-01") -> list[tuple[float, float]]:
    """How many of the viewers are still watching at each point of a video: (fraction of the video
    elapsed, share of views still watching), about 100 points. Rewatched moments can go above 1."""
    today = datetime.now(timezone.utc).date().isoformat()
    resp = (
        _analytics()
        .reports()
        .query(
            ids="channel==MINE",
            startDate=since,
            endDate=today,
            metrics="audienceWatchRatio",
            dimensions="elapsedVideoTimeRatio",
            filters=f"video=={video_id}",
        )
        .execute()
    )
    return sorted((float(at), float(ratio)) for at, ratio in resp.get("rows", []))


def stats(video_ids: list[str]) -> list[dict]:
    yt = _service()
    out = []
    for i in range(0, len(video_ids), 50):
        resp = yt.videos().list(part="snippet,statistics", id=",".join(video_ids[i : i + 50])).execute()
        for item in resp.get("items", []):
            s = item.get("statistics", {})
            out.append(
                {
                    "id": item["id"],
                    "title": item["snippet"]["title"],
                    "views": int(s.get("viewCount", 0)),
                    "likes": int(s.get("likeCount", 0)),
                    "comments": int(s.get("commentCount", 0)),
                }
            )
    return out


def iso_seconds(duration: str) -> int:
    """'PT1M5S' -> 65."""
    import re

    m = re.fullmatch(r"P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?", duration or "")
    if not m:
        return 0
    d, h, mins, s = (int(x or 0) for x in m.groups())
    return ((d * 24 + h) * 60 + mins) * 60 + s


def recent_uploads(limit: int = 100) -> list[dict]:
    """The channel's newest uploads, scheduled ones included: id, publish_at (or None), title, description.
    Costs a few quota units; needs more than the upload-only scope."""
    yt = _service()
    channel = yt.channels().list(part="contentDetails", mine=True).execute()["items"][0]
    uploads = channel["contentDetails"]["relatedPlaylists"]["uploads"]
    ids: list[str] = []
    request = yt.playlistItems().list(part="contentDetails", playlistId=uploads, maxResults=50)
    while request is not None and len(ids) < limit:
        resp = request.execute()
        ids += [i["contentDetails"]["videoId"] for i in resp.get("items", [])]
        request = yt.playlistItems().list_next(request, resp)
    out = []
    for i in range(0, len(ids[:limit]), 50):
        resp = yt.videos().list(part="snippet,status,contentDetails", id=",".join(ids[i : i + 50])).execute()
        for item in resp.get("items", []):
            out.append(
                {
                    "id": item["id"],
                    "publish_at": item["status"].get("publishAt"),
                    "uploaded": item["snippet"].get("publishedAt"),
                    "title": item["snippet"].get("title", ""),
                    "description": item["snippet"].get("description", ""),
                    "seconds": iso_seconds(item.get("contentDetails", {}).get("duration", "")),
                }
            )
    return out
