"""Data shapes: what Claude writes (Script) and what the renderer reads (RenderProps)."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field
from pydantic.json_schema import SkipJsonSchema

SceneType = Literal[
    "title", "statement", "stat", "bars", "list", "quote", "timeline", "comparison", "broll",
    "map", "process", "document", "dialogue", "story",
]
# How the camera moves over a scene's photo, and how the scene enters. The renderer picks when unset.
Camera = Literal["push_in", "pull_out", "pan_left", "pan_right", "parallax"]
Transition = Literal["fade", "slide", "zoom", "wipe", "flash"]
# Feel of the background music, chosen from the story (see fyt.music).
Mood = Literal["somber", "tense", "curious", "uplifting", "playful"]
MOOD_HELP = (
    "Music mood that respects the story: somber for death, disaster, war, illness or other tragedy; "
    "tense for danger, mystery or a race against time; curious for strange facts and discoveries; "
    "uplifting for triumph, rescue or kindness; playful only for light, harmless fun."
)


class DataPoint(BaseModel):
    label: str
    value: float


class TimelineEvent(BaseModel):
    label: str
    text: str


class Place(BaseModel):
    name: str = Field(description="Short label shown on the map, e.g. 'Lahore'.")
    lat: float = Field(description="Latitude in degrees (north positive).")
    lon: float = Field(description="Longitude in degrees (east positive).")


class DialogueLine(BaseModel):
    speaker: str = Field(description="Who said it, e.g. 'Captain' or 'Control tower'.")
    text: str = Field(description="Their exact recorded words, short.")


Setting = Literal["sky", "night", "space", "sea", "city", "countryside", "desert", "snow", "room", "road"]
Effect = Literal["explosion", "fire", "smoke", "lightning", "sparkles", "rain", "snow"]


class Actor(BaseModel):
    """One illustrated thing on a story scene's stage."""

    thing: str = Field(description="A plain, concrete noun drawn as a flat illustration: 'airplane', 'police car', "
                       "'woman', 'rocket', 'house', 'ship', 'money bag', 'skull', 'dog', 'scientist'.")
    x: float = Field(default=50, description="Horizontal position, 0 (left) to 100 (right).")
    y: float = Field(default=50, description="Vertical position, 0 (top) to 100 (ground).")
    size: Literal["s", "m", "l"] = "m"
    to_x: float | None = Field(default=None, description="Where it moves to during the scene (0-100), if it moves.")
    to_y: float | None = None
    enter: Literal["pop", "slide_left", "slide_right", "drop", "rise", "fade"] = "pop"
    action: Literal["none", "shake", "pulse", "spin", "bob", "blink", "fall"] = "none"
    at: float = Field(default=0, description="When it appears, 0 (scene start) to 0.8.")
    label: str | None = Field(default=None, description="Optional 1-3 word tag under it, e.g. a name.")
    look: str | None = Field(
        default=None,
        description="How it should be drawn, in 4-12 words: 'a 1970s white space capsule with a scorched side', "
        "'a pilot in a navy uniform'. Describe people by role and clothing, never as a named real person.",
    )
    src: SkipJsonSchema[str | None] = None  # illustration file, set by the pipeline


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
    author: str | None = Field(
        default=None,
        description="quote scenes: who said it (must be a real, verified quote). document scenes: source and date.",
    )
    places: list[Place] | None = Field(default=None, description="map scenes: 1-4 real places, in the order of travel.")
    route: bool | None = Field(default=None, description="map scenes: draw a route through the places in order.")
    lines: list[DialogueLine] | None = Field(
        default=None, description="dialogue scenes: 2-4 lines of a real recorded exchange, in order."
    )
    setting: Setting | None = Field(default=None, description="story scenes: the kind of place.")
    backdrop: str | None = Field(
        default=None,
        description="story scenes: the place to draw behind the action, in 6-15 words: 'mission control room "
        "with rows of consoles, 1970', 'calm Pacific ocean at dawn'. No people in it.",
    )
    backdrop_src: SkipJsonSchema[str | None] = None  # set by the pipeline
    actors: list[Actor] | None = Field(default=None, description="story scenes: 1-5 things on the stage.")
    effect: Effect | None = Field(default=None, description="story scenes: an optional effect.")
    effect_x: float | None = Field(default=None, description="story scenes: where the effect happens (0-100).")
    effect_y: float | None = None
    effect_at: float | None = Field(default=None, description="story scenes: when the effect happens (0-1).")
    effect_src: SkipJsonSchema[str | None] = None  # set by the pipeline
    camera: Camera | None = Field(default=None, description="Optional camera move over this scene's photo.")
    transition: Transition | None = Field(default=None, description="Optional way this scene enters.")
    image: int | None = Field(
        default=None,
        description="Number of the article image (from the 'Available images' list) to show behind this scene, if one fits what is being said.",
    )
    broll_query: str | None = Field(
        default=None,
        description="2-4 word stock-footage search query for what is being said, concrete and visual "
        "(e.g. 'molasses tank', 'harbor 1919'). Used when no article image fits.",
    )


class Chapter(BaseModel):
    title: str
    scene: int  # index of the scene the chapter starts on


class Script(BaseModel):
    core_message: str = Field(
        default="",
        description="Write this first: the one sentence the viewer should remember, max 20 words. Every scene serves it.",
    )
    mood: Mood = Field(default="curious", description=MOOD_HELP)
    title: str = Field(description="YouTube title, max 70 characters, curiosity-driven but truthful.")
    description: str = Field(description="YouTube description: 2 short paragraphs, then key points. No hashtag spam.")
    tags: list[str] = Field(description="8-15 search tags.")
    thumbnail_text: str = Field(description="2-5 punchy words for the thumbnail (not the title).")
    thumbnail_kicker: str = Field(description="1-3 word label above the thumbnail text, e.g. the topic.")
    thumbnail_query: str = Field(description="Stock photo search query for the thumbnail background.")
    scenes: list[ScriptScene]
    sources: list[str] = Field(description="URLs or references backing the facts used.")
    comment_question: str = Field(
        default="",
        description="A question the channel posts as the first comment to start a conversation: specific to this "
        "story, easy to answer in a few words, max 15 words. E.g. 'Would you have sat in front of it?'",
    )
    # Set by the pipeline for long videos written chapter by chapter; not asked of the model.
    chapters: SkipJsonSchema[list[Chapter] | None] = None
    series: SkipJsonSchema[str | None] = None  # playlist the video is filed under


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
    places: list[Place] | None = None
    route: bool | None = None
    lines: list[DialogueLine] | None = None
    setting: Setting | None = None
    backdropSrc: str | None = None
    actors: list[Actor] | None = None
    effect: Effect | None = None
    effectX: float | None = None
    effectY: float | None = None
    effectAt: float | None = None
    effectSrc: str | None = None
    camera: Camera | None = None
    transition: Transition | None = None


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
