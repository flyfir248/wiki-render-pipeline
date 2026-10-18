"""The story's asset manifest: what the fact-checked script is about, read before any picture is chosen.

One model call reads the finished script and lists the things a viewer will see: each entity (the
bear, the smuggler's plane, the DNA helix), what it looks like and the words a 3D model library would
file it under; the places the story happens in; and the moments that can be shown, with the narration
words they rest on and whether the story says they happened or they are only illustrative.

Everything visual after this works from the manifest rather than from what the renderer happens to
offer: a 3D scene shows a manifest entity or it is not made (fyt.visualplan), every entity is resolved
to one model for the whole video (fyt.assetlib) and every painted picture draws it the same way
(fyt.storyboard's cast sheet). The guards here keep the model's reading honest: an entity must be named
in the scenes it is listed in, and a moment is documented only when its words are in the narration.
"""

from __future__ import annotations

import json
import re
from typing import Literal

from pydantic import BaseModel, Field

from fyt import llm
from fyt.config import Config
from fyt.models import Script

# How a thing moves in a shot. A motion grammar the 3D stage can perform with any model, not a list of
# things: a bear, a ferry and a satellite can all approach, rise or fall.
Motion = Literal["present", "move", "approach", "depart", "rise", "fall", "turn", "shake"]
MOTIONS: tuple[str, ...] = Motion.__args__  # type: ignore[attr-defined]


class Entity(BaseModel):
    id: str = Field(description="Short lowercase id, e.g. 'bear', 'smuggler-plane'.")
    name: str = Field(description="What the story calls it, e.g. 'the bear', 'a Cessna 404'.")
    kind: str = Field(description="What sort of thing, 1-3 words: 'animal', 'light aircraft', 'molecule', 'person'.")
    search: list[str] = Field(
        description="1-3 search terms a 3D model library would file it under, most specific first, plain "
        "common nouns: ['american black bear', 'black bear', 'bear']."
    )
    look: str = Field(description="How it looks, max 25 words: species or make, colour, size, era, distinctive details.")
    certain: bool = Field(description="True when the sources say what it looked like; false when its look is assumed.")
    scenes: list[int] = Field(description="Scene numbers it appears in.")


class Place(BaseModel):
    id: str
    name: str = Field(description="e.g. 'Chattahoochee National Forest'.")
    look: str = Field(description="Max 20 words: terrain, vegetation, buildings, era, light. No people or animals.")
    scenes: list[int] = Field(default_factory=list)


class Moment(BaseModel):
    scene: int
    entity: str = Field(description="The id of the entity shown.")
    place: str = Field(default="", description="The id of the place, if any.")
    action: str = Field(description="What it does, as narrated, max 8 words.")
    motion: Motion = Field(description="How it moves on screen: present (seen, still), move, approach, depart, rise, fall, turn, shake.")
    cue: str = Field(default="", description="The exact words of the scene's narration the moment rests on.")
    documented: bool = Field(description="True only if the narration says this happened; false if it is illustrative.")
    priority: int = Field(default=2, description="1 = a key moment the viewer must see, 3 = nice to have.")


class Manifest(BaseModel):
    entities: list[Entity] = Field(default_factory=list, description="0-8 things the viewer will see.")
    places: list[Place] = Field(default_factory=list, description="0-4.")
    moments: list[Moment] = Field(default_factory=list, description="At most 12, one per scene at most: the moments most worth seeing.")


GUIDE = """You read the script of a documentary video, before any picture is chosen, and list what the
viewer will see. Return JSON only.

- entities: the physical things the story is about and that can be shown: animals, people (by role
  and clothing only, never a real person's likeness), vehicles, buildings, machines, objects, organs,
  cells, molecules. Name the exact one the story names (a Cessna 404 is not an airliner; a black bear
  is not a grizzly). Leave out abstractions (money, a law, an idea).
- search: what a 3D model library would call it, plain nouns, most specific first, ending with the
  general noun ('cessna 404', 'light aircraft', 'airplane').
- look: what to draw, from the script and notes; say 'assumed' details plainly (certain = false).
- places: where it happens, as a backdrop with no people or animals in it.
- moments: for scenes where seeing the thing helps, what it does in that scene. documented = true only
  if the narration says it happened, and then cue = the exact words saying so. Never invent an action
  the story doesn't tell: if the bear is only mentioned, motion = present and documented = false."""


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:40] or "thing"


def _words(text: str) -> set[str]:
    return {w for w in re.findall(r"[a-z0-9]+", text.lower()) if len(w) > 2}


def named_in(entity: Entity, text: str) -> bool:
    """The text refers to the entity: a word of its name, a search term, or its kind (stemmed loosely, so
    'bears' names a bear and 'the plane' names a 'light plane')."""
    said = {w.rstrip("s") for w in _words(text)}
    own = _words(entity.name) | set().union(*(_words(s) for s in entity.search)) | _words(entity.kind)
    own = {w.rstrip("s") for w in own} - {"the", "and", "with", "from", "one"}
    return bool(own & said)


def checked(m: Manifest, script: Script) -> Manifest:
    """The manifest made true to the script: scene numbers in range, an entity kept in a scene only when
    that scene (or the one before, which goes on about it) names it, a moment documented only when its
    cue is in the scene's narration, at most one moment per scene."""
    n = len(script.scenes)
    told = [" ".join(x for x in (s.narration, s.heading or "") if x) for s in script.scenes]
    ids: set[str] = set()
    entities = []
    for e in m.entities:
        e = e.model_copy(update={"id": _slug(e.id or e.name), "search": [s.strip().lower() for s in e.search if s.strip()][:3] or [e.kind.lower()]})
        if e.id in ids:
            continue
        scenes = sorted({k for k in e.scenes if 1 <= k <= n and (named_in(e, told[k - 1]) or (k > 1 and named_in(e, told[k - 2])))})
        if not scenes and not named_in(e, " ".join(told)):
            continue  # nothing in the script refers to it
        ids.add(e.id)
        entities.append(e.model_copy(update={"scenes": scenes}))
    by_id = {e.id: e for e in entities}
    places = [p.model_copy(update={"id": _slug(p.id or p.name), "scenes": [k for k in p.scenes if 1 <= k <= n]}) for p in m.places]
    place_ids = {p.id for p in places}
    moments, seen = [], set()
    for mo in sorted(m.moments, key=lambda x: x.priority):
        eid = _slug(mo.entity)
        e = by_id.get(eid)
        if e is None or not 1 <= mo.scene <= n or mo.scene in seen or mo.scene not in e.scenes:
            continue
        narration = script.scenes[mo.scene - 1].narration
        cue = mo.cue if mo.cue and mo.cue.lower() in narration.lower() else ""
        documented = bool(mo.documented and cue)
        motion = mo.motion if documented or mo.motion in ("present", "turn") else "present"
        seen.add(mo.scene)
        moments.append(mo.model_copy(update={
            "entity": eid, "place": _slug(mo.place) if _slug(mo.place) in place_ids else "", "cue": cue,
            "documented": documented, "motion": motion, "priority": min(3, max(1, mo.priority)),
        }))
    return Manifest(entities=entities, places=places, moments=sorted(moments, key=lambda x: x.scene))


def analyse(cfg: Config, script: Script, notes: str = "") -> Manifest:
    """The checked manifest of a script, from one model call. Raises when the call fails."""
    lines = [f"Title: {script.title}"] + [f"Scene {i} ({s.type}): {s.narration}" for i, s in enumerate(script.scenes, 1)]
    if notes:
        lines.append("\nNotes (for what things looked like):\n" + notes[:1500])
    raw = llm.structured(cfg, GUIDE, "\n".join(lines), Manifest, max_tokens=2000)
    return checked(raw, script)


def entity(m: Manifest, eid: str | None) -> Entity | None:
    return next((e for e in m.entities if e.id == eid), None)


def place(m: Manifest, pid: str | None) -> Place | None:
    return next((p for p in m.places if p.id == pid), None)


def in_scene(m: Manifest, scene: int) -> list[Entity]:
    """Entities a scene (1-based) shows."""
    return [e for e in m.entities if scene in e.scenes]


def dumps(m: Manifest) -> str:
    return json.dumps(m.model_dump(), indent=2)
