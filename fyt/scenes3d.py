"""The 3D scene catalog, and the rules that keep a 3D scene true to its narration.

`renderer/src/scenes/world/catalog.json` lists every subject the `world` scene can draw (aircraft,
ships, trains, road vehicles, rockets, spacecraft, cities, landscapes), what each can do, and the words
that point to each. Everything here reads it: the scene models' allowed values, the scriptwriter's
guide, the visual planner (fyt.visualplan) and the guards below. A subject added to the catalog, with
its module registered in `renderer/src/scenes/world/index.tsx`, is open to every later video.

The guards make sure a reconstruction shows only what the fact-checked narration says: an event
(a crash, a sinking, an eruption) is drawn only when the scene's narration names it, and weather,
fire or smoke only when the narration or the research says so. Otherwise the scene shows the subject
doing something neutral (sailing, cruising, a fly-over) and is labelled an illustration.
"""

from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path

CATALOG_PATH = Path(__file__).resolve().parent.parent / "renderer" / "src" / "scenes" / "world" / "catalog.json"


@lru_cache(maxsize=1)
def catalog() -> dict:
    return json.loads(CATALOG_PATH.read_text())


def subjects() -> dict:
    return catalog()["subjects"]


def _union(key: str) -> tuple[str, ...]:
    out: list[str] = []
    for s in subjects().values():
        for k in s[key]:
            if k not in out:
                out.append(k)
    return tuple(out)


SUBJECTS = tuple(catalog()["subjects"])
ACTIONS = _union("actions")
VARIANTS = _union("variants")
OBSTACLES = _union("obstacles")
SHOTS = tuple(catalog()["shots"])
WEATHERS = tuple(catalog()["weather"])
EFFECTS_3D = tuple(catalog()["effects"])


def _pattern(words: list[str]) -> re.Pattern | None:
    # A word or phrase matches at the start of a word: "derail" finds "derailed", "explo" finds "exploded".
    # A word written "=ai" matches only the whole word ("AI", not "aircraft").
    words = [w.strip().lower() for w in words if w.strip()]
    if not words:
        return None
    alts = [re.escape(w[1:]) + r"(?![a-z])" if w.startswith("=") else re.escape(w) for w in sorted(words, key=len, reverse=True)]
    return re.compile(r"(?<![a-z])(" + "|".join(alts) + ")")


@lru_cache(maxsize=None)
def _compiled(key: tuple[str, ...]) -> re.Pattern | None:
    return _pattern(list(key))


def find(text: str, words: list[str]) -> str | None:
    """The first of `words` in `text` (at a word start), as written in the text, or None."""
    p = _compiled(tuple(words))
    if not p or not text:
        return None
    m = p.search(text.lower())
    return text[m.start() : m.end()] if m else None


def count(text: str, words: list[str]) -> int:
    p = _compiled(tuple(words))
    return len(p.findall(text.lower())) if p and text else 0


YEAR = re.compile(
    r"\b(?:in|of|since|by|until|from|during|before|after|around|circa|year|summer|winter|spring|autumn|"
    r"january|february|march|april|may|june|july|august|september|october|november|december)\s+(1[0-9]{3}|20[0-9]{2})\b",
    re.I,
)


def story_year(text: str) -> int | None:
    """The earliest year the story is set in: years said as dates ("in 1518", "July 1518"), so a flight
    number or a count ("Flight 1549", "1,500 people") is not read as one."""
    years = [int(y) for y in YEAR.findall(text)]
    return min(years) if years else None


def variant_for(subject: str, text: str, year: int | None = None) -> str:
    """The variant the words point to; with none named, the one the story's era implies (a city in
    1518 is a historic one), else the subject's first."""
    s = subjects()[subject]
    hits = {v: count(text, words) for v, words in s["variants"].items()}
    best = max(hits, key=hits.get)
    if hits[best]:
        return best
    for before, variant in s.get("by_era", []):
        if year is not None and year < before:
            return variant
    return next(iter(s["variants"]))


def neutral_action(subject: str) -> str:
    acts = subjects()[subject]["actions"]
    return next((a for a, v in acts.items() if v.get("neutral")), next(iter(acts)))


def is_event(subject: str, action: str) -> bool:
    return bool(subjects()[subject]["actions"].get(action, {}).get("event"))


def action_words(subject: str, action: str) -> list[str]:
    return subjects()[subject]["actions"].get(action, {}).get("keywords", [])


def moment(subject: str, action: str) -> float | None:
    return subjects()[subject]["actions"].get(action, {}).get("moment")


def default_shot(subject: str, action: str) -> str | None:
    return subjects()[subject]["actions"].get(action, {}).get("shot")


def guide_text() -> str:
    """The `world` entry of the scriptwriter's scene list, built from the catalog."""
    lines = [
        "- world: a cel-shaded 3D reconstruction of what the narration describes, filmed by a moving camera",
        "  [heading = the subject or moment, e.g. \"RMS Titanic\" or \"Krakatoa\", optional text = place and date,",
        "  subject, variant, action, optional obstacle, shot, setting, optional weather, optional effect",
        "  (smoke, fire, explosion) with effect_x 0-100, cue = the exact words of this scene's narration at",
        "  which the action's key moment happens, subject_name = a short name for the thing shown (the same",
        "  name in every scene that shows the same ship, plane or place, so it looks the same each time)].",
        "  Subjects (variants; actions; obstacles):",
    ]
    for name, s in subjects().items():
        acts = ", ".join(s["actions"])
        obs = f"; obstacles {', '.join(s['obstacles'])}" if s["obstacles"] else ""
        lines.append(f"  * {name}: {s['describe']} (variants {', '.join(s['variants'])}; actions {acts}{obs})")
    lines += [
        "  Shots: " + ", ".join(f"{k} ({v})" for k, v in catalog()["shots"].items()) + ".",
        "  Use world scenes for the moments a viewer should see happen: a launch, a voyage, a collision, an",
        "  eruption, a city burning, a wave coming ashore. Show only what the narration says happened; set",
        "  weather or an effect only when the narration says so. Name the exact object in subject_name when",
        "  the story names it (Titanic, Saturn V, Boeing 747, caffeine): its published features are drawn",
        "  (never a real company's livery or logo). Pair them with map scenes for where, and data scenes for",
        "  how much.",
    ]
    return "\n".join(lines)


def legacy_to_world(scene):
    """An aircraft or ship scene, written before the world scene existed, as a world scene."""
    if scene.type == "aircraft":
        return scene.model_copy(update={"type": "world", "subject": "aircraft", "variant": scene.variant or "airliner",
                                        "action": scene.action or scene.maneuver})
    if scene.type == "ship":
        return scene.model_copy(update={"type": "world", "subject": "ship", "variant": scene.variant or scene.vessel,
                                        "action": scene.action or scene.ship_action})
    return scene


def guard(scene, context: str = ""):
    """A world scene made valid and true to its narration (see the module docstring).

    `context` is the research notes: weather the sources describe may be shown even when this scene's
    narration doesn't mention it (a story that happened on a foggy night).
    """
    scene = legacy_to_world(scene)
    if scene.type != "world":
        return scene
    subject = scene.subject if scene.subject in subjects() else None
    told = " ".join(x for x in (scene.narration, scene.heading or "", scene.text or "") if x)
    if subject is None:
        # Pick the subject the scene talks about most; with nothing to go on, a landscape fly-over.
        scores = {k: count(told, s["keywords"]) for k, s in subjects().items()}
        subject = max(scores, key=scores.get) if max(scores.values()) else "landscape"
    s = subjects()[subject]
    variant = scene.variant if scene.variant in s["variants"] else None
    if variant is None:
        variant = variant_for(subject, told + " " + context[:3000], story_year(told + " " + context))
    action = scene.action if scene.action in s["actions"] else neutral_action(subject)
    # An event is drawn only when this scene's narration names it.
    documented = bool(find(scene.narration, action_words(subject, action)))
    if is_event(subject, action) and not documented:
        action = neutral_action(subject)
    obstacle = scene.obstacle if scene.obstacle in s["obstacles"] else None
    if subject == "space" and obstacle is None:
        obstacle = next((o for o in s["obstacles"] if find(told, [o])), "earth")
    if subject == "ship" and action == "collide" and obstacle is None:
        obstacle = "rocks" if find(told, ["aground", "rocks", "reef"]) else "ship" if find(told, ["ship", "vessel", "ferry"]) else "iceberg"
    weather = scene.weather if scene.weather in WEATHERS else None
    if weather and weather != "clear" and not (find(told, catalog()["weather"][weather]) or find(context, catalog()["weather"][weather])):
        weather = None
    effect = scene.effect if scene.effect in EFFECTS_3D else None
    if effect and not find(scene.narration, catalog()["effects"][effect]):
        effect = None
    setting = scene.setting if scene.setting in s["settings"] else (s["settings"][0] if s["settings"] else None)
    shot = scene.shot if scene.shot in SHOTS else default_shot(subject, action)
    cue = scene.cue if scene.cue and scene.cue.lower() in scene.narration.lower() else None
    if cue is None and documented and (is_event(subject, action) or moment(subject, action) is not None):
        cue = find(scene.narration, action_words(subject, action))
    return scene.model_copy(update={
        "subject": subject, "variant": variant, "action": action, "obstacle": obstacle, "weather": weather,
        "effect": effect, "setting": setting, "shot": shot, "cue": cue,
        # A scene that shows what its narration says happened is a reconstruction; one that shows the
        # subject doing something neutral is an illustration, and says so on screen.
        # A conceptual subject (a neural network, a chip) is always a diagram of the idea, never the real thing.
        "illustrative": bool(s.get("conceptual")) or not (documented and not s["actions"][action].get("neutral")),
        "maneuver": None, "vessel": None, "ship_action": None,
    })
