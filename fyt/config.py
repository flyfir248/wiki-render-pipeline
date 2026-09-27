"""Channel config (channel.yaml) plus secrets from the environment / .env."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Literal

import yaml
from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parent.parent
RENDERER_DIR = ROOT / "renderer"


def load_dotenv(path: Path = ROOT / ".env") -> None:
    """Minimal .env loader: KEY=VALUE lines, existing env vars win."""
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


class Theme(BaseModel):
    background: str = "#0b1020"
    background2: str = "#1b2350"
    accent: str = "#ffcc33"
    accent2: str = "#4dd6ff"
    text: str = "#ffffff"
    muted: str = "#a9b3d6"
    font: str = "Inter, 'Helvetica Neue', Arial, sans-serif"


class ChannelInfo(BaseModel):
    name: str = "My Channel"
    niche: str = "surprising explainers about money, science and history"
    audience: str = "curious adults who want clear, fact-checked explanations"
    tone: str = "confident, warm, fast-paced, no hype or clickbait lies"
    language: str = "en"


class VoiceConfig(BaseModel):
    # elevenlabs: best quality (paid). edge: free Microsoft neural voices.
    # espeak: offline espeak-ng voice (robotic; no network or key needed).
    # silent: no audio, timings estimated -- for testing the render only.
    provider: Literal["elevenlabs", "edge", "espeak", "silent"] = "edge"
    elevenlabs_voice_id: str = "JBFqnCBsd6RMkjVDRZzb"
    elevenlabs_model: str = "eleven_multilingual_v2"
    edge_voice: str = "en-US-AndrewMultilingualNeural"
    edge_rate: str = "+5%"
    espeak_voice: str = "en-us"
    espeak_wpm: int = 165
    gap_seconds: float = 0.35  # pause between scenes


class YouTubeConfig(BaseModel):
    privacy: Literal["private", "unlisted", "public"] = "private"
    category_id: str = "27"  # Education
    made_for_kids: bool = False
    # Must be true when the video has realistic AI-generated voices/footage.
    contains_synthetic_media: bool = True
    # Hours from upload to scheduled publish; forces privacy=private until then.
    publish_delay_hours: float | None = None
    upload_captions: bool = True


class Config(BaseModel):
    channel: ChannelInfo = Field(default_factory=ChannelInfo)
    format: Literal["long", "short"] = "long"
    target_minutes: float = 6.0  # ignored for shorts (always < 60s)
    model: str = "claude-opus-5"
    research: bool = True  # use Claude's web search before scripting
    voice: VoiceConfig = Field(default_factory=VoiceConfig)
    music_dir: str = "assets/music"
    music_volume: float = 0.07
    stock_footage: bool = True  # needs PEXELS_API_KEY
    captions: bool = True
    visualizer: bool = True
    theme: Theme = Field(default_factory=Theme)
    youtube: YouTubeConfig = Field(default_factory=YouTubeConfig)
    # Upload only after `fyt approve <job>`; strongly recommended (see README).
    require_review: bool = True
    jobs_dir: str = "jobs"
    seed_topics: list[str] = Field(default_factory=list)

    @property
    def jobs_path(self) -> Path:
        return (ROOT / self.jobs_dir).resolve()

    @property
    def target_seconds(self) -> float:
        return 50.0 if self.format == "short" else self.target_minutes * 60


def load_config(path: str | Path | None = None) -> Config:
    load_dotenv()
    path = Path(path or os.environ.get("FYT_CONFIG", ROOT / "channel.yaml"))
    if not path.exists():
        return Config()
    return Config.model_validate(yaml.safe_load(path.read_text()) or {})


def secret(name: str) -> str | None:
    value = os.environ.get(name)
    return value or None
