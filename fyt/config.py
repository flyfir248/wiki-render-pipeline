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
    # kokoro: free, natural Kokoro-82M voice run locally (model downloads once, ~350 MB).
    # elevenlabs: best quality (paid). edge: free Microsoft neural voices.
    # espeak: offline espeak-ng voice (robotic; no network or key needed).
    # silent: no audio, timings estimated -- for testing the render only.
    provider: Literal["kokoro", "elevenlabs", "edge", "espeak", "silent"] = "kokoro"
    elevenlabs_voice_id: str = "JBFqnCBsd6RMkjVDRZzb"
    elevenlabs_model: str = "eleven_multilingual_v2"
    edge_voice: str = "en-US-AndrewMultilingualNeural"
    edge_rate: str = "+5%"
    kokoro_voice: str = "am_michael"  # e.g. af_heart, am_michael, bm_george, bf_emma
    kokoro_speed: float = 1.05
    kokoro_lang: str = "en-us"
    kokoro_sentence_pause: float = 0.18
    kokoro_dir: str = "assets/kokoro"
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
    # Adds a random 0..N minute delay on top, so videos don't go live at the exact
    # same minute every day. Also schedules the publish when publish_delay_hours is unset.
    publish_jitter_minutes: int = 0
    upload_captions: bool = True


class LLMConfig(BaseModel):
    # anthropic: Claude (uses `model` and ANTHROPIC_API_KEY; web research works).
    # openai: any OpenAI-compatible API, e.g. Groq's free tier serving open models,
    # OpenRouter, or a local Ollama (base_url http://localhost:11434/v1). No web research.
    provider: Literal["anthropic", "openai"] = "anthropic"
    base_url: str = "https://api.groq.com/openai/v1"
    model: str = "openai/gpt-oss-120b"  # see https://console.groq.com/docs/models
    api_key_env: str = "GROQ_API_KEY"
    temperature: float = 0.8
    # For reasoning models (gpt-oss). Hidden reasoning counts against max_tokens,
    # so "low" leaves room for the script itself. Empty to omit.
    reasoning_effort: str = "low"
    max_note_chars: int = 6000  # research notes sent to the model (free tiers limit tokens/minute)
    # Tried in order when `model` keeps failing (outage, daily token cap). On Groq each
    # model has its own free limits.
    fallback_models: list[str] = Field(default_factory=list)


class WikipediaConfig(BaseModel):
    lang: str = "en"
    # Where to find article ideas. List pages contribute every article they link to.
    list_pages: list[str] = Field(default_factory=lambda: ["Wikipedia:Unusual articles"])
    categories: list[str] = Field(default_factory=list)  # e.g. "Unsolved problems in physics"
    articles: list[str] = Field(default_factory=list)  # specific article titles
    min_chars: int = 3000  # skip stubs
    long_min_chars: int = 15000  # long videos need an article with enough material
    max_chars: int = 40000  # truncate very long articles in the notes


class ScheduleConfig(BaseModel):
    """`fyt fill`: keep the next few days of publish slots filled with videos uploaded
    ahead of time, so a failed or skipped run never costs a publish."""

    # Shorts go live at these UTC times, each at a random minute up to
    # youtube.publish_jitter_minutes later.
    short_slots: list[str] = Field(default_factory=lambda: ["14:00", "22:00"])
    long_weekday: int | None = 5  # the long video's day (Monday = 0); None for no long videos
    long_slot: str = "16:00"  # UTC
    buffer_days: float = 2.0  # how far ahead Shorts are kept scheduled
    long_lead_days: float = 3.0  # the long video is made up to this many days before it goes live
    # The YouTube Data API allows 10,000 units a day and an upload with thumbnail and captions uses ~2,050.
    max_uploads_per_day: int = 4
    max_run_minutes: int = 120  # stop starting new videos after this, so the job never times out


class Config(BaseModel):
    channel: ChannelInfo = Field(default_factory=ChannelInfo)
    format: Literal["long", "short"] = "long"
    target_minutes: float = 6.0  # ignored for shorts (always < 60s)
    model: str = "claude-opus-5"
    llm: LLMConfig = Field(default_factory=LLMConfig)
    # wikipedia: videos are written from niche Wikipedia articles (see `wikipedia`).
    # web: Claude researches each topic with web search first.
    source: Literal["wikipedia", "web"] = "web"
    wikipedia: WikipediaConfig = Field(default_factory=WikipediaConfig)
    research: bool = True  # use Claude's web search before scripting (source: web)
    voice: VoiceConfig = Field(default_factory=VoiceConfig)
    music_dir: str = "assets/music"
    music_volume: float = 0.07
    stock_footage: bool = True  # needs PEXELS_API_KEY
    captions: bool = True
    visualizer: bool = True
    theme: Theme = Field(default_factory=Theme)
    youtube: YouTubeConfig = Field(default_factory=YouTubeConfig)
    schedule: ScheduleConfig = Field(default_factory=ScheduleConfig)
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
