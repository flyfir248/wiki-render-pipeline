"""Story worlds: every 3D stage scene gets characters, creatures, objects and places generated for this
story, in one consistent style, rather than picked from a finished library.

fyt.manifest lists what the story shows (a black bear, a Cessna, a park ranger, a forest). This module
turns that into a per-video design and per-scene direction, which the renderer's generators
(renderer/src/scenes/world/storyworld/) build from scratch every time:

1. design: one build per entity and one setting per place. A build is a parametric body (a humanoid's
   age, build, outfit and hair; an animal's proportions, ears, tail, horns and coat) plus up to
   MAX_PARTS primitive parts: accessories pinned to a bone (a ranger's hat, a duffel bag in a hand), or
   the whole shape of a thing no body plan fits (a bag of cocaine bricks, a Cessna 404, a cell tower).
   A setting is a kind of place (forest, river, room, micro...), its time of day, its colours, and
   set dressing that is itself built from parts (the story's own kind of tree, a picnic table).
2. direct: for each 3D scene, who is in it, what each one does (a verb from the archetype's grammar),
   where they stand and face, how the camera films it, and the overlays (a glowing beam, a range dome,
   a label pinned to an actor).

Both come from one model call each; when a call fails, rules read the same manifest (the entity's
kind and look words), so every scene still gets a story-specific build. Nothing is cached between
videos: the next story designs its own cast. Found models (fyt.assetlib) still draw non-living things
when one genuinely matches; people and animals are always generated, because a found mesh has no rig
our verbs can drive.

The guards keep the world true to the narration: an entity is shown only in scenes the manifest lists
it in; an actor does something beyond a calm verb (idle, walk, look around...) only when the scene's
moment is documented and the verb's words are in the narration; a state (injured, dazed, damaged) only
when the narration says so; a label only with words from the narration or the entity's own name. One
build per entity for the whole video keeps it recognisable from scene to scene.

The renderer's grammar (grammar.json) is the single source for verbs, set kinds, styles and marks.
"""

from __future__ import annotations

import json
import math
import re
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field

from fyt import llm, manifest, scenes3d
from fyt.config import Config
from fyt.manifest import Entity, Manifest
from fyt.models import Script

GRAMMAR_PATH = Path(__file__).resolve().parent.parent / "renderer" / "src" / "scenes" / "world" / "storyworld" / "grammar.json"
MAX_PARTS = 24
LIVING = ("humanoid", "quadruped", "bird", "fish", "insect", "serpent")


@lru_cache(maxsize=1)
def grammar() -> dict:
    return json.loads(GRAMMAR_PATH.read_text())


G = grammar()
Style = Literal[tuple(G["styles"])]  # type: ignore[valid-type]
Archetype = Literal[tuple(G["archetypes"])]  # type: ignore[valid-type]
Verb = Literal[tuple(dict.fromkeys(v for a in G["archetypes"].values() for v in a["verbs"]))]  # type: ignore[valid-type]
SetKind = Literal[tuple(G["sets"])]  # type: ignore[valid-type]
Shape = Literal[tuple(G["shapes"])]  # type: ignore[valid-type]
Bone = Literal[tuple(G["bones"])]  # type: ignore[valid-type]
Move = Literal[tuple(G["camera"])]  # type: ignore[valid-type]
MarkKind = Literal[tuple(G["marks"])]  # type: ignore[valid-type]
Spot = Literal[tuple(G["places"])]  # type: ignore[valid-type]
State = Literal[tuple(G["states"])]  # type: ignore[valid-type]
Time = Literal["dawn", "day", "dusk", "night"]
HEX = re.compile(r"^#[0-9a-fA-F]{6}$")


class Part(BaseModel):
    shape: Shape
    at: list[float] = Field(description="[x, y, z] centre in metres; x forward, y up, z to the side; y = 0 is the ground.")
    size: list[float] = Field(description="[x, y, z] in metres, in the part's own frame before rot: a cylinder, cone or capsule runs along its own y (diameter x, length y), so a horizontal fuselage is size [d, length, d] with rot [0, 0, 90].")
    rot: list[float] = Field(default_factory=lambda: [0.0, 0.0, 0.0], description="[x, y, z] rotation in degrees.")
    color: str = Field(description="#rrggbb")
    bone: Bone = Field(default="body", description="What it is fixed to; at is then relative to that bone. body for a whole object.")
    spin: Literal["", "x", "y", "z"] = Field(default="", description="Spins about this axis while moving (a wheel, a propeller).")
    glow: bool = False


class Body(BaseModel):
    build: float = Field(default=0.5, description="0 slim to 1 heavy.")
    legs: float = Field(default=0.5, description="0 short to 1 long legs.")
    neck: float = Field(default=0.3, description="0 none to 1 long (a giraffe).")
    head: float = Field(default=0.5, description="0 small to 1 big head.")
    snout: float = Field(default=0.4, description="Animals: 0 flat face to 1 long muzzle or beak.")
    ears: Literal["none", "round", "pointed", "long", "floppy"] = "round"
    tail: Literal["none", "short", "long", "bushy", "fin"] = "short"
    horns: Literal["none", "antlers", "horns", "tusks", "mane", "crest"] = "none"
    pattern: Literal["plain", "spots", "stripes", "belly", "patches"] = "plain"
    age: Literal["child", "adult", "elder"] = "adult"


class Outfit(BaseModel):
    top: Literal["tshirt", "shirt", "jacket", "coat", "uniform", "dress", "robe", "suit", "hoodie", "vest", "scrubs", "labcoat", "spacesuit", "armour", "none"] = "shirt"
    bottom: Literal["trousers", "shorts", "skirt", "none"] = "trousers"
    hair: Literal["short", "long", "bun", "ponytail", "bald", "curly", "cap", "helmet", "hat", "hood", "scarf"] = "short"
    beard: bool = False
    glasses: bool = False


class Build(BaseModel):
    entity: str = Field(description="The manifest entity id this builds.")
    archetype: Archetype
    size: float = Field(description="Metres: height of a person, structure or plant; length of an animal, vehicle or object.")
    primary: str = Field(description="#rrggbb main colour (clothes, fur, paint).")
    secondary: str = Field(description="#rrggbb second colour (trousers, belly, trim).")
    accent: str = Field(description="#rrggbb a small detail colour.")
    skin: str = Field(default="", description="#rrggbb humans only.")
    hair: str = Field(default="", description="#rrggbb humans only.")
    body: Body = Field(default_factory=Body)
    outfit: Outfit | None = Field(default=None, description="Humans only.")
    parts: list[Part] = Field(default_factory=list, description=f"0-{MAX_PARTS} primitives: accessories on living things, the whole shape of anything else.")


class Dressing(BaseModel):
    name: str = Field(description="What it is, e.g. 'loblolly pine', 'picnic table', 'police car'.")
    build: Build = Field(description="Its shape (archetype object, plant, structure or vehicle), built from parts.")
    count: int = Field(default=6, description="1-40 copies scattered round the set.")
    spread: float = Field(default=14.0, description="Metres from the centre they are scattered over.")


class Setting(BaseModel):
    place: str = Field(description="The manifest place id.")
    kind: SetKind
    time: Time = "day"
    ground: str = Field(description="#rrggbb")
    sky: str = Field(description="#rrggbb")
    accent: str = Field(description="#rrggbb a light or glow colour.")
    backdrop: Literal["hills", "mountains", "city", "none"] = Field(default="hills", description="What rings the horizon outdoors.")
    dressing: list[Dressing] = Field(default_factory=list, description="0-4 kinds of thing that make this place this place.")


class Cast(BaseModel):
    style: Style
    builds: list[Build]


class Sets(BaseModel):
    settings: list[Setting]


class Actor(BaseModel):
    entity: str
    verb: Verb
    at: Spot = "center"
    to: Spot | Literal[""] = Field(default="", description="Where it moves to, for a verb that moves; empty to stay.")
    face: str = Field(default="", description="An entity id it turns to, 'camera', or empty.")
    state: State = "normal"
    holding: str = Field(default="", description="The id of an object entity it holds, or empty.")
    count: int = Field(default=1, description="How many are shown together: 1, or 2-9 for a flock, crowd, herd or fleet the story names.")


class Mark(BaseModel):
    kind: MarkKind
    on: str = Field(description="The entity id it starts from or surrounds.")
    to: str = Field(default="", description="For beam or arrow: the entity id it points at.")
    color: str = Field(default="", description="#rrggbb, or empty for the style's own.")


class Callout(BaseModel):
    on: str = Field(description="The entity id the label is pinned to.")
    text: str = Field(description="1-4 words from the narration or the entity's name.")


class Shot(BaseModel):
    scene: int
    place: str = Field(default="", description="The place id, or empty.")
    time: Time | Literal[""] = ""
    actors: list[Actor] = Field(description="1-5: the scene's main entity first.")
    camera: Move
    on: str = Field(default="", description="The entity the camera frames; the first actor when empty.")
    marks: list[Mark] = Field(default_factory=list, description="0-3")
    callouts: list[Callout] = Field(default_factory=list, description="0-2")


class Direction(BaseModel):
    shots: list[Shot]


# --- reading words ---------------------------------------------------------------------------------

KIND_WORDS: list[tuple[str, tuple[str, ...]]] = [
    ("cell", ("cell", "cells", "virus", "bacteri", "microbe", "platelet", "neuron", "organ", "heart", "lung", "liver", "kidney", "brain",
              "tumour", "tumor", "molecule", "protein", "antibod", "blood", "tissue", "skin cell", "sperm", "egg cell", "parasite")),
    ("humanoid", ("person", "people", "man", "woman", "men", "women", "boy", "girl", "child", "kid", "ranger", "pilot", "smuggler",
                  "doctor", "nurse", "surgeon", "patient", "passenger", "soldier", "sailor", "worker", "crew", "officer", "police",
                  "scientist", "hiker", "hunter", "farmer", "driver", "captain", "dealer", "agent", "detective", "teenager", "student",
                  "teacher", "king", "queen", "monk", "priest", "explorer", "astronaut", "fisherman", "miner", "firefighter", "medic",
                  "paramedic", "victim", "witness", "investigator", "engineer", "guard", "prisoner", "diver", "climber", "tourist", "human")),
    ("bird", ("bird", "goose", "geese", "eagle", "owl", "pigeon", "parrot", "duck", "chicken", "crow", "raven", "gull", "hawk",
              "falcon", "penguin", "swan", "heron", "vulture", "ostrich", "flamingo", "sparrow", "pelican", "albatross", "bat")),
    ("fish", ("fish", "shark", "whale", "dolphin", "salmon", "tuna", "cod", "orca", "seal", "manatee", "ray", "carp", "trout", "squid", "octopus")),
    ("serpent", ("snake", "serpent", "python", "cobra", "viper", "worm", "eel", "leech", "boa", "anaconda")),
    ("insect", ("insect", "ant", "bee", "wasp", "beetle", "spider", "mosquito", "tick", "fly", "flies", "moth", "butterfly", "locust",
                "termite", "cockroach", "flea", "scorpion", "tardigrade", "crab", "lobster")),
    ("quadruped", ("bear", "dog", "cat", "horse", "cow", "deer", "wolf", "fox", "lion", "tiger", "elephant", "pig", "sheep", "goat",
                   "rabbit", "mouse", "rat", "camel", "giraffe", "bull", "boar", "moose", "elk", "buffalo", "bison", "leopard",
                   "cheetah", "hyena", "monkey", "ape", "gorilla", "chimp", "kangaroo", "raccoon", "squirrel", "badger", "otter",
                   "hippo", "rhino", "zebra", "donkey", "mule", "llama", "panda", "koala", "dinosaur", "crocodile", "alligator",
                   "lizard", "tortoise", "turtle", "frog", "animal", "mammal", "cub", "puppy", "calf", "beast")),
    ("vehicle", ("airbus", "boeing", "car", "truck", "lorry", "van", "plane", "aircraft", "airplane", "aeroplane", "jet", "airliner", "cessna", "helicopter",
                 "boat", "ship", "ferry", "yacht", "canoe", "kayak", "train", "locomotive", "bus", "bike", "bicycle", "motorcycle",
                 "tractor", "submarine", "rocket", "ambulance", "taxi", "jeep", "suv", "tank", "tram", "glider", "balloon", "raft",
                 "vessel", "tug", "trawler", "sled", "carriage", "wagon", "cart", "drone", "spacecraft", "vehicle")),
    ("plant", ("tree", "flower", "plant", "mushroom", "fungus", "cactus", "crop", "bush", "shrub", "vine", "grass", "seaweed", "algae", "moss")),
    ("structure", ("building", "house", "tower", "bridge", "lighthouse", "church", "castle", "cabin", "hospital", "factory", "wall",
                   "dam", "tent", "barn", "hut", "temple", "pyramid", "station", "mill", "warehouse", "shed", "monument", "mine",
                   "tunnel", "fort", "prison", "school", "shop", "store", "skyscraper", "hangar", "well", "statue", "mast")),
]

COLOURS = {
    "black": "#22201e", "brown": "#6b4a2e", "dark brown": "#4a3220", "white": "#ece8e0", "grey": "#8a8f96", "gray": "#8a8f96",
    "silver": "#b9bec6", "red": "#c23b2e", "orange": "#e07a2a", "yellow": "#e8c33a", "gold": "#d6a93a", "golden": "#d6a93a",
    "green": "#4f8f45", "olive": "#6f7a3a", "khaki": "#a89a6a", "tan": "#c49a6c", "beige": "#d8c7a4", "cream": "#efe3c4",
    "blue": "#3a6cc2", "navy": "#24345a", "teal": "#2f8f8a", "purple": "#7a4ab0", "pink": "#e47aa0", "ginger": "#c8662a",
    "blond": "#e0c070", "blonde": "#e0c070", "auburn": "#8c3a20", "rust": "#a4502a", "camouflage": "#5a6a3a", "pale": "#e8d8c8",
    "turquoise": "#3ac2c0", "maroon": "#6a2028", "copper": "#b06a3a", "bronze": "#9a6a32", "ivory": "#f0e8d0", "crimson": "#a81c2c",
}
SKINS = ["#f1c9a5", "#e0ac84", "#c68b62", "#a5694a", "#7a4b32", "#5c3a26"]
HAIRS = ["#2a1d14", "#4a3020", "#6b4424", "#a8743a", "#d9b15f", "#1a1612", "#8a8a8a"]
SIZES = {"humanoid": 1.75, "quadruped": 1.6, "bird": 0.6, "fish": 1.0, "insect": 0.3, "serpent": 2.0, "vehicle": 4.5,
         "object": 0.6, "structure": 8.0, "plant": 6.0, "cell": 1.0}
VEHICLE_LENGTHS = [
    (("airliner", "airbus", "boeing", "jumbo", "a320", "a330", "a380", "737", "747", "757", "767", "777", "787"), 38.0),
    (("ship", "liner", "tanker", "freighter", "cruise", "warship", "carrier", "submarine"), 90.0),
    (("ferry", "trawler", "tug", "yacht", "vessel"), 30.0), (("train", "locomotive", "tram"), 20.0),
    (("jet", "helicopter", "cessna", "plane", "aircraft", "airplane", "aeroplane", "glider"), 12.0),
    (("bus", "lorry", "truck", "tractor", "ambulance", "fire engine"), 10.0), (("boat", "canoe", "kayak", "raft"), 5.0),
    (("bike", "bicycle", "motorcycle"), 2.0),
]
BIG = ("large", "huge", "giant", "massive", "enormous", "big", "tall", "grizzly", "adult male")
SMALL = ("small", "tiny", "little", "young", "cub", "juvenile", "baby", "miniature", "micro")


def _has(text: str, word: str) -> bool:
    """The word in the text: whole (or plural) for short words, so 'sealed' is no seal and 'containers'
    no ant; long words and stems ('bacteri') may run on."""
    tail = "" if len(word) >= 6 else r"(?:s|es)?(?![a-z])"
    return re.search(rf"(?<![a-z]){re.escape(word)}{tail}", text) is not None


PLACE_KINDS = ("river", "lake", "sea", "ocean", "water body", "waterway", "bay", "harbour", "harbor", "airport", "airfield", "city",
               "town", "village", "mountain", "forest", "island", "valley", "desert", "region", "country", "state", "park", "landmark area")


def is_place(e: Entity) -> bool:
    """An 'entity' that is really somewhere (the Hudson River, LaGuardia Airport): it is a set, not a cast member."""
    return any(_has(e.kind.lower(), w) for w in PLACE_KINDS)


GENERIC = {"animal", "mammal", "beast", "vehicle", "human", "people", "person", "plant", "building"}


def archetype_of(e: Entity) -> str:
    """The body plan an entity is built on, from its kind first, then its name and search terms."""
    texts = (e.kind.lower(), f"{e.name} {' '.join(e.search)}".lower(), e.look.lower())
    # A specific word anywhere ("tardigrade") beats a generic one ("microscopic animal").
    for generic in (False, True):
        for text in texts:
            for arche, words in KIND_WORDS:
                if any(_has(text, w) for w in words if (w in GENERIC) == generic):
                    return arche
    return "object"


def colours_in(text: str) -> list[str]:
    text = text.lower()
    found = []
    for name in sorted(COLOURS, key=len, reverse=True):
        for m in re.finditer(rf"(?<![a-z]){re.escape(name)}(?![a-z])", text):
            found.append((m.start(), COLOURS[name]))
            text = text[: m.start()] + " " * len(name) + text[m.end():]
    return list(dict.fromkeys(c for _, c in sorted(found)))


def _pick(seed: int, options: list[str]) -> str:
    return options[seed % len(options)]


def _seed(text: str) -> int:
    return sum((i + 1) * ord(c) for i, c in enumerate(text)) & 0xFFFFFF


# --- rules: a story-specific build from the entity's own words ------------------------------------


def _outfit(words: str) -> Outfit:
    o = Outfit()
    tops = [("spacesuit", ("astronaut", "spacesuit")), ("scrubs", ("surgeon", "nurse", "scrubs")), ("labcoat", ("scientist", "doctor", "lab coat", "chemist")),
            ("uniform", ("ranger", "police", "officer", "pilot", "soldier", "guard", "captain", "firefighter", "paramedic", "sailor", "uniform", "agent")),
            ("suit", ("suit", "businessman", "lawyer", "dealer", "detective")), ("dress", ("dress", "gown")), ("robe", ("robe", "monk", "priest")),
            ("coat", ("coat", "overcoat", "parka")), ("jacket", ("jacket", "hiker", "hunter", "climber")), ("hoodie", ("hoodie", "teenager")),
            ("vest", ("vest", "hi-vis", "worker", "miner")), ("armour", ("armour", "armor", "knight")), ("tshirt", ("t-shirt", "tshirt", "tourist"))]
    o.top = next((t for t, ws in tops if any(_has(words, w) for w in ws)), "shirt")
    o.bottom = "skirt" if _has(words, "skirt") else "shorts" if _has(words, "shorts") else "none" if o.top in ("dress", "robe", "spacesuit") else "trousers"
    hair = [("helmet", ("helmet", "astronaut", "firefighter", "miner", "diver")), ("hat", ("hat", "ranger", "cowboy", "stetson", "fedora")),
            ("cap", ("cap", "pilot", "police", "baseball")), ("hood", ("hood", "hooded")), ("bald", ("bald",)), ("bun", ("bun",)),
            ("ponytail", ("ponytail",)), ("long", ("long hair", "woman", "girl")), ("curly", ("curly",))]
    o.hair = next((h for h, ws in hair if any(_has(words, w) for w in ws)), "short")
    o.beard = any(_has(words, w) for w in ("beard", "bearded"))
    o.glasses = any(_has(words, w) for w in ("glasses", "spectacles"))
    return o


def _thing_parts(words: str, size: float, c: list[str]) -> list[Part]:
    """A plain shape for an object no model call described: its outline from what it is called."""
    s, a, b = size, c[0], c[1]
    if any(_has(words, w) for w in ("bag", "duffel", "duffle", "sack", "backpack", "suitcase", "pack")):
        return [Part(shape="capsule", at=[0, s * 0.22, 0], size=[s * 0.42, s, s * 0.42], rot=[0, 0, 90], color=a),
                Part(shape="torus", at=[0, s * 0.46, 0], size=[s * 0.32, s * 0.32, s * 0.06], rot=[0, 90, 0], color=b)]
    if any(_has(words, w) for w in ("brick", "package", "parcel", "box", "crate", "block", "bale", "kilo")):
        return [Part(shape="box", at=[0, s * 0.18, 0], size=[s, s * 0.36, s * 0.6], color=a),
                Part(shape="box", at=[0, s * 0.18, 0], size=[s * 1.01, s * 0.06, s * 0.61], color=b)]
    if any(_has(words, w) for w in ("bottle", "vial", "jar", "can", "canister", "flask", "syringe")):
        return [Part(shape="cylinder", at=[0, s * 0.35, 0], size=[s * 0.35, s * 0.7, s * 0.35], color=a),
                Part(shape="cylinder", at=[0, s * 0.82, 0], size=[s * 0.14, s * 0.24, s * 0.14], color=b)]
    if any(_has(words, w) for w in ("phone", "radio", "device", "tablet", "screen", "monitor")):
        return [Part(shape="box", at=[0, s * 0.5, 0], size=[s * 0.08, s, s * 0.5], color="#1d1f24"),
                Part(shape="box", at=[s * 0.045, s * 0.5, 0], size=[s * 0.01, s * 0.9, s * 0.44], color=b if b != a else "#7fc4ff", glow=True)]
    if any(_has(words, w) for w in ("needle", "stick", "pole", "rod", "spear", "pipe", "rifle", "gun", "tube", "splinter")):
        return [Part(shape="cylinder", at=[0, s * 0.03, 0], size=[s * 0.05, s, s * 0.05], rot=[0, 0, 90], color=a)]
    if any(_has(words, w) for w in ("ball", "egg", "rock", "stone", "boulder", "meteorite", "orb", "pearl", "pill")):
        return [Part(shape="sphere", at=[0, s * 0.5, 0], size=[s, s, s], color=a)]
    return [Part(shape="box", at=[0, s * 0.3, 0], size=[s, s * 0.6, s * 0.7], color=a),
            Part(shape="box", at=[0, s * 0.62, 0], size=[s * 0.7, s * 0.06, s * 0.5], color=b)]


def _vehicle_parts(words: str, size: float, c: list[str]) -> list[Part]:
    L, a, b, d = size, c[0], c[1], c[2]
    glass = "#2a3a4c"
    if any(_has(words, w) for w in ("airliner", "airbus", "boeing", "jet", "jumbo", "a320", "a330", "a380", "737", "747", "757", "767", "777", "787", "dc-10")):
        # low swept wings, engines slung under them, a tall fin, no propeller
        return [Part(shape="capsule", at=[0, L * 0.13, 0], size=[L * 0.11, L * 0.95, L * 0.11], rot=[0, 0, 90], color=a),
                Part(shape="box", at=[L * 0.03, L * 0.145, 0], size=[L * 0.72, L * 0.014, L * 0.113], color=glass),
                Part(shape="box", at=[L * 0.43, L * 0.155, 0], size=[L * 0.05, L * 0.022, L * 0.085], color=glass),
                *[Part(shape="box", at=[-L * 0.04, L * 0.095, z * L * 0.24], size=[L * 0.18, L * 0.016, L * 0.42], rot=[0, -z * 28, 0], color=a) for z in (-1, 1)],
                *[Part(shape="cylinder", at=[L * 0.05, L * 0.06, z * L * 0.17], size=[L * 0.065, L * 0.15, L * 0.065], rot=[0, 0, 90], color=b) for z in (-1, 1)],
                Part(shape="box", at=[-L * 0.41, L * 0.26, 0], size=[L * 0.15, L * 0.2, L * 0.016], rot=[0, 0, -18], color=d),
                *[Part(shape="box", at=[-L * 0.43, L * 0.15, z * L * 0.09], size=[L * 0.09, L * 0.012, L * 0.17], rot=[0, -z * 25, 0], color=a) for z in (-1, 1)]]
    if any(_has(words, w) for w in ("plane", "aircraft", "airplane", "aeroplane", "cessna", "glider", "drone")):
        return [Part(shape="capsule", at=[0, L * 0.12, 0], size=[L * 0.13, L, L * 0.13], rot=[0, 0, 90], color=a),
                Part(shape="box", at=[L * 0.02, L * 0.14, 0], size=[L * 0.18, L * 0.02, L * 1.05], color=a),
                Part(shape="box", at=[-L * 0.44, L * 0.2, 0], size=[L * 0.1, L * 0.16, L * 0.02], color=b),
                Part(shape="box", at=[-L * 0.44, L * 0.13, 0], size=[L * 0.08, L * 0.02, L * 0.32], color=b),
                Part(shape="box", at=[L * 0.3, L * 0.17, 0], size=[L * 0.1, L * 0.05, L * 0.12], color=glass),
                Part(shape="box", at=[L * 0.51, L * 0.12, 0], size=[L * 0.01, L * 0.22, L * 0.03], color="#333333", spin="x"),
                Part(shape="box", at=[L * 0.05, L * 0.12, -L * 0.21], size=[L * 0.12, L * 0.06, L * 0.06], color=d),
                Part(shape="box", at=[L * 0.05, L * 0.12, L * 0.21], size=[L * 0.12, L * 0.06, L * 0.06], color=d)]
    if any(_has(words, w) for w in ("helicopter",)):
        return [Part(shape="sphere", at=[0, L * 0.2, 0], size=[L * 0.45, L * 0.3, L * 0.28], color=a),
                Part(shape="cylinder", at=[-L * 0.32, L * 0.22, 0], size=[L * 0.06, L * 0.5, L * 0.06], rot=[0, 0, 90], color=a),
                Part(shape="box", at=[0, L * 0.38, 0], size=[L * 1.0, L * 0.01, L * 0.05], color="#333333", spin="y"),
                Part(shape="box", at=[L * 0.12, L * 0.22, 0], size=[L * 0.14, L * 0.12, L * 0.24], color=glass),
                Part(shape="box", at=[0, L * 0.03, -L * 0.12], size=[L * 0.5, L * 0.02, L * 0.02], color="#333333"),
                Part(shape="box", at=[0, L * 0.03, L * 0.12], size=[L * 0.5, L * 0.02, L * 0.02], color="#333333")]
    if any(_has(words, w) for w in ("boat", "ship", "ferry", "yacht", "vessel", "tug", "trawler", "canoe", "kayak", "raft", "submarine")):
        return [Part(shape="wedge", at=[0, L * 0.06, 0], size=[L, L * 0.12, L * 0.28], rot=[180, 0, 0], color=a),
                Part(shape="box", at=[-L * 0.08, L * 0.17, 0], size=[L * 0.4, L * 0.1, L * 0.22], color=b),
                Part(shape="box", at=[-L * 0.1, L * 0.26, 0], size=[L * 0.2, L * 0.08, L * 0.18], color="#f2f2ee"),
                Part(shape="box", at=[-L * 0.1, L * 0.26, 0], size=[L * 0.21, L * 0.03, L * 0.185], color=glass),
                Part(shape="cylinder", at=[-L * 0.2, L * 0.33, 0], size=[L * 0.05, L * 0.1, L * 0.05], color=d)]
    if any(_has(words, w) for w in ("train", "locomotive", "tram")):
        return [Part(shape="box", at=[0, L * 0.12, 0], size=[L, L * 0.18, L * 0.2], color=a),
                Part(shape="box", at=[0, L * 0.12, 0], size=[L * 0.9, L * 0.05, L * 0.205], color=glass),
                Part(shape="box", at=[0, L * 0.215, 0], size=[L, L * 0.02, L * 0.18], color=b),
                *[Part(shape="cylinder", at=[x * L, L * 0.035, z * L * 0.09], size=[L * 0.07, L * 0.02, L * 0.07], rot=[90, 0, 0], color="#222222", spin="z")
                  for x in (-0.35, -0.2, 0.2, 0.35) for z in (-1, 1)]]
    if any(_has(words, w) for w in ("bike", "bicycle", "motorcycle")):
        return [Part(shape="torus", at=[L * 0.33, L * 0.18, 0], size=[L * 0.36, L * 0.36, L * 0.05], color="#222222", spin="z"),
                Part(shape="torus", at=[-L * 0.33, L * 0.18, 0], size=[L * 0.36, L * 0.36, L * 0.05], color="#222222", spin="z"),
                Part(shape="box", at=[0, L * 0.3, 0], size=[L * 0.62, L * 0.04, L * 0.04], rot=[0, 0, -10], color=a),
                Part(shape="box", at=[-L * 0.08, L * 0.42, 0], size=[L * 0.16, L * 0.04, L * 0.08], color="#222222")]
    # cars, trucks, buses, vans and anything else on wheels
    tall = 0.28 if any(_has(words, w) for w in ("truck", "lorry", "bus", "van", "ambulance", "suv", "jeep", "tractor")) else 0.18
    return [Part(shape="box", at=[0, L * 0.12, 0], size=[L, L * 0.13, L * 0.4], color=a),
            Part(shape="box", at=[-L * 0.05, L * (0.12 + tall / 2), 0], size=[L * 0.55, L * tall * 0.8, L * 0.37], color=a),
            Part(shape="box", at=[-L * 0.05, L * (0.12 + tall / 2), 0], size=[L * 0.56, L * tall * 0.45, L * 0.375], color=glass),
            Part(shape="box", at=[L * 0.5, L * 0.13, L * 0.13], size=[L * 0.01, L * 0.04, L * 0.07], color="#fff3c4", glow=True),
            Part(shape="box", at=[L * 0.5, L * 0.13, -L * 0.13], size=[L * 0.01, L * 0.04, L * 0.07], color="#fff3c4", glow=True),
            Part(shape="box", at=[0, L * 0.09, 0], size=[L * 1.01, L * 0.02, L * 0.405], color=b),
            *[Part(shape="cylinder", at=[x * L, L * 0.07, z * L * 0.2], size=[L * 0.15, L * 0.06, L * 0.15], rot=[90, 0, 0], color="#1c1c1c", spin="z")
              for x in (-0.32, 0.32) for z in (-1, 1)]]


def _structure_parts(words: str, size: float, c: list[str]) -> list[Part]:
    H, a, b, d = size, c[0], c[1], c[2]
    if any(_has(words, w) for w in ("tower", "mast", "lighthouse")):
        light = any(_has(words, w) for w in ("lighthouse",))
        return [Part(shape="cylinder" if light else "box", at=[0, H * 0.45, 0], size=[H * 0.12, H * 0.9, H * 0.12], color=a),
                Part(shape="cylinder", at=[0, H * 0.93, 0], size=[H * 0.15, H * 0.08, H * 0.15], color=b),
                Part(shape="sphere", at=[0, H * 1.0, 0], size=[H * 0.04, H * 0.04, H * 0.04], color="#ff3030" if not light else "#fff2b0", glow=True)]
    if any(_has(words, w) for w in ("bridge",)):
        return [Part(shape="box", at=[0, H * 0.5, 0], size=[H * 4, H * 0.08, H * 0.5], color=a),
                *[Part(shape="box", at=[x * H, H * 0.25, 0], size=[H * 0.15, H * 0.5, H * 0.3], color=b) for x in (-1.5, -0.5, 0.5, 1.5)]]
    if any(_has(words, w) for w in ("tent",)):
        return [Part(shape="cone", at=[0, H * 0.5, 0], size=[H * 1.2, H, H * 1.2], color=a)]
    return [Part(shape="box", at=[0, H * 0.32, 0], size=[H * 0.9, H * 0.64, H * 0.75], color=a),
            Part(shape="wedge", at=[0, H * 0.8, 0], size=[H * 0.95, H * 0.32, H * 0.8], color=b),
            Part(shape="box", at=[H * 0.451, H * 0.18, 0], size=[H * 0.01, H * 0.34, H * 0.16], color=d),
            Part(shape="box", at=[H * 0.451, H * 0.42, H * 0.22], size=[H * 0.01, H * 0.12, H * 0.12], color="#ffd98a", glow=True),
            Part(shape="box", at=[H * 0.451, H * 0.42, -H * 0.22], size=[H * 0.01, H * 0.12, H * 0.12], color="#ffd98a", glow=True)]


def _cell_parts(words: str, size: float, c: list[str]) -> list[Part]:
    """Parts for a cell whose shape its words name; [] keeps the generic nucleated blob."""
    L, a, b, d = size, c[0], c[1], c[2]
    y = L * 0.6
    if any(_has(words, w) for w in ("sickle", "crescent", "sickled")):
        return [Part(shape="sphere", at=[math.cos(t) * L * 0.42, y + math.sin(t) * L * 0.42, 0],
                     size=[L * (0.1 + 0.2 * math.sin(math.pi * i / 8))] * 2 + [L * (0.08 + 0.12 * math.sin(math.pi * i / 8))], color=a)
                for i, t in ((i, math.radians(195 + i * 150 / 8)) for i in range(1, 8))]
    if any(_has(words, w) for w in ("red blood", "erythrocyte", "biconcave", "disc", "disk", "platelet")):
        return [Part(shape="torus", at=[0, y, 0], size=[L, L, L * 0.34], color=a),
                Part(shape="cylinder", at=[0, y, 0], size=[L * 0.74, L * 0.1, L * 0.74], rot=[90, 0, 0], color=b)]
    if any(_has(words, w) for w in ("virus", "coronavirus", "virion", "phage")):
        spikes = [(0.0, z) for z in range(0, 360, 45)] + [(x, 0.0) for x in (45, 135, 225, 315)]
        out = [Part(shape="sphere", at=[0, y, 0], size=[L * 0.7] * 3, color=a)]
        for rx, rz in spikes:
            dx, dy, dz = (-math.sin(math.radians(rz)), math.cos(math.radians(rz)), 0.0) if rx == 0 else (0.0, math.cos(math.radians(rx)), math.sin(math.radians(rx)))
            out.append(Part(shape="cylinder", at=[dx * L * 0.42, y + dy * L * 0.42, dz * L * 0.42], size=[L * 0.04, L * 0.16, L * 0.04], rot=[rx, 0, rz], color=b))
            out.append(Part(shape="sphere", at=[dx * L * 0.5, y + dy * L * 0.5, dz * L * 0.5], size=[L * 0.1] * 3, color=d))
        return out[:24]
    if any(_has(words, w) for w in ("bacteri", "bacillus", "e. coli", "rod", "microbe")):
        return [Part(shape="capsule", at=[0, y, 0], size=[L * 0.34, L * 0.9, L * 0.34], rot=[0, 0, 90], color=a),
                *[Part(shape="box", at=[-L * 0.62, y + k * L * 0.08, 0], size=[L * 0.35, L * 0.015, L * 0.015], rot=[0, 0, k * 12], color=b) for k in (-1, 0, 1)]]
    if any(_has(words, w) for w in ("neuron", "nerve cell", "brain cell")):
        return [Part(shape="sphere", at=[0, y, 0], size=[L * 0.36] * 3, color=a),
                *[Part(shape="cone", at=[-math.sin(math.radians(z)) * L * 0.32, y + math.cos(math.radians(z)) * L * 0.32, 0], size=[L * 0.09, L * 0.42, L * 0.09], rot=[0, 0, z], color=a)
                  for z in (20, 80, 140, 200, 300)],
                Part(shape="cylinder", at=[L * 0.75, y - L * 0.2, 0], size=[L * 0.05, L * 1.1, L * 0.05], rot=[0, 0, 105], color=b),
                Part(shape="sphere", at=[0.02 * L, y + 0.02 * L, L * 0.12], size=[L * 0.14] * 3, color=d)]
    return []


def rule_build(e: Entity, seed: int) -> Build:
    """A build from the entity's own words: its body plan, colours and size from its kind and look, and
    the outline of a thing from what it is called. Used when the design call fails."""
    arche = archetype_of(e)
    words = f"{e.name} {e.kind} {' '.join(e.search)} {e.look}".lower()
    s = _seed(e.id) ^ seed
    found = colours_in(e.look) or colours_in(e.name)
    base = {"humanoid": ["#3a6cc2", "#2c3550", "#e8c33a"], "quadruped": ["#6b4a2e", "#a8835a", "#22201e"], "bird": ["#8a8f96", "#ece8e0", "#e07a2a"],
            "fish": ["#5d7f9a", "#d8e2e8", "#e07a2a"], "insect": ["#3a2f24", "#6b4a2e", "#c23b2e"], "serpent": ["#4f6f35", "#c4b46a", "#22201e"],
            "vehicle": ["#d9dde3", "#3a6cc2", "#2a2a30"], "object": ["#8a6a48", "#d8c7a4", "#22201e"], "structure": ["#c9b79a", "#7a4a3a", "#4a3220"],
            "plant": ["#4f8f45", "#6b4a2e", "#e8c33a"], "cell": ["#d0566a", "#f2b6c0", "#6a2028"]}[arche]
    c = (found + base)[:3] if found else base
    size = SIZES[arche]
    if arche == "vehicle":
        # real length, pulled towards a car's so people still read beside a ship or an airliner
        real = next((m for ws, m in VEHICLE_LENGTHS if any(_has(words, w) for w in ws)), size)
        size = round(4.5 * (real / 4.5) ** 0.5, 2)
    if any(_has(words, w) for w in BIG):
        size *= 1.35
    if any(_has(words, w) for w in SMALL):
        size *= 0.6
    body = Body()
    if arche == "quadruped":
        lean = any(_has(words, w) for w in ("deer", "horse", "dog", "wolf", "fox", "cat", "cheetah", "leopard", "giraffe", "llama", "camel", "goat"))
        heavy = any(_has(words, w) for w in ("bear", "bull", "buffalo", "bison", "hippo", "rhino", "elephant", "pig", "boar", "gorilla", "panda", "cow"))
        body = Body(build=0.8 if heavy else 0.35 if lean else 0.55, legs=0.65 if lean else 0.35 if heavy else 0.5,
                    neck=0.9 if _has(words, "giraffe") else 0.45 if any(_has(words, w) for w in ("horse", "deer", "camel", "llama")) else 0.2,
                    snout=0.55 if any(_has(words, w) for w in ("bear", "dog", "wolf", "fox", "horse", "deer", "crocodile", "alligator", "pig")) else 0.3,
                    ears="pointed" if any(_has(words, w) for w in ("fox", "wolf", "cat", "dog", "lynx")) else "long" if any(_has(words, w) for w in ("rabbit", "donkey", "mule", "hare")) else "round",
                    tail="bushy" if any(_has(words, w) for w in ("fox", "squirrel", "wolf")) else "long" if any(_has(words, w) for w in ("cat", "lion", "tiger", "leopard", "monkey", "crocodile", "alligator", "lizard", "horse", "dog")) else "short",
                    horns="antlers" if any(_has(words, w) for w in ("deer", "moose", "elk", "reindeer", "stag")) else "horns" if any(_has(words, w) for w in ("bull", "goat", "buffalo", "bison", "rhino", "ram")) else "tusks" if any(_has(words, w) for w in ("elephant", "boar", "walrus")) else "mane" if _has(words, "lion") or _has(words, "horse") else "none",
                    pattern="stripes" if any(_has(words, w) for w in ("tiger", "zebra", "striped")) else "spots" if any(_has(words, w) for w in ("leopard", "cheetah", "giraffe", "spotted", "dalmatian")) else "belly")
    if arche == "bird":
        body = Body(build=0.6 if any(_has(words, w) for w in ("goose", "geese", "duck", "swan", "penguin", "pelican")) else 0.4,
                    neck=0.7 if any(_has(words, w) for w in ("goose", "geese", "swan", "heron", "flamingo", "ostrich")) else 0.25,
                    snout=0.35, tail="short", pattern="belly")
    outfit = _outfit(words) if arche == "humanoid" else None
    if arche == "humanoid":
        body = Body(build=0.65 if any(_has(words, w) for w in ("heavy", "stocky", "large", "big")) else 0.45,
                    age="child" if any(_has(words, w) for w in ("child", "kid", "boy", "girl", "toddler")) else "elder" if any(_has(words, w) for w in ("old", "elderly", "grandad", "grandma", "elder")) else "adult")
        if body.age == "child":
            size = 1.25
    parts: list[Part] = []
    if arche == "vehicle":
        parts = _vehicle_parts(words, size, c)
    elif arche == "structure":
        parts = _structure_parts(words, size, c)
    elif arche == "object":
        parts = _thing_parts(words, size, c)
    elif arche == "cell":
        parts = _cell_parts(words, size, c)
    elif arche == "humanoid" and any(_has(words, w) for w in ("bag", "duffel", "duffle", "backpack")):
        parts = [Part(shape="capsule", at=[0, -0.05, -0.18], size=[0.35, 0.45, 0.2], color=c[2] if found else "#3a3a2a", bone="back")]
    return Build(
        entity=e.id, archetype=arche, size=round(size, 2), primary=c[0], secondary=c[1], accent=c[2],
        skin=_pick(s, SKINS) if arche == "humanoid" else "", hair=_pick(s >> 3, HAIRS) if arche == "humanoid" else "",
        body=body, outfit=outfit, parts=parts,
    )


SET_WORDS: list[tuple[str, tuple[str, ...]]] = [
    ("micro", ("bloodstream", "inside the body", "microscop", "cell", "tissue", "vein", "artery", "under the skin", "wound", "intestin", "stomach")),
    ("hospital", ("hospital", "clinic", "operating", "ward", "surgery", "emergency room", "doctor's")),
    ("lab", ("laborator", "lab ")),
    ("space", ("space", "orbit", "lunar", "moon's surface", "mars")),
    ("underwater", ("underwater", "seabed", "sea floor", "ocean floor", "beneath the waves", "reef")),
    ("sky", ("in the air", "over the clouds", "sky", "mid-air", "airborne")),
    ("airfield", ("airport", "runway", "airfield", "airstrip")),
    ("room", ("room", "kitchen", "bedroom", "office", "apartment", "living room", "cockpit", "cabin interior", "basement", "garage")),
    ("hall", ("hall", "courtroom", "church interior", "museum", "palace", "station concourse")),
    ("cave", ("cave", "mine shaft", "tunnel", "cavern")),
    ("city", ("city", "downtown", "skyscraper", "manhattan")),
    ("town", ("town", "village", "street", "main street", "neighbourhood", "neighborhood")),
    ("road", ("road", "highway", "motorway", "parking lot", "interstate")),
    ("farm", ("farm", "field", "barn", "ranch", "pasture")),
    ("swamp", ("swamp", "marsh", "bayou", "bog")),
    ("river", ("river", "creek", "stream", "hudson", "canal")),
    ("lake", ("lake", "pond", "reservoir")),
    ("beach", ("beach", "shore", "coast", "island")),
    ("sea", ("sea", "ocean", "bay", "gulf", "atlantic", "pacific")),
    ("snow", ("snow", "arctic", "antarctic", "glacier", "tundra", "ice")),
    ("desert", ("desert", "dune", "sahara", "arid", "canyon")),
    ("mountain", ("mountain", "peak", "slope", "summit", "ridge", "cliff", "alps")),
    ("forest", ("forest", "woods", "woodland", "jungle", "national forest", "trees", "rainforest")),
    ("grassland", ("meadow", "prairie", "savanna", "plain", "grassland", "park")),
]
SET_COLOURS = {
    "forest": ("#3f6a3a", "#9fc0d8", "#ffd9a0"), "grassland": ("#6f9a4a", "#a8cde8", "#ffe0a0"), "mountain": ("#6a7060", "#a9c3dc", "#ffe6c0"),
    "desert": ("#d6b07a", "#e8cfa8", "#ffd080"), "snow": ("#e8eef2", "#c2d4e4", "#ffffff"), "beach": ("#e6d2a0", "#9fd0ec", "#ffe8b0"),
    "river": ("#5a8a48", "#a8cde8", "#ffe0a0"), "lake": ("#5f8f4a", "#a8cde8", "#ffe0a0"), "sea": ("#2e5f7a", "#9fc8e4", "#ffffff"),
    "swamp": ("#4a5a3a", "#8a9a8a", "#c8e0a0"), "farm": ("#8aa04a", "#a8cde8", "#ffe0a0"), "town": ("#8a8478", "#a8c8e0", "#ffd98a"),
    "city": ("#6a6c72", "#a0b8d0", "#ffd98a"), "road": ("#7a8a5a", "#a8c8e0", "#ffe0a0"), "airfield": ("#7a8a5a", "#a8c8e0", "#ffffff"),
    "room": ("#8a6a4a", "#e8dccb", "#ffe2b0"), "hall": ("#9a9080", "#d8d0c0", "#ffe8c0"), "lab": ("#c8ccd0", "#eef2f4", "#7fe0ff"),
    "hospital": ("#cdd6d8", "#eef4f4", "#a0f0e0"), "cave": ("#4a4038", "#2a2420", "#ffb060"), "underwater": ("#c8b890", "#1e5a7a", "#9fe8ff"),
    "sky": ("#6a8a5a", "#8fc0ec", "#ffffff"), "space": ("#5a5a66", "#03040c", "#ffffff"), "micro": ("#6a1c2c", "#3a0c18", "#ff9fb0"),
}


def set_kind(name: str, look: str) -> str:
    """The kind of set a place is: what its name says first ("Chattahoochee National Forest"), else the
    earliest kind its look names ("dense pine forest, Georgia mountains" is a forest)."""
    for text in (name.lower(), look.lower()):
        hits = [(text.find(w), k) for k, ws in SET_WORDS for w in ws if w in text]
        if hits:
            return min(hits)[1]
    return "grassland"


def rule_setting(p: manifest.Place) -> Setting:
    text = f"{p.name} {p.look}".lower()
    kind = set_kind(p.name, p.look)
    time = "night" if any(w in text for w in ("night", "dark", "midnight")) else "dusk" if any(w in text for w in ("dusk", "sunset", "evening")) else "dawn" if any(w in text for w in ("dawn", "sunrise", "morning")) else "day"
    g, sky, acc = SET_COLOURS[kind]
    backdrop = ("city" if kind == "city" or any(_has(text, w) for w in CITY_WORDS) else "mountains" if kind in ("mountain", "snow") or _has(text, "mountain")
                else "none" if kind in ("sea", "sky", "space", "micro", "underwater") else "hills")
    return Setting(place=p.id, kind=kind, time=time, ground=g, sky=sky, accent=acc, backdrop=backdrop)


CITY_WORDS = ("skyline", "city", "downtown", "skyscraper", "manhattan", "new york", "london", "tokyo", "chicago", "harbour", "harbor", "port")


# --- the model's design, checked ------------------------------------------------------------------

CAST_GUIDE = """You are the 3D art director of a documentary channel. Each story gets its own cast, built from
scratch by a procedural engine in one visual style. Design every entity listed so a viewer recognises
exactly that thing: this species, this make of vehicle, this role and era of person. Return JSON only.

Styles: {styles}
Pick the style that suits the story's tone and subject.

Archetypes (the body plan the engine rigs and animates): {archetypes}
- Living things use a parametric body: set body (proportions, ears, tail, horns, coat pattern) and,
  for people, outfit. Add parts only for accessories, on a bone (head, torso, hips, hand_l, hand_r,
  back, tail): a ranger's flat hat, a duffel bag in hand_r, a stethoscope. People are shown by role and
  clothing only, never a real person's likeness.
- vehicle, object, structure, plant and cell are built entirely from parts (bone = body), in metres,
  x pointing forward, y up, standing on y = 0: a fuselage capsule (size [d, length, d], rot [0, 0, 90]),
  two wing boxes, a tail fin, a propeller with spin = x. A wedge is a roof-shaped prism, ridge on top
  along x. size is the part's own extent before rot. Use 4-{max_parts} parts; get the proportions and the defining features right
  (a Cessna 404 is a twin-engine high-tail light aircraft; a duffel bag is a long padded capsule with
  handles). Glow only lights, screens and signals.
- size in metres (a black bear is about 1.7 long; a person 1.75 tall; a cell tower 30 tall).
- Colours as #rrggbb from what the story says it looked like; plausible ones otherwise."""

SETS_GUIDE = """You design the places of a documentary story for a procedural 3D engine that builds terrain,
water, interiors, sky and light from a kind of set. Return JSON only.

Set kinds: {sets}
- kind: the closest kind; time: the time of day the story says, else day.
- ground, sky, accent (a light or glow colour) as #rrggbb.
- backdrop: what rings the horizon outdoors: hills, mountains, a city skyline, or none (open sea, sky).
- dressing: 0-4 things that make this place this particular place (the story's kind of tree, a picnic
  table in a national forest, police cars at a roadblock), each built from 1-{max_parts} primitive parts in
  metres (x forward, y up, standing on y = 0), with how many copies and how far they spread. The engine
  already adds generic ground cover, so only add what is specific. No people or animals."""

DIRECT_GUIDE = """You direct the 3D scenes of a documentary video. The engine builds each entity from its
design and performs verbs; you block each scene so it shows exactly what the narration says, as a
film director would. Return JSON only.

Verbs by archetype: {verbs}
Camera moves: {camera}
Marks (animated overlays drawn in the scene): {marks}
Places on the stage: center, left, right, back, front, far.

Rules:
- One shot per scene listed. actors: the scene's main entity first, then any other entities listed for
  that scene that the narration involves (at most 5). Only entities listed for that scene.
- verb: what it does as the narration tells it. When the narration doesn't say it did something, use a
  calm verb (idle, look_around, walk, sniff, fly, swim, present). Never invent a fall, crash, attack or
  injury the narration doesn't describe.
- at / to: block them so they read (two actors talking: left and right facing each other; one
  approaching: from far to center). face: the entity it looks at, or camera.
- state: injured, dazed, asleep, damaged, burning or wet only when the narration says so.
- holding: the id of an object entity a person or animal holds or carries in that scene.
- count: 2-9 when the entity is a flock, crowd, herd or fleet (Canada geese, passengers), else 1.
- camera: a move that tells the moment (establish for a new place, follow for travel, push_in for a
  reveal, low_angle for menace, over_shoulder for an encounter, top_down for a route or layout). Vary it.
- marks: only where they explain something: a beam for a signal or call, a dome for a range, a path
  for a route, a ring for 'here'. callouts: 1-4 words copied from the narration or an entity's name."""


def _hex(v: str, fallback: str) -> str:
    return v if isinstance(v, str) and HEX.match(v) else fallback


def _clean_part(p: Part, size: float) -> Part | None:
    if len(p.at) != 3 or len(p.size) != 3:
        return None
    limit = max(1.0, size) * 3
    at = [max(-limit, min(limit, float(x))) for x in p.at]
    sz = [max(0.005, min(limit, abs(float(x)))) for x in p.size]
    rot = [float(x) % 360 for x in (p.rot + [0, 0, 0])[:3]]
    return p.model_copy(update={"at": at, "size": sz, "rot": rot, "color": _hex(p.color, "#9a9a9a")})


def checked_build(b: Build, e: Entity, seed: int) -> Build:
    """A model's build made safe to render and true to the entity: the archetype the entity's own words
    point to when the model's disagrees with a living/non-living split (a bear is never built from
    parts, a duffel bag never on a skeleton), colours valid, size plausible, at most MAX_PARTS parts."""
    rules = rule_build(e, seed)
    arche = b.archetype
    if (arche in LIVING) != (rules.archetype in LIVING) and archetype_of(e) != "object":
        arche = rules.archetype
    size = b.size if 0.002 <= b.size <= 400 else rules.size
    parts = [q for q in (_clean_part(p, size) for p in b.parts[:MAX_PARTS]) if q is not None]
    if arche not in LIVING:
        parts = [p.model_copy(update={"bone": "body"}) for p in parts]
        if len(parts) < 2:  # too little to be recognisable: the rules' outline of what it is called
            parts = rules.parts
    outfit = (b.outfit or rules.outfit) if arche == "humanoid" else None
    primary, secondary, accent = _hex(b.primary, rules.primary), _hex(b.secondary, rules.secondary), _hex(b.accent, rules.accent)
    if arche == "vehicle" and rules.archetype == "vehicle" and rules.parts:
        # a vehicle its name says is an airliner, a ship or a car keeps that outline, at the rules' size,
        # in the model's colours: a model's own boxes for one rarely read as that kind of vehicle
        size = rules.size
        parts = _vehicle_parts(f"{e.name} {e.kind} {' '.join(e.search)} {e.look}".lower(), size, [primary, secondary, accent])
    return b.model_copy(update={
        "entity": e.id, "archetype": arche, "size": round(size, 3), "parts": parts, "outfit": outfit,
        "primary": primary, "secondary": secondary, "accent": accent,
        "skin": _hex(b.skin, rules.skin or SKINS[2]) if arche == "humanoid" else "",
        "hair": _hex(b.hair, rules.hair or HAIRS[0]) if arche == "humanoid" else "",
    })


def _scaled_dressing(parts: list[Part]) -> list[Part]:
    """Set dressing pulled to the stage's scale like a vehicle's length (a 400 m runway or a 60 m tower
    would bury an airliner drawn 13 units long), and anything flat, like a runway, laid flat on the ground."""
    span = max(max(abs(q.at[i]) + q.size[i] / 2 for q in parts) * 2 for i in range(3))
    f = 4.5 * (span / 4.5) ** 0.5 / span if span > 4.5 else 1.0
    out = []
    for q in parts:
        sz = [x * f for x in q.size]
        at = [x * f for x in q.at]
        if sz[1] < 0.25 * max(sz[0], sz[2]) and sz[1] > 0.08:  # a slab: a ground marking, not a wall
            at[1] = min(at[1], 0.04)
            sz[1] = 0.08
        out.append(q.model_copy(update={"size": [round(x, 3) for x in sz], "at": [round(x, 3) for x in at]}))
    return out


def checked_setting(s: Setting, p: manifest.Place) -> Setting:
    rules = rule_setting(p)
    dressing = []
    for d in s.dressing[:4]:
        b = d.build
        parts = [q for q in (_clean_part(x, b.size) for x in b.parts[:MAX_PARTS]) if q is not None]
        if not parts or b.archetype in LIVING:
            continue  # set dressing never carries people or animals
        parts = _scaled_dressing(parts)
        dressing.append(d.model_copy(update={
            "count": max(1, min(40, d.count)), "spread": max(2.0, min(80.0, d.spread)),
            "build": b.model_copy(update={"entity": f"{p.id}:{_slug(d.name)}", "parts": [x.model_copy(update={"bone": "body"}) for x in parts]}),
        }))
    return s.model_copy(update={"place": p.id, "ground": _hex(s.ground, rules.ground), "sky": _hex(s.sky, rules.sky),
                                "accent": _hex(s.accent, rules.accent), "dressing": dressing})


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:40] or "thing"


def _entity_lines(story: Manifest, ids: list[str]) -> str:
    rows = []
    for e in story.entities:
        if e.id in ids:
            rows.append(f"- {e.id}: {e.name} ({e.kind}); looks: {e.look}; likely archetype: {archetype_of(e)}")
    return "\n".join(rows)


def design(cfg: Config, script: Script, story: Manifest, ids: list[str], log=print) -> tuple[str, dict[str, Build], dict[str, Setting], dict]:
    """Builds for the entities `ids` and settings for every place, and the style. Returns (style, builds,
    settings, how each was made). Falls back to the rules per call, so it never raises."""
    seed = _seed(script.title)
    made: dict = {"cast": "rules", "sets": "rules"}
    builds: dict[str, Build] = {}
    style = default_style(cfg, script)
    ents = {e.id: e for e in story.entities}
    if ids:
        user = f"Title: {script.title}\nTone: {script.mood}\n\nEntities:\n{_entity_lines(story, ids)}"
        try:
            guide = CAST_GUIDE.format(
                styles="; ".join(f"{k} ({v})" for k, v in G["styles"].items()),
                archetypes="; ".join(f"{k} ({v['describe']})" for k, v in G["archetypes"].items()), max_parts=MAX_PARTS)
            cast = llm.structured(cfg, guide, user, Cast, max_tokens=7000)
            style = cast.style if cfg.visuals.world_style == "auto" else style
            for b in cast.builds:
                e = ents.get(_slug(b.entity))
                if e is not None and e.id in ids and e.id not in builds:
                    builds[e.id] = checked_build(b, e, seed)
            made["cast"] = "model"
        except Exception as ex:  # the rules still build every entity from its own words
            log(f"world design: cast call failed ({str(ex)[:140]}); building from the entities' own words")
    for i in ids:
        if i not in builds and i in ents:
            builds[i] = rule_build(ents[i], seed)
            made.setdefault("rules_built", []).append(i)
    settings: dict[str, Setting] = {p.id: rule_setting(p) for p in story.places}
    if story.places:
        user = f"Title: {script.title}\n\nPlaces:\n" + "\n".join(f"- {p.id}: {p.name}; looks: {p.look}" for p in story.places)
        try:
            sets = llm.structured(cfg, SETS_GUIDE.format(sets="; ".join(f"{k} ({v})" for k, v in G["sets"].items()), max_parts=MAX_PARTS),
                                  user, Sets, max_tokens=5000)
            places = {p.id: p for p in story.places}
            for s in sets.settings:
                p = places.get(_slug(s.place))
                if p is not None:
                    settings[p.id] = checked_setting(s, p)
            made["sets"] = "model"
        except Exception as ex:
            log(f"world design: sets call failed ({str(ex)[:140]}); reading the places' own words")
    return style, builds, settings, made


def default_style(cfg: Config, script: Script) -> str:
    """The style when the model doesn't pick one: the channel's setting, else the story's mood."""
    if cfg.visuals.world_style != "auto":
        return cfg.visuals.world_style
    story = " ".join([script.title] + [s.narration for s in script.scenes]).lower()
    if any(w in story for w in ("cell", "virus", "bacteria", "molecule", "blood", "immune", "organ", "dna", "neuron")):
        return "clinical"
    if any(w in story for w in ("what if", "simulation", "imagine if", "every person", "everyone on earth")):
        return "voxel"
    if script.mood in ("somber", "tense"):
        return "noir"
    year = scenes3d.story_year(story)
    if year is not None and year < 1900:
        return "diorama"
    return "lowpoly"


# --- direction --------------------------------------------------------------------------------------

MOTION_VERB = {
    "humanoid": {"move": "walk", "approach": "walk", "depart": "walk", "rise": "cheer", "fall": "fall", "turn": "look_around", "shake": "panic", "present": "idle"},
    "quadruped": {"move": "walk", "approach": "walk", "depart": "run", "rise": "rear", "fall": "fall", "turn": "look_around", "shake": "roar", "present": "idle"},
    "bird": {"move": "fly", "approach": "fly", "depart": "fly", "rise": "flap", "fall": "fall", "turn": "look_around", "shake": "flap", "present": "idle"},
    "fish": {"move": "swim", "approach": "swim", "depart": "swim", "rise": "rise", "fall": "fall", "turn": "turn", "shake": "turn", "present": "swim"},
    "insect": {"move": "walk", "approach": "walk", "depart": "run", "rise": "fly", "fall": "idle", "turn": "look_around", "shake": "run", "present": "idle"},
    "serpent": {"move": "move", "approach": "move", "depart": "move", "rise": "rear", "fall": "idle", "turn": "idle", "shake": "rear", "present": "idle"},
}
RIGID = {"move": "move", "approach": "approach", "depart": "depart", "rise": "rise", "fall": "fall", "turn": "turn", "shake": "shake", "present": "present"}
WINGS = ("airbus", "boeing", "plane", "aircraft", "airplane", "aeroplane", "jet", "airliner", "cessna", "glider", "helicopter", "drone", "balloon", "spacecraft")
MOVE_CYCLE = ("establish", "push_in", "orbit", "low_angle", "follow", "reveal")


GROUPS = ("geese", "flock", "herd", "swarm", "crowd", "people", "passengers", "crew", "children", "pack", "school of", "colony", "fleet", "troops", "soldiers")


def group_size(e: Entity | None, arche: str) -> int:
    """How many of an entity a shot shows: one, unless its name is a flock, crowd or plural of living things."""
    if e is None:
        return 1
    name = e.name.lower()
    last = re.sub(r"[^a-z]", "", name.split()[-1]) if name.split() else ""
    plural = any(_has(name, w) for w in GROUPS) or (arche in LIVING and last.endswith("s") and not last.endswith("ss") and len(last) > 3)
    if not plural:
        return 1
    return 7 if arche in ("bird", "insect", "fish") else 4 if arche in ("humanoid", "quadruped") else 3 if arche == "cell" else 1


LANDED = ("landed", "onto the river", "onto the water", "on the water", "ditched", "touched down", "splashed down", "on the runway", "floating", "sank", "wreck")


def archetype_words(story: Manifest, eid: str, words: tuple[str, ...]) -> bool:
    e = manifest.entity(story, eid)
    return bool(e) and any(_has(f"{e.name} {e.kind} {' '.join(e.search)}".lower(), w) for w in words)


def verbs_for(arche: str) -> list[str]:
    return G["archetypes"][arche]["verbs"]


def calm_verb(arche: str) -> str:
    return {"fish": "swim", "bird": "idle", "vehicle": "present", "object": "present", "structure": "present", "plant": "present", "cell": "present"}.get(arche, "idle")


def told_in(action: str, narration: str) -> bool:
    """Some content word of the moment's action is in the narration (so the action is what was said)."""
    words = [w for w in re.findall(r"[a-z]+", action.lower()) if len(w) > 3]
    return any(scenes3d.find(narration, [w[:5]]) for w in words)


def told(verb: str, text: str) -> bool:
    """The narration names this verb's action (its grammar words), so it may be acted out."""
    words = G["events"].get(verb)
    if words is None:
        words = [verb.replace("_", " ")]
    return bool(words) and scenes3d.find(text, words)


def _verb(verb: str, arche: str, text: str, documented: bool) -> str:
    if verb not in verbs_for(arche):
        return calm_verb(arche)
    if verb in G["calm"]:
        return verb
    return verb if documented and told(verb, text) else calm_verb(arche)


def _state(state: str, text: str) -> str:
    if state == "normal" or state not in G["states"]:
        return "normal"
    return state if scenes3d.find(text, G["states"][state]) else "normal"


def _callout(text: str, narration: str, e: Entity | None) -> str:
    words = re.findall(r"[A-Za-z0-9'.,%$-]+", text)[:4]
    allowed = narration.lower() + " " + (f"{e.name} {e.kind}".lower() if e else "")
    if not words or any(re.sub(r"[^a-z0-9%$]", "", w.lower()) not in re.sub(r"[^a-z0-9%$ ]", " ", allowed).split() for w in words if len(w) > 2 or any(ch.isdigit() for ch in w)):
        return ""
    return " ".join(words)


def checked_shot(sh: Shot, script: Script, story: Manifest, builds: dict[str, Build], scene: int) -> Shot | None:
    """A shot true to its scene: only entities the manifest lists in it, verbs within each one's grammar
    and beyond a calm verb only when documented, states and labels from the narration."""
    narration = script.scenes[scene - 1].narration
    moment = next((m for m in story.moments if m.scene == scene), None)
    documented = bool(moment and moment.documented)
    listed = {e.id for e in manifest.in_scene(story, scene)}
    actors: list[Actor] = []
    for a in sh.actors:
        eid = _slug(a.entity)
        if eid not in listed or eid not in builds or any(x.entity == eid for x in actors):
            continue
        arche = builds[eid].archetype
        holding = _slug(a.holding) if a.holding and _slug(a.holding) in builds and builds[_slug(a.holding)].archetype == "object" else ""
        actors.append(a.model_copy(update={
            "entity": eid, "verb": _verb(a.verb, arche, narration, documented), "state": _state(a.state, narration),
            "face": a.face if a.face in ("camera", "") or _slug(a.face) in listed else "", "holding": holding,
            "to": a.to if a.to in G["places"] else "",
            "count": (max(1, min(9, a.count)) if a.count > 1 else group) if (group := group_size(manifest.entity(story, eid), arche)) > 1 else 1,
        }))
    if moment and moment.entity in builds and moment.entity in listed and not any(x.entity == moment.entity for x in actors):
        arche = builds[moment.entity].archetype
        actors.insert(0, Actor(entity=moment.entity, verb=calm_verb(arche)))
    if not actors:
        return None
    if moment and actors[0].entity != moment.entity:  # the moment's entity leads the scene
        actors.sort(key=lambda a: a.entity != moment.entity)
    aloft = [a.entity for a in actors if builds[a.entity].archetype == "vehicle" and archetype_words(story, a.entity, WINGS)]
    if aloft and not scenes3d.find(narration, LANDED):
        # an aircraft the story hasn't brought down is in the air, and birds beside it fly with it
        actors = [a.model_copy(update={"verb": "fly"}) if (a.entity in aloft and a.verb in G["calm"])
                  or (builds[a.entity].archetype in ("bird", "insect") and a.verb in G["calm"]) else a for a in actors]
    if any(a.verb == "fly" and builds[a.entity].archetype == "vehicle" for a in actors):
        # people are aboard an aircraft in flight, not standing on the ground beneath it
        actors = [a for a in actors if builds[a.entity].archetype != "humanoid"] or actors
    free = [x for x in ("right", "left", "back", "front") if all(a.at != x for a in actors)]
    for i, a in enumerate(actors):
        if i and a.at == actors[0].at and not a.to and free:  # side by side, not inside one another
            actors[i] = a.model_copy(update={"at": free.pop(0)})
    ids = {a.entity for a in actors}
    marks = [m.model_copy(update={"on": _slug(m.on), "to": _slug(m.to) if m.to and _slug(m.to) in ids else "", "color": _hex(m.color, "")})
             for m in sh.marks[:3] if _slug(m.on) in ids and (m.kind not in ("beam", "arrow") or (m.to and _slug(m.to) in ids))]
    ents = {e.id: e for e in story.entities}
    callouts = []
    for c in sh.callouts[:2]:
        on = _slug(c.on)
        text = _callout(c.text, narration, ents.get(on))
        if on in ids and text:
            callouts.append(Callout(on=on, text=text))
    place = _slug(sh.place) if sh.place and _slug(sh.place) in {p.id for p in story.places} else ""
    if not place:
        place = moment.place if moment and moment.place else next((p.id for p in story.places if scene in p.scenes), "")
    on = _slug(sh.on) if sh.on and _slug(sh.on) in ids else actors[0].entity
    return Shot(scene=scene, place=place, time=sh.time, actors=actors[:5], camera=sh.camera, on=on, marks=marks, callouts=callouts)


def rule_shot(script: Script, story: Manifest, builds: dict[str, Build], scene: int, n: int) -> Shot | None:
    """A shot from the manifest alone: the moment's entity doing its motion as a verb of its own body
    plan, the scene's other entities beside it, calm."""
    narration = script.scenes[scene - 1].narration
    moment = next((m for m in story.moments if m.scene == scene), None)
    listed = [e.id for e in manifest.in_scene(story, scene) if e.id in builds]
    lead = moment.entity if moment and moment.entity in builds else (listed[0] if listed else None)
    if lead is None:
        return None
    crew = ("pilot", "captain", "crew", "co-pilot", "first officer", "passenger", "aboard", "flight attendant")
    plane = next((x for x in listed if builds[x].archetype == "vehicle" and archetype_words(story, x, WINGS)), None)
    if plane and builds[lead].archetype == "humanoid" and archetype_words(story, lead, crew):
        lead = plane  # the crew are aboard: show the aircraft doing what they did
    arche = builds[lead].archetype
    motion = moment.motion if moment else "present"
    verb = MOTION_VERB.get(arche, RIGID).get(motion, calm_verb(arche))
    flying = arche == "vehicle" and archetype_words(story, lead, WINGS)
    if arche == "vehicle" and motion in ("move", "approach", "depart"):
        verb = "fly" if flying else "drive" if motion == "move" else verb
    if flying and scenes3d.find(narration, LANDED):
        verb = "present"  # down on the ground or the water
        flying = False
    elif flying and verb == "present":
        verb = "fly"  # an aircraft the story hasn't brought down is still in the air
    if verb not in verbs_for(arche):
        verb = calm_verb(arche)
    verb = _verb(verb, arche, narration, bool(moment and moment.documented))
    if moment and moment.documented and moment.cue and arche in LIVING:  # a verb the moment names outright beats the motion's
        drastic = ("fall", "crash", "collapse") if motion not in ("fall", "shake") else ()
        def named(text: str) -> str | None:  # the told verb whose words come first in the text
            hits = [(min((m.start() for w in G["events"].get(v, [v]) for m in re.finditer(rf"(?<![a-z]){re.escape(w)}", text.lower())), default=10**6), v)
                    for v in verbs_for(arche) if v not in G["calm"] and v not in drastic and told(v, text)]
            return min(hits)[1] if hits else None
        verb = (named(moment.action) if told_in(moment.action, narration) else None) or named(moment.cue) or verb
    at, to = ("far", "center") if motion == "approach" else ("center", "far") if motion == "depart" else ("left", "right") if motion == "move" else ("center", "")
    if verb in G["calm"] and verb in ("present", "idle", "sit", "talk", "work", "pulse", "glow", "sway", "turn", "spin", "peck", "sniff", "look_around"):
        at, to = "center", ""  # staying put
    actors = [Actor(entity=lead, verb=verb, at=at, to=to, count=group_size(manifest.entity(story, lead), arche), state=next((s for s in G["states"] if s != "normal" and scenes3d.find(narration, G["states"][s])), "normal")
                    if arche in LIVING or arche == "vehicle" else "normal")]
    spots = ["right", "left", "back", "front"]
    for k, other in enumerate(x for x in listed if x != lead):
        if len(actors) >= 4:
            break
        oa = builds[other].archetype
        if flying and oa == "humanoid":
            continue  # aboard the aircraft, not standing under it
        if oa == "object" and arche in ("humanoid",) and verb in ("carry", "pick_up", "idle", "walk", "run"):
            actors[0] = actors[0].model_copy(update={"holding": other})
            continue
        calm = "fly" if flying and oa in ("bird", "insect") else calm_verb(oa)
        actors.append(Actor(entity=other, verb=calm, at=spots[k % len(spots)], face=lead, count=group_size(manifest.entity(story, other), oa)))
    place = moment.place if moment and moment.place else next((p.id for p in story.places if scene in p.scenes), "")
    camera = "follow" if to else MOVE_CYCLE[n % len(MOVE_CYCLE)]
    return Shot(scene=scene, place=place, actors=actors, camera=camera, on=lead)


def direct(cfg: Config, script: Script, story: Manifest, builds: dict[str, Build], scenes: list[int], log=print) -> tuple[dict[int, Shot], str]:
    """A shot for each scene in `scenes` (1-based). Returns ({scene: shot}, 'model' or 'rules')."""
    out: dict[int, Shot] = {}
    how = "rules"
    if scenes:
        rows = []
        for k in scenes:
            s = script.scenes[k - 1]
            ents = [e.id for e in manifest.in_scene(story, k) if e.id in builds]
            m = next((x for x in story.moments if x.scene == k), None)
            told_m = f" | moment: {m.entity} {m.action}{' (documented)' if m.documented else ' (illustrative)'}" if m else ""
            place = m.place if m and m.place else next((p.id for p in story.places if k in p.scenes), "")
            rows.append(f"Scene {k}: entities {', '.join(ents)}; place {place or 'none'}{told_m}\n  narration: {s.narration}")
        cast = "\n".join(f"- {b.entity}: {b.archetype}" for b in builds.values())
        user = f"Title: {script.title}\n\nCast:\n{cast}\n\nScenes:\n" + "\n".join(rows)
        guide = DIRECT_GUIDE.format(
            verbs="; ".join(f"{k}: {', '.join(v['verbs'])}" for k, v in G["archetypes"].items()),
            camera="; ".join(f"{k} ({v})" for k, v in G["camera"].items()),
            marks="; ".join(f"{k} ({v})" for k, v in G["marks"].items()))
        try:
            d = llm.structured(cfg, guide, user, Direction, max_tokens=5000)
            for sh in d.shots:
                if sh.scene in scenes and sh.scene not in out:
                    c = checked_shot(sh, script, story, builds, sh.scene)
                    if c is not None:
                        out[sh.scene] = c
            how = "model"
        except Exception as ex:
            log(f"world direction: call failed ({str(ex)[:140]}); blocking scenes from the manifest")
    for n, k in enumerate(scenes):
        r = rule_shot(script, story, builds, k, n)
        if r is None:
            continue
        if k not in out:
            out[k] = r
            continue
        # where the model left the moment's lead standing still but its own words tell an action, act it
        lead, rl = out[k].actors[0], r.actors[0]
        if lead.entity == rl.entity and lead.verb in G["calm"] and rl.verb not in G["calm"]:
            acts = [lead.model_copy(update={"verb": rl.verb, "state": rl.state if lead.state == "normal" else lead.state})] + out[k].actors[1:]
            out[k] = out[k].model_copy(update={"actors": acts})
    # The same camera move twice in a row reads as one long scene: vary the second.
    ordered = sorted(out)
    for a, b in zip(ordered, ordered[1:]):
        if out[a].camera == out[b].camera:
            out[b] = out[b].model_copy(update={"camera": MOVE_CYCLE[(MOVE_CYCLE.index(out[b].camera) + 1) % len(MOVE_CYCLE)] if out[b].camera in MOVE_CYCLE else "orbit"})
    return out, how


# --- the scene's world, for the renderer -----------------------------------------------------------


def world_of(style: str, seed: int, shot: Shot, builds: dict[str, Build], settings: dict[str, Setting], models: dict[str, dict]) -> dict:
    """What the renderer's StoryWorld needs for one scene: the style, the set and every actor with its
    build (or its found model), verb, blocking and state, the camera, the marks and the labels."""
    setting = settings.get(shot.place) if shot.place else None
    if setting is None:
        setting = next(iter(settings.values()), None)
    sett = setting.model_dump() if setting else Setting(place="", kind="grassland", ground="#6f9a4a", sky="#a8cde8", accent="#ffe0a0").model_dump()
    if shot.time:
        sett["time"] = shot.time
    cast = []
    for a in shot.actors:
        b = builds[a.entity]
        entry = a.model_dump() | {"build": b.model_dump()}
        m = models.get(a.entity)
        if m and b.archetype not in LIVING:
            entry["model"] = m  # a found model that genuinely matches draws it; the build stays its fallback
        if a.holding and a.holding in builds:
            entry["held"] = builds[a.holding].model_dump()
        cast.append(entry)
    return {"style": style, "seed": seed, "set": sett, "cast": cast, "camera": shot.camera, "on": shot.on,
            "marks": [m.model_dump() for m in shot.marks], "callouts": [c.model_dump() for c in shot.callouts]}


def record(style: str, builds: dict[str, Build], settings: dict[str, Setting], shots: dict[int, Shot], made: dict, models: dict[str, dict]) -> dict:
    """The video's generation record (world.json): how every asset was made and where it appears."""
    return {
        "style": style,
        "made": made,
        "builds": [b.model_dump() | {
            "source": "found model" if b.entity in models and b.archetype not in LIVING else
                      ("procedural, designed by the model" if made.get("cast") == "model" and b.entity not in made.get("rules_built", []) else "procedural, from the entity's words"),
            "scenes": sorted(k for k, s in shots.items() if any(a.entity == b.entity for a in s.actors)),
        } for b in builds.values()],
        "settings": [s.model_dump() | {"source": "procedural, designed by the model" if made.get("sets") == "model" else "procedural, from the place's words"} for s in settings.values()],
        "shots": {str(k): s.model_dump() for k, s in sorted(shots.items())},
    }
