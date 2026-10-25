"""The scene director: turns each 3D story-world scene from a blocking into a directed sequence.

fyt.worldgen designs the cast, the places and a blocking for every stage scene (who is there, which verb
each one plays, where they stand). That says what happens; it doesn't say how a film shows it. This
module adds the direction every scene needs before the renderer draws it, all from rules, so it costs
nothing and runs the same with or without a model:

1. art: one art-style profile for the whole video (cinematic stylised, inked graphic novel, or stencil /
   cutout), picked from the story (``choose_art``). A profile is not a filter: it sets the materials,
   the light rig, how dense and how simplified the set is, the animation timing, the lens and the
   finishing passes together (renderer/src/scenes/world/storyworld/artstyle.ts).
2. recipe: how the place is built in layers (``recipe_for``): foreground cover that frames the shot,
   mid-ground clusters, the far horizon, mist between the layers, wind in the vegetation, drifting
   particles and background life, so a marsh is reed beds, tidal pools and gulls rather than a plane.
3. light: the lighting setup for the time, the weather the place's words name and the story's mood.
4. acts: what each actor does besides its verb (``plan_actions``): who it looks at, a gesture (aiming a
   camera, pointing, talking with its hands), the prop in its hands and what it is aimed at, and how
   the others react at the scene's moment. Nobody stands like a statue.
5. shots: the camera choreography (``plan_camera``): an establishing shot the first time a place is
   seen, the action covered as it happens, cuts on the narrator's words to a reveal, an over-the-
   shoulder or an insert of the prop, and a reaction shot.

It also fixes casting the design got wrong (``fix_cast``): a person is always a person (Jim Templeton
was drawn as a building because "Templeton" contains "temple"), a garment the story names is worn by
its owner in its colour instead of standing on the set as a box, and a child has a child's proportions.

The direction is written into each scene's world as ``direction``; cue words are timed to the voice
with the beats (fyt.timeline.timed_world). Nothing here invents an event: gestures and looks are calm
actions, and anything dramatic still comes only from verbs the narration's guards allowed.
"""

from __future__ import annotations

import re
import zlib

from fyt import manifest, worldgen
from fyt.manifest import Manifest
from fyt.models import Script
from fyt.worldgen import Build, Setting, Shot

# --- art style profiles -----------------------------------------------------------------------------

PROFILES = ("cinematic", "ink", "stencil")

# Words that call for each profile. A story is scored by how many of each its title and narration use;
# the cinematic look is the default and wins ties, so a profile is only chosen when the story asks for it.
INK_WORDS = ("mystery", "mysterious", "unexplained", "unsolved", "hoax", "murder", "crime", "criminal", "detective", "police",
             "investigat", "case", "spaceman", "ufo", "alien", "ghost", "haunt", "conspiracy", "disappear", "vanish", "legend",
             "curse", "strange", "bizarre", "weird", "photograph", "photo", "witness", "suspect", "trial", "secret", "spy")
STENCIL_WORDS = ("war", "revolution", "propaganda", "regime", "protest", "riot", "empire", "coup", "assassinat", "dictator",
                 "cult", "rebellion", "uprising", "cold war", "soviet", "nazi", "occupation", "massacre", "anomaly", "censor",
                 "political", "election", "strike", "prison", "execution", "manifesto")
CINEMATIC_WORDS = ("animal", "bear", "forest", "ocean", "ship", "aircraft", "plane", "flight", "train", "volcano", "storm",
                   "space", "rocket", "planet", "science", "cell", "river", "mountain", "journey", "expedition", "nature")

# Lighting and atmosphere moods (the art direction's "lighting and atmosphere" setting).
ATMOSPHERES = ("natural", "dramatic", "dreamlike", "graphic")

# The palettes a stencil print is pulled in: paper, the two inks and the story's accent. A stencil look
# keeps the channel's red thread as its accent unless the story's place gives one.
STENCIL_PALETTES = {
    "night": ["#e9e1cf", "#2b3a4a", "#121418", "#d23a2c"],
    "warm": ["#efe4cc", "#8a5a3a", "#1b1612", "#d23a2c"],
    "cold": ["#e6e6de", "#5b6e78", "#14181c", "#d23a2c"],
    "green": ["#ece6d0", "#5e6e4a", "#161812", "#d23a2c"],
}


def _score(text: str, words: tuple[str, ...]) -> int:
    return sum(len(re.findall(rf"(?<![a-z]){re.escape(w)}", text)) for w in words)


def choose_art(script: Script, story: Manifest | None, style: str = "auto", strength: float = 0.75, detail: float = 0.8,
               atmosphere: str = "auto") -> dict:
    """The video's art direction: which profile, how strong, how detailed, and the light's mood."""
    text = " ".join([script.title, script.description or ""] + [s.narration for s in script.scenes]).lower()
    if story:
        text += " " + " ".join(f"{e.name} {e.kind} {e.look}" for e in story.entities).lower()
    scores = {"ink": _score(text, INK_WORDS), "stencil": _score(text, STENCIL_WORDS), "cinematic": _score(text, CINEMATIC_WORDS)}
    if style in PROFILES:
        profile = style
    else:
        best = max(("ink", "stencil"), key=lambda p: scores[p])
        profile = best if scores[best] >= 2 and scores[best] > scores["cinematic"] else "cinematic"
    if atmosphere not in ATMOSPHERES:
        mood = (script.mood or "").lower()
        atmosphere = ("graphic" if profile == "stencil" else "dramatic" if profile == "ink" or mood in ("somber", "tense", "dark")
                      else "dreamlike" if mood in ("wonder", "awe", "whimsical", "nostalgic") else "natural")
    return {"profile": profile, "strength": round(max(0.0, min(1.0, strength)), 2), "detail": round(max(0.2, min(1.0, detail)), 2),
            "atmosphere": atmosphere, "scores": scores}


def palette_for(profile: str, settings: dict[str, Setting]) -> list[str]:
    """A stencil's four inks, from the video's main place: its time of day and the colour of its ground."""
    s = next(iter(settings.values()), None)
    if profile != "stencil" or s is None:
        return []
    if s.time == "night" or s.kind in ("space", "underwater", "cave"):
        return STENCIL_PALETTES["night"]
    r, g, b = (int(s.ground[i:i + 2], 16) for i in (1, 3, 5))
    if g > r and g > b:
        return STENCIL_PALETTES["green"]
    return STENCIL_PALETTES["warm"] if r >= b else STENCIL_PALETTES["cold"]


# --- environment recipes ----------------------------------------------------------------------------

# How each kind of place is built in layers. fore: the cover the camera looks through at the frame's
# edges; mid: what clusters round the action; far: what makes the horizon; mist 0-1 between the layers;
# wind 0-1 in grass, reeds and leaves; particles drifting in the air; life in the background; wet 0-1
# for pools and shine on the ground. The renderer's environment.tsx draws the kind itself; these layers
# go on top (renderer/src/scenes/world/storyworld/layers.tsx).
RECIPES: dict[str, dict] = {
    "marsh": {"fore": ["reeds", "grass"], "mid": ["reeds", "pools", "posts"], "far": ["water", "low_hills"], "mist": 0.55, "wind": 0.7,
              "particles": "none", "life": ["gulls"], "wet": 0.8},
    "swamp": {"fore": ["reeds", "ferns"], "mid": ["reeds", "pools", "logs"], "far": ["trees"], "mist": 0.7, "wind": 0.3,
              "particles": "spores", "life": ["birds"], "wet": 0.9},
    "forest": {"fore": ["ferns", "grass"], "mid": ["logs", "rocks", "flowers"], "far": ["trees"], "mist": 0.45, "wind": 0.35,
               "particles": "pollen", "life": ["birds"], "wet": 0.1, "shafts": True},
    "grassland": {"fore": ["grass", "flowers"], "mid": ["rocks", "flowers"], "far": ["low_hills"], "mist": 0.2, "wind": 0.6,
                  "particles": "pollen", "life": ["birds"], "wet": 0.0},
    "farm": {"fore": ["grass"], "mid": ["fence", "hay"], "far": ["low_hills"], "mist": 0.2, "wind": 0.5, "particles": "pollen",
             "life": ["birds"], "wet": 0.0},
    "mountain": {"fore": ["rocks", "grass"], "mid": ["rocks"], "far": ["peaks"], "mist": 0.5, "wind": 0.5, "particles": "none",
                 "life": ["birds"], "wet": 0.0},
    "snow": {"fore": ["snow_drift", "rocks"], "mid": ["rocks"], "far": ["peaks"], "mist": 0.4, "wind": 0.4, "particles": "snow",
             "life": [], "wet": 0.0},
    "desert": {"fore": ["rocks", "scrub"], "mid": ["rocks", "scrub"], "far": ["mesas"], "mist": 0.25, "wind": 0.3, "particles": "dust",
               "life": [], "wet": 0.0},
    "beach": {"fore": ["grass", "rocks"], "mid": ["debris"], "far": ["water"], "mist": 0.3, "wind": 0.5, "particles": "spray",
              "life": ["gulls"], "wet": 0.4},
    "river": {"fore": ["reeds", "grass"], "mid": ["rocks", "reeds"], "far": ["trees"], "mist": 0.4, "wind": 0.35, "particles": "pollen",
              "life": ["birds"], "wet": 0.5},
    "lake": {"fore": ["reeds", "grass"], "mid": ["rocks"], "far": ["trees"], "mist": 0.45, "wind": 0.3, "particles": "none",
             "life": ["birds"], "wet": 0.5},
    "sea": {"fore": [], "mid": [], "far": ["water"], "mist": 0.35, "wind": 0.6, "particles": "spray", "life": ["gulls"], "wet": 1.0},
    "town": {"fore": ["debris"], "mid": ["street_props"], "far": ["roofs"], "mist": 0.25, "wind": 0.2, "particles": "dust",
             "life": ["birds"], "wet": 0.1},
    "village": {"fore": ["grass", "debris"], "mid": ["street_props"], "far": ["roofs"], "mist": 0.3, "wind": 0.3, "particles": "dust",
                "life": ["birds"], "wet": 0.1},
    "castle": {"fore": ["grass", "rocks"], "mid": ["street_props"], "far": ["low_hills"], "mist": 0.35, "wind": 0.35, "particles": "dust",
               "life": ["birds"], "wet": 0.1},
    "city": {"fore": ["debris"], "mid": ["street_props"], "far": ["towers"], "mist": 0.3, "wind": 0.15, "particles": "dust",
             "life": ["birds"], "wet": 0.2},
    "road": {"fore": ["grass"], "mid": ["posts"], "far": ["low_hills"], "mist": 0.2, "wind": 0.4, "particles": "dust", "life": ["birds"], "wet": 0.0},
    "railway": {"fore": ["grass"], "mid": ["posts"], "far": ["low_hills"], "mist": 0.25, "wind": 0.4, "particles": "dust", "life": ["birds"], "wet": 0.0},
    "airfield": {"fore": ["grass"], "mid": ["posts"], "far": ["low_hills"], "mist": 0.2, "wind": 0.5, "particles": "none", "life": ["birds"], "wet": 0.0},
    "cave": {"fore": ["rocks"], "mid": ["rocks"], "far": [], "mist": 0.5, "wind": 0.0, "particles": "dust", "life": [], "wet": 0.3},
    "underwater": {"fore": ["weed"], "mid": ["rocks", "weed"], "far": [], "mist": 0.6, "wind": 0.5, "particles": "bubbles", "life": [], "wet": 0.0},
    "sky": {"fore": [], "mid": [], "far": [], "mist": 0.3, "wind": 0.0, "particles": "none", "life": [], "wet": 0.0},
    "space": {"fore": [], "mid": [], "far": [], "mist": 0.0, "wind": 0.0, "particles": "none", "life": [], "wet": 0.0},
    "micro": {"fore": [], "mid": [], "far": [], "mist": 0.3, "wind": 0.0, "particles": "none", "life": [], "wet": 0.0},
}
INSIDE = ("room", "hall", "lab", "hospital", "factory", "shop", "station")
INTERIOR = {"fore": [], "mid": ["clutter"], "far": [], "mist": 0.15, "wind": 0.0, "particles": "dust", "life": [], "wet": 0.0}

# Words in a place's look that change its air and its light.
WEATHER = {
    "overcast": ("overcast", "grey sky", "gray sky", "cloudy", "dull", "drizzle", "damp", "1960s light", "1964 light", "flat light"),
    "fog": ("fog", "mist", "misty", "foggy", "haze", "hazy"),
    "rain": ("rain", "storm", "wet weather", "downpour"),
    "clear": ("sunny", "clear sky", "bright", "sunlit", "summer"),
}


def recipe_for(setting: Setting, place: manifest.Place | None, detail: float = 0.8) -> dict:
    """The place's layers, from its kind, and its mist and wetness from the words describing it."""
    base = dict(INTERIOR if setting.kind in INSIDE else RECIPES.get(setting.kind, RECIPES["grassland"]))
    words = f"{place.name} {place.look}".lower() if place else ""
    if any(w in words for w in WEATHER["fog"]):
        base["mist"] = max(base["mist"], 0.75)
    if any(w in words for w in WEATHER["overcast"]):
        base["mist"] = max(base["mist"], 0.45)
    if any(w in words for w in WEATHER["rain"]):
        base["wet"] = max(base["wet"], 0.7)
    base["density"] = round(detail, 2)
    return base


def lighting_for(setting: Setting, place: manifest.Place | None, atmosphere: str, mood: str = "") -> dict:
    """The lighting setup: a named rig (overcast, golden, hard_sun, moonlit, interior) and how its key,
    fill and rim are balanced for the art direction's atmosphere."""
    words = f"{place.name} {place.look}".lower() if place else ""
    if setting.kind in INSIDE or setting.kind == "cave":
        rig = "interior"
    elif setting.time == "night":
        rig = "moonlit"
    elif setting.time in ("dusk", "dawn"):
        rig = "golden"
    elif any(w in words for w in WEATHER["overcast"] + WEATHER["fog"] + WEATHER["rain"]):
        rig = "overcast"
    else:
        rig = "hard_sun"
    balance = {"natural": (1.0, 1.0, 1.0, 1.0), "dramatic": (1.2, 0.65, 1.6, 1.25), "dreamlike": (0.9, 1.15, 1.2, 0.85),
               "graphic": (1.3, 0.5, 1.4, 1.5)}[atmosphere if atmosphere in ATMOSPHERES else "natural"]
    if mood in ("somber", "tense"):
        balance = (balance[0], balance[1] * 0.85, balance[2], balance[3] * 1.1)
    key, fill, rim, contrast = balance
    return {"rig": rig, "key": key, "fill": fill, "rim": rim, "contrast": contrast}


# --- casting fixes ----------------------------------------------------------------------------------

GARMENTS = ("dress", "gown", "coat", "jacket", "shirt", "blouse", "skirt", "suit", "uniform", "cloak", "robe", "hat", "scarf",
            "sweater", "jumper", "overalls", "raincoat", "apron")
CHILD_WORDS = ("child", "girl", "boy", "daughter", "son", "kid", "toddler", "baby", "infant", "five-year-old", "year-old")
_AGE = re.compile(r"\b(\d{1,2})[\s‑-]*year[\s‑-]*old\b")


def is_garment(e: manifest.Entity | None) -> bool:
    if e is None:
        return False
    text = f"{e.name} {e.kind} {' '.join(e.search)}".lower()
    return worldgen.archetype_of(e) == "object" and any(worldgen._has(text, w) for w in GARMENTS + ("clothing", "garment"))


def wearer_of(garment: manifest.Entity, story: Manifest, builds: dict[str, Build]) -> str | None:
    """Who wears a garment: the person whose look names it, else the one sharing the most of its scenes."""
    nouns = [w for w in re.findall(r"[a-z]+", garment.name.lower()) if w in GARMENTS] or [garment.name.lower()]
    colours = set(worldgen.colours_in(f"{garment.name} {garment.look}"))
    people = [e for e in story.entities if e.id in builds and builds[e.id].archetype == "humanoid"]
    # the person whose look names the garment in its colour ("blue dress"), else names the garment at all
    score = lambda e: (2 * any(worldgen._has(e.look.lower(), n) for n in nouns) * bool(colours & set(worldgen.colours_in(e.look)))  # noqa: E731
                       + any(worldgen._has(e.look.lower(), n) for n in nouns), len(set(e.scenes) & set(garment.scenes)))
    best = max(people, key=score, default=None)
    if best is not None and score(best)[0] > 0:
        return best.id
    shared = sorted(people, key=lambda e: -len(set(e.scenes) & set(garment.scenes)))
    return shared[0].id if shared and set(shared[0].scenes) & set(garment.scenes) else None


def is_child(e: manifest.Entity | None, b: Build) -> bool:
    if b.archetype != "humanoid":
        return False
    if b.body.age == "child":
        return True
    if e is None:
        return False
    text = f"{e.name} {e.kind} {e.look} {' '.join(e.search)}".lower()
    age = _AGE.search(text.replace("‑", "-"))
    if age:
        return int(age.group(1)) < 13
    return any(worldgen._has(text, w) for w in CHILD_WORDS) and not any(worldgen._has(text, w) for w in ("adult", "woman", "man", "teen"))


def fix_cast(builds: dict[str, Build], story: Manifest) -> tuple[dict[str, Build], dict[str, str]]:
    """Builds with the casting the design got wrong put right. Returns (builds, {garment id: wearer id})."""
    out = dict(builds)
    worn: dict[str, str] = {}
    for eid, b in builds.items():
        e = manifest.entity(story, eid)
        if e is None:
            continue
        if worldgen.is_person(e) and b.archetype != "humanoid":
            out[eid] = worldgen.rule_build(e, worldgen._seed(eid))
            b = out[eid]
        if is_child(e, b):
            out[eid] = b.model_copy(update={"size": min(b.size, 1.2), "body": b.body.model_copy(update={"age": "child"})})
    for eid, b in list(out.items()):
        e = manifest.entity(story, eid)
        if not is_garment(e):
            continue
        who = wearer_of(e, story, out)
        if who is None:
            continue
        worn[eid] = who
        w = out[who]
        colours = worldgen.colours_in(f"{e.name} {e.look}")
        noun = next((n for n in GARMENTS if worldgen._has(f"{e.name} {e.kind}".lower(), n)), "")
        outfit = w.outfit.model_copy(update={"top": "dress" if noun in ("dress", "gown") else w.outfit.top}) if w.outfit else w.outfit
        out[who] = w.model_copy(update={"primary": colours[0] if colours else b.primary, "outfit": outfit})
    return out, worn


def drop_worn(shots: dict[int, Shot], worn: dict[str, str]) -> dict[int, Shot]:
    """Shots without the garments as actors of their own: their wearer wears them."""
    if not worn:
        return shots
    out = {}
    for k, sh in shots.items():
        actors = [a for a in sh.actors if a.entity not in worn]
        if not actors:
            out[k] = sh
            continue
        actors = [a.model_copy(update={"holding": ""}) if a.holding in worn else a for a in actors]
        beats = [bt.model_copy(update={"actors": [a for a in bt.actors if a.entity not in worn]}) for bt in sh.beats]
        on = worn.get(sh.on, sh.on)
        out[k] = sh.model_copy(update={"actors": actors, "on": on if any(a.entity == on for a in actors) else actors[0].entity,
                                       "beats": [bt for bt in beats if bt.actors],
                                       "marks": [m for m in sh.marks if m.on not in worn and m.to not in worn],
                                       "callouts": [c for c in sh.callouts if c.on not in worn]})
    return out


# --- actions ----------------------------------------------------------------------------------------

# What a narration's words make a person do with what they hold or see (calm actions: they show how a
# documented thing was done, never a new event). Each: words, gesture, and whether it needs a prop.
GESTURES: list[tuple[str, tuple[str, ...], bool]] = [
    ("aim", ("snapped", "photograph", "picture", "pictures", "photo", "filmed", "filming", "camera", "took a shot", "shot of"), True),
    ("point", ("pointed", "pointing", "spotted", "noticed", "showed", "there it was"), False),
    ("talk", ("said", "says", "told", "explained", "wrote", "asked", "replied", "insisted", "claimed", "recalled"), False),
    ("look", ("saw", "seen", "looked", "watched", "stared", "noticed", "glimpsed", "spotted", "looms", "loomed"), False),
    ("wave", ("waved", "signalled", "signaled", "beckoned"), False),
    ("hold", ("held", "holding", "carried", "clutching", "gripped"), True),
]
REVEAL = ("saw", "noticed", "appeared", "appears", "looms", "loomed", "revealed", "reveal", "figure", "shape", "spotted", "discovered",
          "found", "glimpsed", "emerged", "behind")
INTO_FRAME = ("into the shot", "into the frame", "into the picture", "into view", "into shot", "behind her", "behind him", "behind them",
              "in the background", "standing behind", "walked behind")
PROP_WORDS = ("camera", "phone", "torch", "flashlight", "lantern", "gun", "rifle", "binocular", "map", "letter", "book", "radio",
              "bag", "box", "briefcase", "bottle", "notebook", "tool", "umbrella")


def _entity_named(narration: str, e: manifest.Entity) -> int:
    """Where the narration names the entity (its id, name or a search term), or -1."""
    low = narration.lower()
    names = [e.name.lower(), e.id.replace("-", " "), *[s.lower() for s in e.search]]
    hits = [i for n in names if n and (i := low.find(n)) >= 0]
    # a person's role word ("his daughter", "his wife") names them too
    return min(hits) if hits else -1


LABEL = re.compile(r"^\s*[^.:!?]{1,40}:\s+")  # a scene's heading ("The Photo: ...") is not what anyone does


def _gesture(text: str) -> tuple[str, str] | None:
    """The first gesture the text names: (gesture, the words that named it)."""
    text = LABEL.sub(lambda m: " " * len(m.group(0)), text)
    low = text.lower()
    hits = []
    for g, words, _ in GESTURES:
        for w in words:
            m = re.search(rf"(?<![a-z]){re.escape(w)}", low)
            if m:
                hits.append((m.start(), g, text[m.start():m.start() + len(w)]))
    return (min(hits)[1], min(hits)[2]) if hits else None


def plan_actions(sh: Shot, narration: str, story: Manifest, builds: dict[str, Build]) -> tuple[Shot, dict[str, dict]]:
    """Each actor's acts beyond its verb, and the blocking the acts need. Returns (shot, {entity: act})."""
    acts: dict[str, dict] = {}
    living = [a for a in sh.actors if builds.get(a.entity) and builds[a.entity].archetype in worldgen.LIVING]
    people = [a for a in living if builds[a.entity].archetype == "humanoid"]
    ents = {a.entity: manifest.entity(story, a.entity) for a in sh.actors}
    named = sorted(((i, a.entity) for a in sh.actors if ents[a.entity] and (i := _entity_named(narration, ents[a.entity])) >= 0))
    actors = list(sh.actors)
    low = narration.lower()
    g = _gesture(narration)
    # who does the scene's gesture: a person the narration names before the words of the gesture (in
    # "Clarke explained that the camera ... the photographer's view" the photographer explains nothing)
    at = narration.lower().find(g[1].lower()) if g else -1
    doer = next((e for i, e in named if e in {p.entity for p in people} and i < at), None)
    def prop_like(eid: str) -> bool:
        e = manifest.entity(story, eid)
        return eid in builds and builds[eid].archetype == "object" and any(worldgen._has(f"{e.name if e else eid} {eid}".lower(), w) for w in PROP_WORDS)
    props = [x for x in dict.fromkeys([a.holding for a in sh.actors if a.holding] + [a.entity for a in sh.actors]) if prop_like(x)]
    if doer and g:
        gesture, cue = g
        needs_prop = next(n for name, _, n in GESTURES if name == gesture)
        prop = props[0] if props else ""
        if needs_prop and not prop:
            gesture = "look" if gesture == "aim" else gesture
        # what it is aimed at, pointed at or told to: the other living actor the narration names first,
        # else the nearest other living actor
        target = next((e for _, e in named if e != doer and e in {x.entity for x in living}), "")
        target = target or next((x.entity for x in living if x.entity != doer), "")
        act: dict = {"gesture": gesture, "cue": cue} if target or gesture != "look" else {}
        if target:
            act["look"] = target
        if gesture in ("aim", "hold") and prop:
            act["prop"] = prop
            actors = [a.model_copy(update={"holding": prop}) if a.entity == doer else a for a in actors]
        acts[doer] = act
        if gesture in ("aim", "talk", "point") and target:
            # the doer faces what they act on, and stands still to do it (a photographer doesn't walk
            # while taking the picture)
            actors = [a.model_copy(update={"face": target, "verb": "idle" if a.verb in ("walk", "run", "look_around") else a.verb,
                                           "to": "" if a.verb in ("walk", "run", "look_around") else a.to})
                      if a.entity == doer else a for a in actors]
    # a held prop is in the doer's hands, not standing on the set beside them
    held = {a.holding for a in actors if a.holding}
    actors = [a for a in actors if a.entity not in held] or actors
    # walking "into the shot" or "behind" someone: the walker comes in behind the others
    walker = next((a.entity for a in actors if a.verb in ("walk", "run") and builds[a.entity].archetype == "humanoid" and a.entity != doer), None)
    alive = {p.entity for p in living}
    if walker and any(w in low for w in INTO_FRAME) and len(actors) > 1:
        actors = [a.model_copy(update={"at": "left", "to": "back"}) if a.entity == walker else a for a in actors]
        acts.setdefault(walker, {})["look"] = next((a.entity for a in actors if a.entity != walker and a.entity in alive), "camera")
    # a figure seen standing behind someone: whoever is neither the doer nor what they act on stands back
    revealed = ""
    if any(w in low for w in ("shape", "figure", "behind", "background")):
        aimed = acts.get(doer or "", {}).get("look", "")
        # (only round someone being photographed, filmed or looked at: alone, nobody is behind anyone)
        revealed = next((a.entity for a in actors if a.entity in alive and a.entity not in (doer, aimed)), "") if aimed else ""
        if revealed and not walker:
            actors = [a.model_copy(update={"at": "back", "to": "", "face": aimed or a.face}) if a.entity == revealed else a for a in actors]
        if revealed:
            acts.setdefault(revealed, {})["revealed"] = True
    # everyone else alive watches whoever acts, and turns to the moment when it comes
    lead = doer or (actors[0].entity if actors else None)
    for a in actors:
        if a.entity not in {x.entity for x in living} or a.entity == lead:
            continue
        act = acts.setdefault(a.entity, {})
        if "look" not in act:
            act["look"] = lead or ""
        act.setdefault("secondary", "react" if any(w in low for w in REVEAL) else "idle_shift")
    for a in actors:
        if a.entity in {x.entity for x in living}:
            acts.setdefault(a.entity, {}).setdefault("secondary", "idle_shift")
    # children are drawn as children
    for a in actors:
        if builds[a.entity].archetype == "humanoid" and builds[a.entity].body.age == "child":
            acts.setdefault(a.entity, {})["child"] = True
    return sh.model_copy(update={"actors": actors}), {k: v for k, v in acts.items() if v}


# --- camera choreography ----------------------------------------------------------------------------

def _first_cue(narration: str, words: tuple[str, ...]) -> str:
    low = narration.lower()
    hits = [(m.start(), m.end()) for w in words for m in [re.search(rf"(?<![a-z]){re.escape(w)}", low)] if m]
    if not hits:
        return ""
    s, e = min(hits)
    return narration[s:e]


def plan_camera(sh: Shot, narration: str, story: Manifest, builds: dict[str, Build], acts: dict[str, dict], first_at_place: bool,
                seed: int) -> list[dict]:
    """The scene's shots, in order: each a camera move, the entity it frames and the words it cuts on
    (the first shot has none). The renderer holds each shot at least a second and a half."""
    if not sh.actors:
        return []
    lead = sh.on or sh.actors[0].entity
    living = [a.entity for a in sh.actors if builds[a.entity].archetype in worldgen.LIVING]
    moving = sh.actors[0].verb in ("walk", "run", "fly", "swim", "drive", "move", "approach", "depart", "carry") or bool(sh.actors[0].to)
    shots: list[dict] = []
    # opening: the place first the first time it is seen; travel tracked; otherwise the actor's own move
    if first_at_place and builds[lead].archetype not in ("cell",):
        shots.append({"move": "aerial" if sh.camera == "aerial" else "establish", "on": lead})
    elif moving:
        shots.append({"move": "track", "on": lead})
    else:
        shots.append({"move": sh.camera if sh.camera not in ("aerial",) else "establish", "on": lead})
    # the beats the blocking already has cut where their words are
    for bt in sh.beats:
        shots.append({"move": bt.camera, "on": bt.on or bt.actors[0].entity, "cue": bt.cue})
    # the gesture: an over-the-shoulder from whoever aims, points or talks, onto what they act on
    for who, act in acts.items():
        if act.get("gesture") in ("aim", "point", "talk") and act.get("look") and act.get("cue"):
            shots.append({"move": "over_shoulder", "on": act["look"], "from_": who, "cue": act["cue"]})
            if act.get("prop") and act["gesture"] == "aim":
                shots.insert(len(shots) - 1, {"move": "insert", "on": who, "prop": act["prop"], "cue": act["cue"]})
            break
    # a reveal: the thing seen, pushed in on, at the words that reveal it
    reveal = _first_cue(LABEL.sub(lambda m: " " * len(m.group(0)), narration), REVEAL)
    if reveal:
        target = next((e for e, a in acts.items() if a.get("revealed")), "") or lead
        shots.append({"move": "reveal" if target != lead else "push_in", "on": target, "cue": reveal})
    # a reaction: someone else alive, looking at the lead, near the end of a scene with company
    framed = {s["on"] for s in shots}
    others = [e for e in living if e != lead and e not in framed] or [e for e in living if e != lead and e != shots[-1]["on"]]
    if others and not any(s["move"] == "reaction" for s in shots):
        shots.append({"move": "reaction", "on": others[zlib.crc32(f"{seed}{lead}".encode()) % len(others)], "at": 0.78})
    # shots in narration order: cues where the narration says them, fixed points where they fall
    def where(s: dict) -> float:
        if "cue" in s:
            i = narration.lower().find(s["cue"].lower())
            return i / max(1, len(narration)) if i >= 0 else 0.5
        return s.get("at", 0.0)
    head, rest = shots[0], sorted(shots[1:], key=where)
    out = [head]
    for s in rest:
        if abs(where(s) - where(out[-1])) < 0.12 and out[-1] is not head:
            continue  # two cuts on top of one another: keep the first
        if where(s) < 0.1:
            continue
        out.append(s)
    return out[:5]


# --- the whole direction ----------------------------------------------------------------------------

def direct(script: Script, story: Manifest, builds: dict[str, Build], settings: dict[str, Setting], shots: dict[int, Shot],
           art: dict, worn: dict[str, str] | None = None) -> tuple[dict[int, Shot], dict[int, dict]]:
    """Every staged scene's direction. Returns (shots with the blocking the acts need, {scene: direction}).
    A person who wears a garment of the story's, or whose own look names a colour, has their outfit
    painted in their build's colour (a library outfit keeps its own otherwise)."""
    painted = set((worn or {}).values()) | {e.id for e in story.entities if worldgen.is_person(e) and worldgen.colours_in(e.look)}
    places = {p.id: p for p in story.places}
    seen: set[str] = set()
    out_shots, out = {}, {}
    seed = worldgen._seed(script.title)
    palette = palette_for(art["profile"], settings)
    for k in sorted(shots):
        sh = shots[k]
        narration = script.scenes[k - 1].narration
        sh, acts = plan_actions(sh, narration, story, builds)
        for a in sh.actors:
            if a.entity in painted and a.entity in builds:
                acts[a.entity] = acts.get(a.entity, {}) | {"paint": builds[a.entity].primary}
        setting = settings.get(sh.place) or next(iter(settings.values()), None)
        place = places.get(sh.place)
        first = bool(sh.place) and sh.place not in seen
        seen.add(sh.place)
        cam = plan_camera(sh, narration, story, builds, acts, first, seed + k)
        d = {"art": {k2: v for k2, v in art.items() if k2 != "scores"} | ({"palette": palette} if palette else {}), "acts": acts, "shots": cam}
        if setting is not None:
            d["recipe"] = recipe_for(setting, place, art.get("detail", 0.8))
            d["light"] = lighting_for(setting, place, art.get("atmosphere", "natural"), script.mood or "")
        out_shots[k] = sh
        out[k] = d
    return out_shots, out


def summary(directions: dict[int, dict]) -> str:
    """One log line: the profile and, per scene, its shots and who does what."""
    if not directions:
        return "no staged scenes"
    art = next(iter(directions.values()))["art"]
    parts = []
    for k, d in sorted(directions.items()):
        shots = "/".join(s["move"] for s in d.get("shots", []))
        gest = ", ".join(f"{e} {a['gesture']}" for e, a in d.get("acts", {}).items() if a.get("gesture"))
        parts.append(f"scene {k}: {shots}" + (f" ({gest})" if gest else ""))
    return f"{art['profile']} ({art['atmosphere']}, strength {art['strength']}); " + "; ".join(parts)
