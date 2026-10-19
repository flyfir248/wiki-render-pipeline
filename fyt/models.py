"""Data shapes: what Claude writes (Script) and what the renderer reads (RenderProps)."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field
from pydantic.json_schema import SkipJsonSchema

from fyt import scenes3d

SceneType = Literal[
    "title", "statement", "stat", "bars", "list", "quote", "timeline", "comparison", "broll",
    "map", "process", "document", "dialogue", "story", "evidence", "trend", "proportion", "scale", "cycle",
    "aircraft", "ship", "world",
]
# Scenes that draw their whole picture themselves, so no photo is fetched for them. Code-drawn charts
# (trend, proportion, scale, cycle) do take one: it sits dim and soft far behind the chart.
DRAWN = ("map", "story", "aircraft", "ship", "world")
# How the camera moves over a scene's photo, and how the scene enters. The renderer picks when unset.
Camera = Literal["push_in", "pull_out", "pan_left", "pan_right", "parallax"]
Transition = Literal["fade", "slide", "zoom", "wipe", "flash", "thread", "whip"]
# Feel of the background music, chosen from the story (see fyt.music).
# What travels along a map route: a plane, ship, car or train icon, a walker, or an army's campaign arrow.
Vehicle = Literal["plane", "ship", "car", "train", "walk", "army"]
# How the highlighted regions of a map change: they appear, spread out from their middle, shrink away or fade.
RegionChange = Literal["appear", "spread", "shrink", "fade"]
# What an aircraft scene's airliner does, and where its camera sits.
Maneuver = Literal["cruise", "climb", "descend", "dive", "turn", "takeoff", "land", "go_around"]
Shot = Literal["chase", "side", "front", "below", "orbit", "wide"]
# What a ship scene's vessel is, what it does and what it hits, and the weather of the 3D scenes.
Vessel = Literal["liner", "cargo", "tanker", "sailing", "warship", "submarine"]
ShipAction = Literal["sail", "turn", "list", "sink", "capsize", "collide", "dive", "surface"]
# The world scene's subjects, variants, actions and obstacles come from the 3D scene catalog
# (renderer/src/scenes/world/catalog.json, see fyt.scenes3d), so a new module needs no change here.
Subject = Literal[scenes3d.SUBJECTS]  # type: ignore[valid-type]
Variant = Literal[scenes3d.VARIANTS]  # type: ignore[valid-type]
Action3D = Literal[scenes3d.ACTIONS]  # type: ignore[valid-type]
Obstacle = Literal[scenes3d.OBSTACLES]  # type: ignore[valid-type]
Weather = Literal[scenes3d.WEATHERS]  # type: ignore[valid-type]
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
    purpose: str | None = Field(
        default=None, description="What the viewer must understand from this scene, max 15 words: 'the iceberg tore a long gash below the waterline'."
    )
    type: SceneType = Field(description="Visual template used while the narration plays.")
    heading: str | None = Field(default=None, description="Short on-screen heading (max ~8 words).")
    text: str | None = Field(default=None, description="Supporting on-screen line, or the quote text for quote scenes.")
    items: list[str] | None = Field(default=None, description="list scenes: 2-5 short bullet items. cycle scenes: 3-5 steps of the loop.")
    value: float | None = Field(
        default=None, description="stat scenes: the number to count up to. proportion scenes: the share as a percentage (0-100)."
    )
    prefix: str | None = Field(default=None, description="stat scenes: e.g. '$'.")
    suffix: str | None = Field(default=None, description="stat scenes: e.g. '%', 'x', 'M'.")
    data: list[DataPoint] | None = Field(
        default=None,
        description="bars scenes: 2-7 real data points. trend scenes: 3-10 points in time order (label = year). "
        "scale scenes: 2-5 things to compare by size (label = the thing).",
    )
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
    vehicle: Vehicle | None = Field(
        default=None, description="map scenes with a route: what travels it; the camera follows it over a tilted map."
    )
    regions: list[str] | None = Field(
        default=None, description="map scenes: 1-6 present-day country names to highlight (an empire, an alliance, a spread)."
    )
    region_change: RegionChange | None = Field(default=None, description="map scenes: how the regions change.")
    year_from: int | None = Field(default=None, description="map scenes: a year counter starts here (negative for BC).")
    year_to: int | None = Field(default=None, description="map scenes: and counts to this year.")
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
    subject: Subject | None = Field(default=None, description="world scenes: what is shown (see the subjects list).")
    variant: Variant | None = Field(default=None, description="world scenes: which kind of that subject.")
    action: Action3D | None = Field(default=None, description="world scenes: what it does (one of the subject's actions).")
    obstacle: Obstacle | None = Field(default=None, description="world scenes: what it hits, meets or circles.")
    shot: Shot | None = Field(default=None, description="world scenes: where the camera watches from.")
    weather: Weather | None = Field(default=None, description="world scenes: the weather, only when the narration says so.")
    cue: str | None = Field(default=None, description="world scenes: the exact words of the narration at which the key moment happens.")
    subject_name: str | None = Field(default=None, description="world scenes: a short name for the thing shown, the same in every scene that shows it.")
    altitude_from: float | None = Field(default=None, description="world aircraft scenes: altitude readout start, in feet (documented figures only).")
    altitude_to: float | None = Field(default=None, description="world aircraft scenes: altitude readout end, in feet.")
    illustrative: SkipJsonSchema[bool | None] = None  # set by fyt.scenes3d.guard
    model: SkipJsonSchema[dict | None] = None  # set by fyt.assets.resolve: which model, from where
    label: SkipJsonSchema[str | None] = None  # set by fyt.assets.resolve: RECONSTRUCTION, ILLUSTRATION...
    fallback: SkipJsonSchema[dict | None] = None  # set by fyt.visualplan: the scene before it became 3D
    world: SkipJsonSchema[dict | None] = None  # set by fyt.worldgen: a stage scene's generated cast, set and direction
    # Written by scripts from before the world scene; fyt.scenes3d turns them into world scenes.
    maneuver: SkipJsonSchema[Maneuver | None] = None
    vessel: SkipJsonSchema[Vessel | None] = None
    ship_action: SkipJsonSchema[ShipAction | None] = None
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
    styled: str | None = None  # images: the photo as a halftone print (fyt/cutout.py)
    cutout: str | None = None  # images: its main subject cut out, same size, transparent elsewhere
    aspect: float | None = None  # images with a print: width / height


class RenderBeat(BaseModel):
    at: float  # seconds from the scene's start: when the sentence it illustrates begins
    src: str  # illustration in the job's public dir


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
    shots: list[Media] | None = None  # more photos to cut to after `media`
    beats: list[RenderBeat] | None = None  # an illustration per later sentence (fyt.storyboard)
    places: list[Place] | None = None
    route: bool | None = None
    vehicle: Vehicle | None = None
    regions: list[str] | None = None
    regionChange: RegionChange | None = None
    yearFrom: int | None = None
    yearTo: int | None = None
    globe: bool | None = None  # open on a spinning globe that dives in (the video's first map)
    lines: list[DialogueLine] | None = None
    setting: Setting | None = None
    backdropSrc: str | None = None
    world: dict | None = None  # a stage scene's generated story world (fyt/worldgen.py)
    actors: list[Actor] | None = None
    effect: Effect | None = None
    effectX: float | None = None
    effectY: float | None = None
    effectAt: float | None = None
    effectSrc: str | None = None
    revealTimes: list[float] | None = None  # evidence clues, document [hidden] words, scale items, cycle steps: when said
    maneuver: Maneuver | None = None
    shot: Shot | None = None
    altitudeFrom: float | None = None
    altitudeTo: float | None = None
    vessel: Vessel | None = None
    shipAction: ShipAction | None = None
    obstacle: Obstacle | None = None
    weather: Weather | None = None
    subject: Subject | None = None
    variant: Variant | None = None
    action: Action3D | None = None
    subjectName: str | None = None
    illustrative: bool | None = None
    model: dict | None = None  # world scenes: the resolved model (fyt.assets): spec params, or a library glTF
    label: str | None = None  # world scenes: the on-screen label
    seed: int | None = None  # 3D scenes: the video's seed (from its title), so no two videos share a sky or livery
    landTimes: list[float] | None = None  # stat and proportion figures, trend points: when the narrator says them
    camera: Camera | None = None
    transition: Transition | None = None


class Music(BaseModel):
    src: str
    volume: float


class Sfx(BaseModel):
    dir: str  # folder of <name>.wav files in the job (see fyt.sfx.NAMES)
    volume: float


class RenderProps(BaseModel):
    format: Literal["long", "short"]
    fps: int = 30
    title: str
    duration: float
    theme: dict
    voice: str | None
    music: Music | None
    sfx: Sfx | None = None
    scenes: list[RenderScene]
    captions: list[Word]
    showCaptions: bool
    showVisualizer: bool
    badge: str | None = None  # the series name, shown small at the top the whole video
    subscribe: str | None = None  # shown at the end: over a Short's last seconds, on a long video's end card
    endCard: float = 0  # seconds at the end of a long video held for YouTube's end screen


class ThumbnailProps(BaseModel):
    format: Literal["long", "short"]
    title: str
    kicker: str = ""  # a small label above the words; empty for the current takes (fyt/thumbs.py)
    theme: dict
    background: Media | None
    subject: Media | None = None  # the subject cut out, drawn big over the background
