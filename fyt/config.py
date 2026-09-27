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
    max_note_chars: int = 12000  # research notes sent to the model (free tiers limit tokens/minute)


class WikipediaConfig(BaseModel):
    lang: str = "en"
    # Where to find article ideas. List pages contribute every article they link to.
    list_pages: list[str] = Field(default_factory=lambda: ["Wikipedia:Unusual articles"])
    categories: list[str] = Field(default_factory=list)  # e.g. "Unsolved problems in physics"
    articles: list[str] = Field(default_factory=list)  # specific article titles
    min_chars: int = 3000  # skip stubs
    max_chars: int = 40000  # truncate very long articles in the notes


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
