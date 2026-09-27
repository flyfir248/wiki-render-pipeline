"""YouTube Data API v3: OAuth, upload (video + thumbnail + captions), stats.

Setup (once): create an OAuth client of type "Desktop app" in Google Cloud with
the YouTube Data API v3 enabled, save it as secrets/client_secret.json, then run
`python -m fyt auth`.

Note: until Google audits your API project, videos uploaded through it are
locked to private. Apply for the audit early (see README).
"""

from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fyt.config import ROOT, Config
from fyt.models import Script

SCOPES = [
    "https://www.googleapis.com/auth/youtube.upload",
    "https://www.googleapis.com/auth/youtube.force-ssl",  # captions + stats
]
SECRETS = ROOT / "secrets"
CLIENT_SECRET = SECRETS / "client_secret.json"
TOKEN = SECRETS / "token.json"


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


def build_body(cfg: Config, script: Script, now: datetime | None = None) -> dict:
    description = script.description.strip()
    if script.sources:
        description += "\n\nSources:\n" + "\n".join(f"- {s}" for s in script.sources)
    if cfg.format == "short":
        description += "\n\n#Shorts"
    status = {
        "privacyStatus": cfg.youtube.privacy,
        "selfDeclaredMadeForKids": cfg.youtube.made_for_kids,
        "containsSyntheticMedia": cfg.youtube.contains_synthetic_media,
    }
    if cfg.youtube.publish_delay_hours is not None:
        publish = (now or datetime.now(timezone.utc)) + timedelta(hours=cfg.youtube.publish_delay_hours)
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
        "Also: upload thumbnail.png as the thumbnail and captions.srt as subtitles, and under\n"
        "\"Altered or synthetic content\" answer Yes (the voice is AI-generated).\n"
    )


def upload(cfg: Config, script: Script, video: Path, thumbnail: Path | None, srt: Path | None) -> str:
    from googleapiclient.errors import HttpError
    from googleapiclient.http import MediaFileUpload

    yt = _service()
    request = yt.videos().insert(
        part="snippet,status",
        body=build_body(cfg, script),
        media_body=MediaFileUpload(str(video), mimetype="video/mp4", chunksize=8 * 1024 * 1024, resumable=True),
    )
    response = None
    while response is None:
        status, response = request.next_chunk()
        if status:
            print(f"upload {int(status.progress() * 100)}%")
    video_id = response["id"]
    print(f"uploaded https://youtu.be/{video_id}")

    if thumbnail and thumbnail.exists():
        try:
            yt.thumbnails().set(videoId=video_id, media_body=MediaFileUpload(str(thumbnail))).execute()
        except HttpError as e:  # custom thumbnails need a phone-verified channel
            print(f"warning: thumbnail not set ({e.status_code}); verify the channel at youtube.com/verify")
    if srt and srt.exists() and cfg.youtube.upload_captions:
        try:
            yt.captions().insert(
                part="snippet",
                body={"snippet": {"videoId": video_id, "language": cfg.channel.language, "name": "", "isDraft": False}},
                media_body=MediaFileUpload(str(srt), mimetype="application/octet-stream"),
            ).execute()
        except HttpError as e:  # the video is up; missing captions shouldn't fail the run
            print(f"warning: captions not uploaded ({e.status_code})")
    return video_id


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
