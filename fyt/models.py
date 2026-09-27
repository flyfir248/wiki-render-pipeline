"""Data shapes: what Claude writes (Script) and what the renderer reads (RenderProps)."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

SceneType = Literal["title", "statement", "stat", "bars", "list", "quote", "timeline", "comparison", "broll"]


class DataPoint(BaseModel):
    label: str
    value: float


class TimelineEvent(BaseModel):
    label: str
    text: str


class ScriptScene(BaseModel):
    """One beat of the video: what is said, and what is shown while it is said."""

    narration: str = Field(description="Exact words the narrator speaks for this scene.")
    type: SceneType = Field(description="Visual template used while the narration plays.")
    heading: str | None = Field(default=None, description="Short on-screen heading (max ~8 words).")
    text: str | None = Field(default=None, description="Supporting on-screen line, or the quote text for quote scenes.")
    items: list[str] | None = Field(default=None, description="list scenes: 2-5 short bullet items.")
    value: float | None = Field(default=None, description="stat scenes: the number to count up to.")
    prefix: str | None = Field(default=None, description="stat scenes: e.g. '$'.")
    suffix: str | None = Field(default=None, description="stat scenes: e.g. '%', 'x', 'M'.")
    data: list[DataPoint] | None = Field(default=None, description="bars scenes: 2-7 real data points.")
    events: list[TimelineEvent] | None = Field(default=None, description="timeline scenes: 3-5 dated events.")
    left_title: str | None = None
    left: list[str] | None = Field(default=None, description="comparison scenes: left column bullets.")
    right_title: str | None = None
    right: list[str] | None = Field(default=None, description="comparison scenes: right column bullets.")
    author: str | None = Field(default=None, description="quote scenes: who said it (must be a real, verified quote).")
    image: int | None = Field(
        default=None,
        description="Number of the article image (from the 'Available images' list) to show behind this scene, if one fits what is being said.",
    )
    broll_query: str | None = Field(
        default=None,
        description="2-4 word stock-footage search query for what is being said, concrete and visual "
        "(e.g. 'molasses tank', 'harbor 1919'). Used when no article image fits.",
    )


class Script(BaseModel):
    title: str = Field(description="YouTube title, max 70 characters, curiosity-driven but truthful.")
    description: str = Field(description="YouTube description: 2 short paragraphs, then key points. No hashtag spam.")
    tags: list[str] = Field(description="8-15 search tags.")
    thumbnail_text: str = Field(description="2-5 punchy words for the thumbnail (not the title).")
    thumbnail_kicker: str = Field(description="1-3 word label above the thumbnail text, e.g. the topic.")
    thumbnail_query: str = Field(description="Stock photo search query for the thumbnail background.")
    scenes: list[ScriptScene]
    sources: list[str] = Field(description="URLs or references backing the facts used.")


class Word(BaseModel):
    word: str
    start: float
    end: float


class Media(BaseModel):
    src: str
    kind: Literal["video", "image"]


class RenderScene(BaseModel):
    id: str
    type: SceneType
    start: float
    end: float
    heading: str | None = None
    text: str | None = None
    items: list[str] | None = None
    value: float | None = None
    prefix: str | None = None
    suffix: str | None = None
    data: list[DataPoint] | None = None
    events: list[TimelineEvent] | None = None
    left: list[str] | None = None
    right: list[str] | None = None
    leftTitle: str | None = None
    rightTitle: str | None = None
    author: str | None = None
    media: Media | None = None


class Music(BaseModel):
    src: str
    volume: float


class RenderProps(BaseModel):
    format: Literal["long", "short"]
    fps: int = 30
    title: str
    duration: float
    theme: dict
    voice: str | None
    music: Music | None
    scenes: list[RenderScene]
    captions: list[Word]
    showCaptions: bool
    showVisualizer: bool


class ThumbnailProps(BaseModel):
    format: Literal["long", "short"]
    title: str
    kicker: str
    theme: dict
    background: Media | None
