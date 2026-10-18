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


class CollageConfig(BaseModel):
    """Vox-style collage for real photos (fyt/cutout.py): each photo also becomes a duotone halftone
    print, and its main subject a black-and-white cut-out that lifts off it. Free, runs locally."""

    enabled: bool = True
    paper: str = "#efe6d4"  # the print's light colour; the dark one is theme.background
    model_dir: str = "assets/cutout"


class VisualsConfig(BaseModel):
    """The visual plan every video gets after its facts are checked (fyt/visualplan.py): which moments
    are acted out as 3D reconstructions (the world scene), on top of the scriptwriter's maps and charts."""

    plan: bool = True
    # Seconds of 3D a video may carry, set by render time: measured at concurrency 2, a second of 3D
    # costs about 13 s to render against about 4 s for a 2D scene, so 180 s of 3D adds roughly half an
    # hour to a long video on the free runner, inside the scheduled run's 120-minute fill window.
    # The planner keeps the reconstructions it ranks highest within it. Not a share: a story told in
    # maps and charts may use none, an incident told moment by moment may use all of a Short.
    world_seconds_short: float = 60.0
    world_seconds_long: float = 180.0
    # Each video's own look (fyt/artdirect.py): palette and 3D grade from its subject, era and mood.
    art_direction: bool = True
    # Story-driven 3D (fyt/manifest.py, fyt/assetlib.py): the story's own entities get 3D scenes from
    # models found or made for them, never a renderer's stock subject the story doesn't name.
    story_assets: bool = True
    # Where models are looked for, in order, after the project library and the model cache:
    # sketchfab: Sketchfab's search, downloaded from the Objaverse mirror (no key) or with SKETCHFAB_TOKEN;
    # polypizza: Poly Pizza's CC0 / CC-BY low-poly library (POLY_PIZZA_KEY, free);
    # image_to_3d: only when no library has the thing, a concept picture of it is drawn, checked by eye
    # and made 3D on a GPU (never on the Actions runner): the worker at `image_to_3d_url` if set (any host
    # running TRELLIS.2 or Hunyuan3D; see fyt.assetlib._from_worker), else the Hugging Face Space at
    # `image_to_3d_space` (free ZeroGPU minutes with HF_TOKEN). Both empty leaves generation out.
    asset_sources: list[str] = ["sketchfab", "polypizza", "image_to_3d"]
    image_to_3d_url: str = ""
    image_to_3d_space: str = ""  # e.g. "microsoft/TRELLIS.2"
    max_generated: int = 2  # new models generated per video at most; each is cached and reused after
    licences: list[str] = ["cc0", "by", "by-sa"]  # free to use commercially, with credit for by / by-sa
    max_model_mb: float = 12.0
    # Triangle budget by how close the camera gets: a close-up needs the detail, a wide shot doesn't.
    triangles: dict[str, int] = {"close": 80000, "medium": 40000, "wide": 15000}

    def world_seconds(self, fmt: str) -> float:
        return self.world_seconds_short if fmt == "short" else self.world_seconds_long


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
    kokoro_short_speed: float = 1.15  # Shorts are read faster: viewers swipe away from a slow start
    kokoro_lang: str = "en-us"
    kokoro_sentence_pause: float = 0.12
    kokoro_dir: str = "assets/kokoro"
    espeak_voice: str = "en-us"
    espeak_wpm: int = 165
    gap_seconds: float = 0.3  # pause between scenes
    short_gap_seconds: float = 0.08  # in Shorts, scenes run straight into each other

    def speed(self, fmt: str) -> float:
        return self.kokoro_short_speed if fmt == "short" else self.kokoro_speed

    def gap(self, fmt: str) -> float:
        return self.short_gap_seconds if fmt == "short" else self.gap_seconds


class YouTubeConfig(BaseModel):
    privacy: Literal["private", "unlisted", "public"] = "private"
    category_id: str = "27"  # Education
    made_for_kids: bool = False
    # YouTube's "altered or synthetic content" label. Required for realistic footage of people or
    # events that didn't happen, a cloned real voice, or AI-generated music; not for a narrator voice
    # over real photos and motion graphics, which is what this pipeline makes.
    contains_synthetic_media: bool = False
    # Hours from upload to scheduled publish; forces privacy=private until then.
    publish_delay_hours: float | None = None
    # Adds a random 0..N minute delay on top, so videos don't go live at the exact
    # same minute every day. Also schedules the publish when publish_delay_hours is unset.
    publish_jitter_minutes: int = 0
    upload_captions: bool = True
    # Titles and descriptions also in these languages (codes like es, pt, hi), so viewers and
    # searches in those languages see them in their own language. The narration stays as is.
    localize: list[str] = Field(default_factory=list)


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


class GrowthConfig(BaseModel):
    polish: bool = True  # second pass on title, hook and thumbnail text (plus a loop line for Shorts)
    rank_topics: bool = True  # pick articles by fit with the niche and Wikipedia pageviews
    min_topic_fit: int = 6  # 0-10; articles the model rates lower are skipped
    # Every scene gets a real photo: a spare article image, a Wikimedia Commons photo, or a stock photo.
    # Charts and numbers sit on top of it, darkened. Off: data scenes keep the plain background.
    visuals_every_scene: bool = True
    # Shorts cut to a new shot about this often (seconds): a scene's photo is followed by more
    # photos of the subject, or re-framed when there are none. 0 keeps one shot per scene.
    shot_seconds: float = 2.5
    # The channel asks each video's question as the first comment once the video is public (needs the
    # full YouTube permission; 50 quota units each).
    first_comment: bool = True
    # Share of Shorts told as a two-part story: part 1 ends on a cliffhanger and part 2 fills the next
    # Short slot, so viewers who want the ending follow the channel. Only for articles with enough material.
    two_part_share: float = 0.25
    two_part_min_chars: int = 8000
    cuts_per_long: int = 2  # Shorts cut from each long video (they fill regular Short slots)
    series: list[str] = Field(default_factory=list)  # playlists; each video is filed under one
    # Extra videos on topics trending on Wikipedia that fit the niche, on top of the schedule.
    bonus_shorts_per_day: int = 1
    bonus_longs_per_week: int = 1
    bonus_min_fit: int = 7  # 0-10
    bonus_long_min_fit: int = 9
    # A weekly long explainer on a recent news incident (from Wikipedia's "In the news" and most-read
    # articles, at least a day old), on top of the schedule, when one is strong enough.
    news_longs_per_week: int = 1
    news_min_fit: int = 8
    news_min_chars: int = 6000
    news_series: str = "News Explained"  # the playlist news explainers go in ("" for none)
    # Turning viewers into subscribers. The series name shown small at the top of every video, so a
    # viewer sees each one is part of a collection.
    series_badge: bool = True
    # Why to subscribe, in a few words: shown over a Short's last seconds (on screen only, so the loop
    # stays seamless), on the long video's end card, and as a one-click subscribe link at the top of
    # each description. Empty for none.
    subscribe_line: str = ""
    # Seconds a long video holds an end card after the narration, the space YouTube's end screen
    # (subscribe button, next video) covers. Add the end screen in YouTube Studio. 0 for none.
    end_card_seconds: float = 0.0


class InstagramConfig(BaseModel):
    """Shorts cross-posted as Instagram Reels, to bring Instagram viewers to the YouTube channel
    (fyt/instagram.py)."""

    # Write instagram.txt (the Reel's caption) next to every Short, and queue the Short to go up as a Reel.
    enabled: bool = False
    # Post each queued Short as a Reel once it is public on YouTube (`fyt reels`, run by the workflow).
    # Needs the INSTAGRAM_TOKEN and INSTAGRAM_USER_ID secrets (`fyt ig-token` makes them).
    publish: bool = False
    # The YouTube channel's handle (e.g. @FacelessYT), named in every caption's call to action.
    # Links in Instagram captions can't be tapped, so the caption points to the link in the bio.
    youtube_handle: str = ""
    cta: str = "Full story, and a new one every day, on YouTube. Link in bio"
    hashtags: list[str] = Field(default_factory=list)  # in every caption, before the video's own
    max_hashtags: int = 5  # Instagram takes at most 5 per post (from December 2025)
    share_to_feed: bool = True  # also show the Reel in the profile grid and followers' feed
    cover_seconds: float = 1.0  # the frame used as the Reel's cover
    max_per_run: int = 3
    # Shorts that went public longer ago than this aren't posted, so turning `publish` on doesn't
    # post a backlog all at once.
    max_age_hours: float = 48
    api_version: str = "v26.0"


class Config(BaseModel):
    channel: ChannelInfo = Field(default_factory=ChannelInfo)
    format: Literal["long", "short"] = "long"
    target_minutes: float = 6.0  # ignored for shorts (always < 60s)
    # Long videos are written to run at least this long. YouTube shows mid-roll ads only in
    # videos of 8 minutes or more. 0 for no minimum.
    long_min_minutes: float = 8.0
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
    generate_music: bool = True  # compose an original background track when music_dir has none
    # Check every figure, date, name and quote in a new script against the source before it is voiced;
    # a script with claims that stay wrong after one fix is not made (fyt/factcheck.py).
    fact_check: bool = True
    visuals: VisualsConfig = Field(default_factory=VisualsConfig)
    sound_effects: bool = True  # whooshes, pops and booms timed to the animation (fyt/sfx.py)
    sfx_volume: float = 0.3  # relative to the narrator at 1.0
    stock_footage: bool = True  # needs PEXELS_API_KEY
    # AI illustrations for story scenes in the flat house style (fyt/artgen.py); needs
    # CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN or TOGETHER_API_KEY, else emoji-style props.
    story_art: bool = True
    # An illustration for every later sentence of titles, statements, numbers and quotes, planned by
    # a storyboard pass with a cast sheet (fyt/storyboard.py). Uses the same image keys as story_art.
    storyboard: bool = True
    # Free vision model that checks each storyboard picture before it is used. "auto": the first
    # image-reading model the OpenAI-compatible provider (Groq) lists, else Cloudflare's with the image
    # keys. A model id to pin one; empty to skip the check.
    review_model: str = "auto"
    collage: CollageConfig = Field(default_factory=CollageConfig)
    captions: bool = True
    visualizer: bool = True
    theme: Theme = Field(default_factory=Theme)
    youtube: YouTubeConfig = Field(default_factory=YouTubeConfig)
    schedule: ScheduleConfig = Field(default_factory=ScheduleConfig)
    growth: GrowthConfig = Field(default_factory=GrowthConfig)
    instagram: InstagramConfig = Field(default_factory=InstagramConfig)
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
    value = (os.environ.get(name) or "").strip()  # a pasted secret often ends in a newline
    return value or None
