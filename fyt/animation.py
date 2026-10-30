"""The Animation Director and the Spatial Director: what happens in each 3D scene, physically, before
anyone decides how to film or style it.

fyt.worldgen blocks every stage scene (who is there, which verb each plays, where they stand). That says
who is in the shot; it doesn't understand the event. The MOAB video showed the gap: "a bomb rolls out of
a C-130" was blocked as a bomb moving along the jungle floor, under a plane designed smaller than its
own bomb. This module puts the physical event right, the same way for any story:

1. Spatial Director (``fix_scale``): every entity at its real size, in metres: a size its sources state
   beats the reference table (fyt/sizes.py), which beats the designer's guess. A thing carried by or
   attached to another is smaller than it. Shapes are rescaled with their size, never to fit a camera.
2. Animation Director (``plan``): each scene as a structured plan in a fixed, topic-independent action
   language: subjects (where each starts: ground, air, water, or attached to another), actions (a
   vocabulary of reusable primitives, each on the narration's own words, in order) and camera beats
   that follow whatever matters at each moment. A model writes it when one is free to; the rules here
   read the same patterns ("dropped from", "rolls out of", "launched from", "exploded") otherwise.
3. Feasibility (``feasible``): every plan, the model's or the rules', is checked against what the
   bodies can do. An inert object never moves by itself; what is released from a carrier starts on it
   and falls from it; the carrier carries on; an explosive that falls detonates where it lands; nothing
   acts after it is destroyed. A step the engine can't play becomes the nearest one it can, and is
   logged, never silently dropped.
4. ``compile``: the plan written back into the blocking the renderer plays (actors, attachment, beats on
   their cue words), so the scene director (fyt/director.py) films it as it does any scene.

Each plan's evidence says whether what it shows is documented (the narration says it), inferred (an
explosive that falls detonates) or illustrative.
"""

from __future__ import annotations

import json
import re
from typing import Callable, Literal

from pydantic import BaseModel, Field

from fyt import llm, manifest, scenes3d, sizes, worldgen
from fyt.config import Config
from fyt.manifest import Manifest
from fyt.models import Script
from fyt.worldgen import Actor, Beat, BeatActor, Build, Shot

# --- the action language ------------------------------------------------------------------------------

# Reusable primitives by family, what each needs, and the renderer verb that plays it. `needs`:
# self: a body that moves itself (legs, wings, a hull, an engine); living: an animal or a person;
# carrier: something it starts attached to; aloft: above the ground (in the air, or on something that is).
VOCAB: dict[str, dict] = {
    # locomotion
    "fly": {"family": "locomotion", "needs": {"self"}, "verb": "fly"},
    "walk": {"family": "locomotion", "needs": {"self"}, "verb": "walk"},
    "run": {"family": "locomotion", "needs": {"self"}, "verb": "run"},
    "swim": {"family": "locomotion", "needs": {"self"}, "verb": "swim"},
    "drive": {"family": "locomotion", "needs": {"self"}, "verb": "drive"},
    "sail": {"family": "locomotion", "needs": {"self"}, "verb": "move"},
    "climb": {"family": "locomotion", "needs": {"self"}, "verb": "climb"},
    "approach": {"family": "locomotion", "needs": {"self"}, "verb": "approach"},
    "depart": {"family": "locomotion", "needs": {"self"}, "verb": "depart"},
    "move": {"family": "locomotion", "needs": {"self"}, "verb": "move"},
    "flee": {"family": "group", "needs": {"self", "living"}, "verb": "run"},
    "chase": {"family": "group", "needs": {"self", "living"}, "verb": "run"},
    # carrying and release
    "carry": {"family": "interaction", "needs": {"living"}, "verb": "carry"},
    "pick_up": {"family": "interaction", "needs": {"living"}, "verb": "pick_up"},
    "release": {"family": "interaction", "needs": {"carrier"}, "verb": "fall"},
    "launch": {"family": "interaction", "needs": {"carrier"}, "verb": "rise"},
    # physical events
    "fall": {"family": "physical", "needs": set(), "verb": "fall"},
    "crash": {"family": "physical", "needs": set(), "verb": "crash"},
    "sink": {"family": "physical", "needs": set(), "verb": "sink"},
    "collapse": {"family": "physical", "needs": set(), "verb": "collapse"},
    "explode": {"family": "physical", "needs": set(), "verb": "explode"},
    "shake": {"family": "physical", "needs": set(), "verb": "shake"},
    "rise": {"family": "physical", "needs": set(), "verb": "rise"},
    # behaviour
    "look": {"family": "behaviour", "needs": {"living"}, "verb": "look_around"},
    "turn": {"family": "behaviour", "needs": set(), "verb": "turn"},
    "point": {"family": "behaviour", "needs": {"living"}, "verb": "point"},
    "talk": {"family": "behaviour", "needs": {"living"}, "verb": "talk"},
    "panic": {"family": "behaviour", "needs": {"living"}, "verb": "panic"},
    "work": {"family": "behaviour", "needs": {"living"}, "verb": "work"},
    "eat": {"family": "behaviour", "needs": {"living"}, "verb": "eat"},
    # growth and change
    "grow": {"family": "change", "needs": set(), "verb": "grow"},
    "split": {"family": "change", "needs": set(), "verb": "split"},
    "open": {"family": "change", "needs": set(), "verb": "open"},
    "pulse": {"family": "change", "needs": set(), "verb": "pulse"},
    "spin": {"family": "change", "needs": set(), "verb": "spin"},
    "glow": {"family": "change", "needs": set(), "verb": "glow"},
    # being there
    "present": {"family": "still", "needs": set(), "verb": "present"},
    "idle": {"family": "still", "needs": set(), "verb": "idle"},
}
Action = Literal[tuple(VOCAB)]  # type: ignore[valid-type]
LOCOMOTION = {a for a, v in VOCAB.items() if v["family"] in ("locomotion", "group")}
ENDS = {"explode", "sink", "collapse", "crash"}  # nothing acts after these
SNAP = 12  # characters: cues starting this close together are one moment
MOUNTS = ("under", "inside", "on", "held")


class Subject(BaseModel):
    entity: str
    start: Literal["ground", "air", "water", "attached"] = "ground"
    attached_to: str = Field(default="", description="With start 'attached': the entity id it rides with until released.")
    mount: Literal["under", "inside", "on", "held"] = "under"


class Act(BaseModel):
    subject: str
    action: Action
    cue: str = Field(default="", description="The exact words of the narration where it starts; empty = from the first words.")
    target: str = Field(default="", description="An entity id it acts on or heads for, or empty.")


class CameraBeat(BaseModel):
    move: worldgen.Move
    on: str = Field(description="The entity id the camera frames.")
    cue: str = Field(default="", description="The exact narration words it cuts on; empty for the opening shot.")


class Plan(BaseModel):
    scene: int
    evidence: Literal["documented", "inferred", "illustrative"] = "illustrative"
    subjects: list[Subject]
    actions: list[Act]
    camera: list[CameraBeat] = Field(default_factory=list)


class Plans(BaseModel):
    plans: list[Plan]


# --- reading the narration ---------------------------------------------------------------------------

EXPLOSIVE = ("bomb", "missile", "warhead", "shell", "grenade", "torpedo", "explosive", "dynamite", "munition", "ordnance",
             "moab", "gbu", "blu", "charge", "payload", "nuke", "nuclear device", "rocket-propelled")
# a verb that sends something out of or off a carrier, then (within a few words) the preposition
RELEASE_VERB = re.compile(
    r"\b(drop(?:s|ped|ping)?|roll(?:s|ed|ing)?|releas(?:e|es|ed|ing)|launch(?:es|ed|ing)?|eject(?:s|ed|ing)?|jettison(?:s|ed|ing)?|"
    r"push(?:es|ed)?|slid(?:e|es|ing)?|slips?|slipped|fell|falls?|falling|tumbl(?:e|es|ed|ing)|parachut(?:e|es|ed|ing)|deploy(?:s|ed|ing)?|"
    r"jump(?:s|ed|ing)?|bail(?:s|ed)?|thr(?:ew|own|ows?)|toss(?:es|ed)?|dump(?:s|ed)?|fired?|fires|shot|unload(?:s|ed)?|"
    r"emerg(?:e|es|ed|ing)|plung(?:e|es|ed|ing)|separat(?:e|es|ed|ing))\b(?:[^.;!?]{0,24}?\b(out of|out from|out the back of|"
    r"from the belly of|from under|from beneath|from|off|beneath|out)\b)?",
    re.I,
)
CARRY = re.compile(r"\b(carried|carrying|carries|loaded (?:onto|into|aboard|on)|aboard|strapped|slung|mounted (?:under|on|beneath)|"
                   r"hauled|towed|cradled|under (?:its|the) (?:wing|belly|fuselage))\b", re.I)
INSIDE = re.compile(r"\b(inside|in the hold|in its hold|cargo bay|aboard|in the belly)\b", re.I)
EXPLODE = re.compile(r"\b(explod(?:e|es|ed|ing)|detonat(?:e|es|ed|ing|ion)|blew up|blown up|blast(?:ed)?|went off|obliterat(?:e|es|ed)|"
                     r"struck the ground|hit the ground|slammed into|impact(?:ed)?)\b", re.I)
SENTENCE = re.compile(r"[^.!?]+[.!?]*")


def _flier(b: Build, a: Actor | None) -> bool:
    """In the air: a bird or insect, or a vehicle flying (its verb, or an aircraft's form) and not landed."""
    if b.archetype in ("bird", "insect"):
        return True
    if b.archetype != "vehicle" or a is None:
        return False
    return a.verb in ("fly", "rise") or (b.form in ("airliner", "lightplane", "plane", "jet", "helicopter") and a.verb in ("approach", "depart", "move"))


def _inert(b: Build) -> bool:
    """Moves only when something moves it: a bomb, a crate, a building, a tree."""
    return b.archetype in ("object", "structure", "plant")


def _living(b: Build) -> bool:
    return b.archetype in worldgen.LIVING


def _explosive(e: manifest.Entity | None) -> bool:
    return bool(e) and bool(scenes3d.find(" ".join([e.name, e.kind, *e.search]), list(EXPLOSIVE)))


GENERIC = {"the", "and", "with", "aerial", "military", "large", "small", "big", "old", "new"}


def _named(story: Manifest, eid: str, text: str, specific: bool = False) -> int:
    """Where in the text the entity is first named (its name, search words or kind), or -1. `specific`:
    by a word of its own, not one of its kind's (a 'twenty-one-thousand-pound bomb' names the MOAB; 'bomb'
    alone names any bomb)."""
    e = manifest.entity(story, eid)
    if e is None:
        return -1
    words = {w for w in re.findall(r"[a-z0-9][a-z0-9-]+", " ".join([e.name, e.kind, *e.search]).lower()) if len(w) > 2} - GENERIC
    if specific:
        kind = set(re.findall(r"[a-z0-9][a-z0-9-]+", e.kind.lower()))
        common = {w for x in story.entities if x.id != eid for w in re.findall(r"[a-z0-9][a-z0-9-]+", " ".join([x.kind, *x.search]).lower())}
        words -= kind | common
    hits = [m.start() for w in words for m in [re.search(rf"(?<![a-z0-9]){re.escape(w)}(e?s)?(?![a-z0-9])", text.lower())] if m]
    return min(hits) if hits else -1


def _cue_at(narration: str, start: int, end: int) -> str:
    return narration[start:end].strip()


# --- the plan from a blocking, and the patterns the rules read -----------------------------------------

def from_shot(sh: Shot, builds: dict[str, Build], narration: str) -> Plan:
    """The plan a blocking already implies: everyone where it starts, doing its verb, and each beat's
    changes on their words."""
    subjects, acts = [], []
    verb_action = {v["verb"]: a for a, v in reversed(list(VOCAB.items()))} | {a: a for a in VOCAB}
    for a in sh.actors:
        b = builds[a.entity]
        start = "attached" if a.attached else "air" if _flier(b, a) else "ground"
        subjects.append(Subject(entity=a.entity, start=start, attached_to=a.attached, mount=a.mount if a.mount in MOUNTS else "under"))
        acts.append(Act(subject=a.entity, action=verb_action.get(a.verb, "present" if _inert(b) else "idle")))
    camera = [CameraBeat(move=sh.camera, on=sh.on or sh.actors[0].entity)]
    for bt in sh.beats:
        for x in bt.actors:
            act = "release" if x.release else verb_action.get(x.verb, "idle")
            acts.append(Act(subject=x.entity, action=act, cue=bt.cue))
            if x.release and x.verb != "fall":
                acts.append(Act(subject=x.entity, action=verb_action.get(x.verb, "fall"), cue=bt.cue))
        camera.append(CameraBeat(move=bt.camera, on=bt.on or bt.actors[0].entity, cue=bt.cue))
    return Plan(scene=sh.scene, subjects=subjects, actions=acts, camera=camera)


def _subject(p: Plan, eid: str) -> Subject | None:
    return next((s for s in p.subjects if s.entity == eid), None)


def read_events(p: Plan, narration: str, story: Manifest, builds: dict[str, Build], shot: Shot) -> tuple[Plan, list[str]]:
    """The events the narration tells in words any story uses: something released from a carrier
    ("rolls out of a C-130", "dropped from the plane", "launched from the ship"), carried by one ("slung
    under its wing"), and an explosion. Returns the plan with them and what was read."""
    notes: list[str] = []
    ids = [s.entity for s in p.subjects]
    actor = {a.entity: a for a in shot.actors}
    carriers = [e for e in ids if builds[e].archetype in ("vehicle", "bird") or (_living(builds[e]) and builds[e].archetype == "humanoid")]
    moment = next((x.entity for x in story.moments if x.scene == p.scene), "")

    def pick(cands: list[str], text: str) -> str | None:
        """The one the words are about: named by a word of its own, then the scene's moment, then named
        at all, then the first inert one (an 'it' the scene is about)."""
        ranked = sorted(cands, key=lambda e: (_named(story, e, text, specific=True) < 0, e != moment, _named(story, e, text) < 0, not _inert(builds[e])))
        best = ranked[0] if ranked else None
        if best is None or (_named(story, best, text) < 0 and best != moment and not re.search(r"\b(it|its)\b", text, re.I)):
            return None
        return best

    for sent in SENTENCE.finditer(narration):
        text = sent.group(0)
        base = sent.start()
        for m in RELEASE_VERB.finditer(text):
            prep = (m.group(2) or "").lower()
            after = text[m.end(2):] if prep else ""
            carrier = min(((i, c) for c in carriers if (i := _named(story, c, after)) >= 0), default=(None, None))[1] if prep else None
            before = text[: m.start(2)] if prep else text[: m.start()]
            transitive = m.group(1).lower().startswith(("drop", "releas", "jettison", "dump", "launch", "deploy", "thr", "toss", "push"))
            if carrier is None and not prep and transitive:
                # "the bomber dropped the bomb": the carrier is who does it, the load what it lets go
                subj = [c for c in carriers if 0 <= _named(story, c, text[: m.start()]) and (_flier(builds[c], actor.get(c)) or builds[c].archetype == "humanoid")]
                if subj:
                    carrier, before = subj[-1], text[m.end(1): m.end(1) + 60]
            if carrier is None and prep in ("out", "off", "from"):
                # "its ramp opens; the bomb rolls out": the carrier the narration named before, in the air
                earlier = narration[: base + m.start()]
                named = [c for c in carriers if _named(story, c, earlier) >= 0 and _flier(builds[c], actor.get(c))]
                carrier = named[0] if len(named) == 1 else None
            if carrier is None:
                continue
            loads = [e for e in ids if e != carrier and builds[e].size < builds[carrier].size * 0.9 and not _flier(builds[e], actor.get(e))
                     and (_inert(builds[e]) or (prep and builds[carrier].archetype == "vehicle"))]  # a person jumps from a plane; nobody drops a dog
            load = pick(loads, before)
            if load is None:
                continue
            s = _subject(p, load)
            if s is None or s.start == "attached" and s.attached_to == carrier and any(a.subject == load and a.action == "release" for a in p.actions):
                continue
            s.start, s.attached_to = "attached", carrier
            s.mount = "under" if builds[carrier].archetype != "humanoid" else "held"
            cue = _cue_at(narration, base + m.start(), base + m.end())
            # the load rides along until the words that release it; whatever its blocking had it doing
            # up to then (moving along the ground) goes
            at = base + m.end()
            p.actions = [a for a in p.actions if a.subject != load or (a.cue and narration.lower().find(a.cue.lower()) > at)]
            p.actions.append(Act(subject=load, action="present"))
            p.actions.append(Act(subject=load, action="release", cue=cue))
            p.actions.append(Act(subject=load, action="launch" if m.group(1).lower().startswith(("launch", "fire", "shot")) and not _inert(builds[load]) else "fall", cue=cue))
            notes.append(f"{load} released from {carrier} at \"{cue}\"")
            # an explosion told after the release
            rest = narration[base + m.end():]
            boom = EXPLODE.search(rest)
            if boom:
                k = base + m.end() + boom.start()
                p.actions.append(Act(subject=load, action="explode", cue=_cue_at(narration, k, base + m.end() + boom.end())))
                notes.append(f"{load} explodes at \"{boom.group(0)}\"")
            break
        if not CARRY.search(text):
            continue
        # carried, not released: it rides with its carrier through the scene
        for c in carriers:
            if _named(story, c, text) < 0:
                continue
            loads = [e for e in ids if e != c and (s := _subject(p, e)) is not None and s.start != "attached"
                     and builds[e].size < builds[c].size * 0.9 and not _flier(builds[e], actor.get(e))]
            e = pick(loads, text.replace(m0.group(0), "") if (m0 := re.search(re.escape(manifest.entity(story, c).name), text, re.I)) else text)
            if e is None:
                continue
            s = _subject(p, e)
            s.start, s.attached_to = "attached", c
            s.mount = "inside" if INSIDE.search(text) and builds[c].archetype == "vehicle" else ("held" if builds[c].archetype == "humanoid" else "under")
            p.actions = [a for a in p.actions if a.subject != e] + [Act(subject=e, action="present")]
            notes.append(f"{e} carried by {c}" + (" (inside)" if s.mount == "inside" else ""))
            break
    return p, notes


# --- feasibility -------------------------------------------------------------------------------------

def feasible(p: Plan, narration: str, story: Manifest, builds: dict[str, Build]) -> tuple[Plan, list[str]]:
    """The plan made playable and physically true, whoever wrote it. Returns it with what was changed."""
    notes: list[str] = []
    low = narration.lower()
    subjects: list[Subject] = []
    for s in p.subjects:
        eid = s.entity
        if eid not in builds or any(x.entity == eid for x in subjects):
            continue
        if s.start == "attached":
            parent = s.attached_to
            if parent not in builds or parent == eid or not any(x.entity == parent for x in p.subjects):
                notes.append(f"{eid}: attached to {parent or 'nothing'} on stage, so it starts on the ground")
                s = s.model_copy(update={"start": "ground", "attached_to": ""})
            elif builds[eid].size >= builds[parent].size:
                notes.append(f"{eid} ({builds[eid].size:g} m) can't ride on {parent} ({builds[parent].size:g} m)")
                s = s.model_copy(update={"start": "ground", "attached_to": ""})
        subjects.append(s)
    # a subject the scene only names by a word another one owns ('bomb', where the twenty-one-thousand-
    # pound bomb is the MOAB), or doesn't name at all, isn't in this scene's event
    moment = next((x.entity for x in story.moments if x.scene == p.scene), "")
    riders = {s.attached_to for s in subjects} | {s.entity for s in subjects if s.start == "attached"}
    owned = [s.entity for s in subjects if _named(story, s.entity, narration, specific=True) >= 0]
    keep = []
    for s in subjects:
        e = s.entity
        if e == moment or e in riders or e in owned or len(subjects) < 2:
            keep.append(s)
            continue
        if _named(story, e, narration) < 0:
            notes.append(f"{e}: not named in this scene; left out")
        elif owned:
            notes.append(f"{e}: only named by a word another subject owns here; left out")
        else:
            keep.append(s)
    subjects = keep or subjects
    by_id = {s.entity: s for s in subjects}
    # cues in narration order; an act whose words aren't said is dropped (an explosion the story implies
    # is kept as the fall's outcome below)
    acts: list[Act] = []
    for a in p.actions:
        if a.subject not in by_id:
            continue
        if a.cue and low.find(a.cue.lower()) < 0:
            notes.append(f"{a.subject} {a.action}: cue \"{a.cue}\" not in the narration")
            continue
        acts.append(a)
    acts.sort(key=lambda a: low.find(a.cue.lower()) if a.cue else -1)
    # cues that start within a few words of one another are one moment: the earlier words stand for both
    # (a blocking's beat on "rolls out of a C-130" and a release on "rolls out of")
    snapped: list[str] = []
    for i, a in enumerate(acts):
        if not a.cue:
            continue
        at = low.find(a.cue.lower())
        same = next((c for c in snapped if abs(low.find(c.lower()) - at) <= SNAP), None)
        if same is None:
            snapped.append(a.cue)
        elif same != a.cue:
            acts[i] = a.model_copy(update={"cue": same})
    out: list[Act] = []
    ended: set[str] = set()
    released: set[str] = set()
    for a in acts:
        s, b = by_id[a.subject], builds[a.subject]
        if a.subject in ended:
            notes.append(f"{a.subject} {a.action}: after it was destroyed")
            continue
        need = VOCAB[a.action]["needs"]
        attached_now = s.start == "attached" and a.subject not in released
        if a.action in ("release", "launch") and not attached_now and a.action == "release":
            notes.append(f"{a.subject} release: not attached to anything")
            continue
        if a.action in LOCOMOTION and _inert(b):
            # a bomb or a crate never moves by itself: carried, it rides; otherwise it stays put
            if not attached_now:
                notes.append(f"{a.subject} {a.action}: an inert {b.archetype} can't move by itself; shown still")
            out.append(a.model_copy(update={"action": "present"}))
            continue
        if "living" in need and not _living(b):
            notes.append(f"{a.subject} {a.action}: needs a living thing; shown still")
            out.append(a.model_copy(update={"action": "present"}))
            continue
        if a.action == "explode" and "explode" not in worldgen.verbs_for(b.archetype):
            notes.append(f"{a.subject} explode: a {b.archetype} can't; shaken instead")
            a = a.model_copy(update={"action": "shake"})
        if attached_now and a.cue and a.action not in ("release", "launch", "present", "idle"):
            # an action of its own while still attached: it must have left its carrier first
            out.append(Act(subject=a.subject, action="release", cue=a.cue))
            released.add(a.subject)
            notes.append(f"{a.subject} {a.action}: released from {s.attached_to} first")
        if a.action in ("release", "launch"):
            released.add(a.subject)
            # the carrier carries on: a release is never the carrier's fall
            carrier = s.attached_to
            out = [x for x in out if not (x.subject == carrier and x.cue and x.cue.lower() == (a.cue or "").lower() and x.action in ("fall", "crash", "sink"))]
        if a.action in ENDS:
            ended.add(a.subject)
        out.append(a)
    # the carrier's own action at a release cue that would bring it down is dropped (it flies on)
    for x in [x for x in out if x.action in ("release", "launch")]:
        carrier = by_id[x.subject].attached_to
        out = [y for y in out if not (y.subject == carrier and y.cue == x.cue and y.action in ("fall", "crash", "sink"))]
    cam: list[CameraBeat] = []
    for c in p.camera:
        if c.on not in by_id or (c.cue and low.find(c.cue.lower()) < 0) or (not c.cue and cam):
            continue
        if c.cue:
            at = low.find(c.cue.lower())
            c = c.model_copy(update={"cue": next((x for x in snapped if abs(low.find(x.lower()) - at) <= SNAP), c.cue)})
            if any(x.cue == c.cue for x in cam):
                continue
        cam.append(c)
    if not cam and subjects:
        cam = [CameraBeat(move="establish", on=subjects[0].entity)]
    # the opening frames the carrier, not the load riding on it (the AC-130 was framed from its bomb)
    if by_id.get(cam[0].on) and by_id[cam[0].on].start == "attached":
        cam[0] = cam[0].model_copy(update={"on": by_id[cam[0].on].attached_to})
    # the camera follows a release down, and comes back to it when it explodes
    for x in out:
        if x.action in ("release", "explode") and x.cue and not any(c.cue.lower() == x.cue.lower() for c in cam):
            cam.append(CameraBeat(move="follow" if x.action == "release" else "reveal", on=x.subject, cue=x.cue))
    cam = [cam[0]] + sorted(cam[1:], key=lambda c: low.find(c.cue.lower()))
    told = any(a.cue for a in out)
    evidence = "documented" if told else p.evidence if p.evidence != "documented" else "illustrative"
    return p.model_copy(update={"subjects": subjects, "actions": out, "camera": cam, "evidence": evidence}), list(dict.fromkeys(notes))


# --- back into the blocking the renderer plays ---------------------------------------------------------

def _verb(action: str, b: Build, aloft: bool) -> str:
    verbs = worldgen.verbs_for(b.archetype)
    v = VOCAB[action]["verb"]
    if action == "sail" or (action in ("move", "approach", "depart") and b.archetype == "vehicle" and aloft):
        v = "fly" if aloft and "fly" in verbs else "move"
    if v in verbs:
        return v
    if action in LOCOMOTION:
        return next((x for x in ("move", "walk", "swim", "fly", "drive") if x in verbs), worldgen.calm_verb(b.archetype))
    return worldgen.calm_verb(b.archetype)


def compile(p: Plan, sh: Shot, builds: dict[str, Build], story: Manifest) -> Shot:
    """The plan as the blocking the renderer plays: the opening actors (attached ones riding on their
    carrier), then a beat for each cue, each with the camera move the plan cuts to there."""
    by_id = {s.entity: s for s in p.subjects}
    old = {a.entity: a for a in sh.actors}
    opening = {a.subject: a for a in p.actions if not a.cue}
    actors: list[Actor] = []
    spots = iter(x for x in ("right", "left", "back", "front", "far") if all(a.at != x for a in sh.actors))
    impact = {a.subject for a in p.actions if a.action == "explode" and not a.cue}
    for s in p.subjects:
        b = builds[s.entity]
        a0 = old.get(s.entity) or Actor(entity=s.entity, verb=worldgen.calm_verb(b.archetype), at=next(spots, "center"))
        act = opening.get(s.entity)
        verb = _verb(act.action, b, s.start == "air") if act else a0.verb
        if s.start == "attached":
            verb, a0 = "present", a0.model_copy(update={"to": ""})
        fall_then = any(x.subject == s.entity and x.action in ("release", "fall") for x in p.actions)
        boom = s.entity in impact or (fall_then and _explosive(manifest.entity(story, s.entity))
                                      and not any(x.subject == s.entity and x.action == "explode" and x.cue for x in p.actions))
        actors.append(a0.model_copy(update={"verb": verb, "attached": s.attached_to if s.start == "attached" else "",
                                            "mount": s.mount if s.start == "attached" else "", "impact": "explode" if boom else ""}))
    # the subject the opening frames leads the cast (the renderer frames and spaces from its lead)
    lead = p.camera[0].on if p.camera else actors[0].entity
    actors.sort(key=lambda a: a.entity != lead)
    narration_cues: dict[str, list[Act]] = {}
    for a in p.actions:
        if a.cue:
            narration_cues.setdefault(a.cue, []).append(a)
    beats: list[Beat] = []
    for cue, acts in narration_cues.items():
        cast: list[BeatActor] = []
        for a in acts:
            s = by_id[a.subject]
            prev = next((x for x in cast if x.entity == a.subject), None)
            if a.action in ("release", "launch"):
                bx = BeatActor(entity=a.subject, verb="rise" if a.action == "launch" and "rise" in worldgen.verbs_for(builds[a.subject].archetype) else "fall",
                               release=True)
            else:
                bx = BeatActor(entity=a.subject, verb=_verb(a.action, builds[a.subject], s.start == "air"), release=bool(prev and prev.release))
            cast = [x for x in cast if x.entity != a.subject] + [bx]
        cam = next((c for c in p.camera if c.cue and c.cue.lower() == cue.lower()), None)
        beats.append(Beat(cue=cue, actors=cast, camera=cam.move if cam else "follow", on=cam.on if cam else cast[0].entity))
    for c in p.camera[1:]:
        if not any(bt.cue.lower() == c.cue.lower() for bt in beats):
            beats.append(Beat(cue=c.cue, actors=[], camera=c.move, on=c.on))
    return sh.model_copy(update={"actors": actors[:5], "beats": beats, "on": lead, "camera": p.camera[0].move if p.camera else sh.camera})


# --- the Spatial Director ------------------------------------------------------------------------------

SCALE_TOLERANCE = 1.6  # a designed size within this factor of the evidence stands
MICRO = 1e-3  # metres: smaller than this is shown under a magnifying lens


def true_size(e: manifest.Entity, notes: str = "") -> tuple[float, str] | None:
    """The entity's real size in metres and where it came from: stated in its sources, else the
    reference table; None when neither knows it."""
    names = [e.name.removeprefix("the ").removeprefix("a ").removeprefix("an "), *e.search]
    said = sizes.stated(notes, names) if notes else None
    if said:
        return said, "stated in the sources"
    hit = sizes.lookup(" ".join([e.name, *e.search, e.kind]))
    if hit:
        return hit[0], f"reference size for '{hit[1]}'"
    return None


def _rescaled(b: Build, size: float) -> Build:
    k = size / max(1e-9, b.size)
    parts = [p.model_copy(update={"at": [v * k for v in p.at], "size": [v * k for v in p.size]}) for p in b.parts]
    return b.model_copy(update={"size": round(size, 3) if size >= 0.01 else size, "parts": parts})


def fix_scale(builds: dict[str, Build], story: Manifest, notes: str = "") -> tuple[dict[str, Build], list[str]]:
    """Every build at its real size: one off by more than SCALE_TOLERANCE from its evidence is rescaled
    (its shape with it). People keep the body plan the designer gave them. Returns the builds and a
    line per change."""
    out, log = dict(builds), []
    known = {}
    for eid, b in builds.items():
        e = manifest.entity(story, eid)
        if e is not None and not worldgen.is_person(e) and (t := true_size(e, notes)):
            known[eid] = t
    # the microscopic is filmed magnified, all of it by one lens: sizes relative to one another stay
    # true (a virus beside the cell it enters), the largest drawn at the size it was designed
    micro = {eid: t for eid, t in known.items() if t[0] < MICRO}
    if micro:
        big = max(micro, key=lambda x: micro[x][0])
        lens = max(builds[big].size, 1.0) / micro[big][0]
        for eid, (size, why) in micro.items():
            known[eid] = (size * lens, f"{why}, magnified {lens:.3g} times")
    for eid, (size, why) in known.items():
        b = builds[eid]
        if b.size <= 0 or max(size / b.size, b.size / size) > SCALE_TOLERANCE:
            out[eid] = _rescaled(b, size)
            log.append(f"{eid}: {b.size:g} m -> {size:g} m ({why})")
    return out, log


# --- the director ----------------------------------------------------------------------------------------

GUIDE = """You are the animation director of a documentary channel's 3D scenes. For each scene, decide
what physically happens, in order, before anyone decides how to film it. The same rules hold for any
story: history, wildlife, science, disasters, biography, technology, mystery.

You get each scene's narration, its subjects (id, kind of body, real size in metres) and a draft plan.
Return a plan per scene in this action language:
- subjects: where each starts: ground, air, water, or attached (riding with another subject until a
  release: a bomb under its aircraft, a lifeboat on its ship, a parcel in a hand). attached_to = that
  subject's id; mount = under, inside, on or held. Only something smaller rides on something larger.
- actions, in the order the narration tells them: subject, action, cue = the exact narration words
  where it starts (empty for what it is doing from the first words), target when it heads for or acts
  on another subject. Actions: {actions}.
- camera: the opening shot (empty cue) and a cut at each moment that matters, framing what matters
  then: the carrier as it flies in, the released thing as it falls, the impact. Moves: {moves}.
- evidence: documented when the narration says it happened, inferred when it follows from what is said
  (an explosive that falls detonates), illustrative otherwise.

Physical rules: an object (a bomb, a crate, a capsule) never moves by itself: it rides, falls or stays
still. What is released from a carrier starts attached to it and falls (or launches) from it; the
carrier carries on doing what it was doing. A fall ends at the ground. Nothing acts after it explodes,
sinks or collapses. Never invent an event the narration doesn't tell. Return JSON only."""


def _rows(script: Script, story: Manifest, builds: dict[str, Build], drafts: dict[int, Plan]) -> str:
    rows = []
    for k, p in sorted(drafts.items()):
        subj = "; ".join(f"{s.entity} ({builds[s.entity].archetype}, {builds[s.entity].size:g} m)" for s in p.subjects)
        rows.append(f"Scene {k}: subjects {subj}\n  narration: {script.scenes[k - 1].narration}\n  draft: "
                    + json.dumps(p.model_dump(exclude={"scene"}), separators=(",", ":")))
    return f"Title: {script.title}\n\n" + "\n".join(rows)


def plan(cfg: Config | None, script: Script, story: Manifest, builds: dict[str, Build], shots: dict[int, Shot],
         log: Callable[[str], None] = print) -> tuple[dict[int, Shot], dict[int, dict], str]:
    """Every staged scene's action plan, checked and compiled into its blocking. Returns (shots, {scene:
    the plan and what feasibility changed}, 'model' or 'rules')."""
    drafts: dict[int, Plan] = {}
    read: dict[int, list[str]] = {}
    for k, sh in shots.items():
        narration = script.scenes[k - 1].narration
        p = from_shot(sh, builds, narration)
        p, notes = read_events(p, narration, story, builds, sh)
        m = next((x for x in story.moments if x.scene == k), None)
        p.evidence = "documented" if m and m.documented else "illustrative"
        drafts[k], read[k] = p, notes
    how = "rules"
    eventful = {k: p for k, p in drafts.items() if len(p.subjects) > 1 or any(a.cue for a in p.actions)}
    if cfg is not None and eventful:
        try:
            guide = GUIDE.format(actions=", ".join(VOCAB), moves=", ".join(worldgen.G["camera"]))
            got = llm.structured(llm.helping(cfg), guide, _rows(script, story, builds, eventful), Plans, max_tokens=8000, quick=True)
            for q in got.plans:
                if q.scene in eventful and q.subjects:
                    # the model's plan, with the patterns the rules read kept where it missed them
                    q, more = read_events(q, script.scenes[q.scene - 1].narration, story, builds, shots[q.scene])
                    drafts[q.scene], read[q.scene] = q, read[q.scene] + [f"(model) {x}" for x in more]
            how = "model"
        except Exception as ex:  # the rules' plans stand
            log(f"animation director: model call failed ({str(ex)[:140]}); planning from the rules")
    out, report = {}, {}
    for k, sh in shots.items():
        q, changed = feasible(drafts[k], script.scenes[k - 1].narration, story, builds)
        out[k] = compile(q, sh, builds, story)
        report[k] = {"plan": q.model_dump(), "read": read[k], "revised": changed}
    return out, report, how


def summary(report: dict[int, dict]) -> str:
    """One log line: the events each scene acts out and what feasibility revised."""
    parts = []
    for k, r in sorted(report.items()):
        acts = [f"{a['subject']} {a['action']}" for a in r["plan"]["actions"] if a["cue"]]
        rides = [f"{s['entity']} on {s['attached_to']}" for s in r["plan"]["subjects"] if s["start"] == "attached"]
        if acts or rides or r["revised"]:
            parts.append(f"scene {k}: " + ", ".join(rides + acts) + (f" (revised: {'; '.join(r['revised'][:2])})" if r["revised"] else ""))
    return "; ".join(parts) or "no events to act out"
