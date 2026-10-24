"""The visual plan: every video's script, once its facts are checked, is read as a whole to decide which
moments are acted out as 3D reconstructions (world scenes) and how.

The scriptwriter already picks maps, charts, timelines and photos for what they carry best. This pass
looks at the finished, fact-checked story and turns the moments a viewer should *see happen* (a launch,
a collision, a sinking, an eruption, a city burning) into world scenes, keeping the same thing looking
the same in every scene it appears in, and carrying the place, night and weather from scene to scene.
How many it makes is up to the story and the render budget (`visuals.world_seconds_*`), not a quota.

A model reads the script and the 3D catalog and returns the plan; if that call fails, a rule-based
planner reads the same catalog's keywords, so no video goes without a plan. Either way every world
scene then passes fyt.scenes3d.guard, which draws an event only when the narration names it.
"""

from __future__ import annotations

import json
import re
from typing import Callable, Literal

from pydantic import BaseModel, Field
from pydantic.json_schema import SkipJsonSchema

from fyt import assets, llm, manifest, scenes3d
from fyt.config import Config
from fyt.manifest import Manifest
from fyt.models import Action3D, Obstacle, Script, ScriptScene, Setting, Shot, Subject, Variant, Weather

# Scenes whose picture can become a reconstruction without losing anything on screen: they carry a
# heading and narration, no figures, quotes or places of their own. A photo scene keeps its real photo.
CONVERTIBLE = ("statement", "title", "broll", "story", "world", "aircraft", "ship", "process")
# A process scene's steps are only worth giving up for a 3D scene that acts the process out (the helix
# unzipping); the keyword planner leaves it alone otherwise.
ACTED_ONLY = ("process",)
# Scenes whose figures can ride over a 3D scene of the story (a count-up, a share, a list, dated events
# on a plate): 3D first fills with them once the narrative scenes are in. Maps, charts, quotes,
# documents and real photos carry what a 3D scene can't, and stay.
OVERLAYS = ("stat", "proportion", "list", "timeline")
WORDS_PER_SECOND = {"short": 2.9, "long": 2.6}
# The setting a scene's own words point to, checked in this order (night first: it changes the look most).
SETTING_WORDS = {
    "night": ["night", "midnight", "moonless", "darkness", "after dark", "nightfall"],
    "space": ["space", "orbit"],
    "snow": ["snow", "arctic", "antarctic", "blizzard", "glacier", "pack ice", "ice floe"],
    "desert": ["desert", "sahara", "dune", "arid"],
    "sea": ["sea", "ocean", "river", "gulf", "bay", "coast", "atlantic", "pacific"],
    "road": ["road", "highway", "motorway", "street"],
    "city": ["city", "town", "streets", "downtown"],
    "countryside": ["countryside", "farm", "fields", "village", "rural", "valley"],
}
SHOT_CYCLE = ("chase", "orbit", "side", "front", "wide")
STAGE_SHOTS = ("side", "orbit", "front", "wide")  # no chase: a bear or a building seen from behind tells little


class Reconstruction(BaseModel):
    scene: int = Field(description="The scene number to act out in 3D.")
    subject: Subject
    variant: Variant | None = None
    action: Action3D = Field(description="One of the subject's actions, as the narration describes it.")
    obstacle: Obstacle | None = None
    shot: Shot | None = None
    setting: Setting | None = None
    weather: Weather | None = Field(default=None, description="Only when the narration or source says so.")
    effect: Literal["smoke", "fire", "explosion"] | None = Field(default=None, description="Only when the narration says so.")
    effect_x: float | None = None
    cue: str | None = Field(default=None, description="The exact words of the scene's narration at which the key moment happens.")
    subject_name: str | None = Field(default=None, description="A short name for the thing shown; the same name in every scene that shows it.")
    priority: int = Field(default=2, description="1 = the story needs this moment seen, 3 = nice to have.")
    backdrop: SkipJsonSchema[str | None] = None  # a stage scene: the place it happens, painted behind it
    overlay: SkipJsonSchema[str | None] = None  # a data scene acted out in 3D: its template, drawn over it
    # Shows a manifest entity in a scene the manifest checked it is in (fyt.manifest.checked): that, not
    # the catalog's keywords in the scene's own words, is what grounds it ("its sails half-raised").
    in_story: SkipJsonSchema[bool] = False


class VisualPlan(BaseModel):
    reconstructions: list[Reconstruction] = Field(description="The scenes to act out in 3D; scenes left out keep their own template.")


PLAN_GUIDE = """You are the visual director of a YouTube channel that tells true stories with motion graphics. The
script below is final and fact-checked. Decide which scenes are acted out as 3D reconstructions: a
cel-shaded 3D scene of what the narration describes, filmed by a moving camera. The other scenes keep
their maps, charts, timelines and photos.

{catalog}

Rules:
- Reconstruct the moments a viewer should see happen: the departure, the collision, the launch, the
  eruption, the wave, the fire, the sinking. A story about an incident may need many; a story told best
  in maps and charts may need few or none. There is no quota.
- Only scenes marked [can change] may be reconstructed. Keep scenes that carry figures, quotes or places.
- Show only what that scene's narration says. Set weather or an effect only when the narration or the
  source says so. Never show a crash, fire or sinking the narration doesn't describe.
- cue: copy the exact words from the scene's narration at which the key moment happens ("hit the iceberg").
- subject_name: give the same short name to the same ship, plane, train, city or volcano in every scene
  so it looks the same each time; keep its variant and setting the same too unless the story changes them.
  When the story names the exact object, use its name ("Titanic", "Saturn V", "Boeing 747"; for a science
  scene the compound, "caffeine"): its real features are then drawn from published data.
- Science and technology are 3D too: a molecule, DNA, a crystal, a neural network, a chip. Use them where
  seeing the structure explains the idea better than words on screen.
- Vary the shots from scene to scene. Rank each reconstruction by how much the story needs it."""


def _catalog_text() -> str:
    lines = ["3D subjects (variants; actions; obstacles):"]
    for name, s in scenes3d.subjects().items():
        if s.get("planner") is False:
            continue
        acts = ", ".join(f"{a} ({v['describe']})" for a, v in s["actions"].items())
        obs = f"; obstacles {', '.join(s['obstacles'])}" if s["obstacles"] else ""
        lines.append(f"- {name}: {s['describe']}. Variants {', '.join(s['variants'])}; settings {', '.join(s['settings'])}; actions {acts}{obs}.")
    lines.append("Shots: " + ", ".join(f"{k} ({v})" for k, v in scenes3d.catalog()["shots"].items()) + ".")
    return "\n".join(lines)


def convertible(scene: ScriptScene) -> bool:
    if scene.type not in CONVERTIBLE:
        return False
    return not (scene.type == "broll" and scene.image is not None)  # a real photo of the subject stays


def seconds(cfg: Config, scene: ScriptScene) -> float:
    return len(scene.narration.split()) / WORDS_PER_SECOND.get(cfg.format, 2.6) + 0.3


def _llm_plan(cfg: Config, script: Script, notes: str) -> list[Reconstruction]:
    rows = []
    for i, s in enumerate(script.scenes, 1):
        tag = "can change" if convertible(s) else "keep"
        extra = f" ({s.subject} {s.action})" if s.type == "world" else ""
        rows.append(f"Scene {i} ({s.type}{extra}) [{tag}]: {s.heading or ''} | {s.narration}")
    user = (
        f"Title: {script.title}\nCore message: {script.core_message}\n\n"
        f"<source>\n{notes[:2500]}\n</source>\n\n<script>\n" + "\n".join(rows) + "\n</script>"
    )
    plan = llm.structured(cfg, PLAN_GUIDE.format(catalog=_catalog_text()), user, VisualPlan, max_tokens=2500)
    return plan.reconstructions


def _best(text: str, options: dict[str, list[str]]) -> str | None:
    hits = {k: scenes3d.count(text, words) for k, words in options.items()}
    best = max(hits, key=hits.get) if hits else None
    return best if best and hits[best] else None


def rule_plan(script: Script, notes: str = "") -> list[Reconstruction]:
    """A plan from the catalog's keywords alone: what the fallback planner reconstructs, and how."""
    story = " ".join([script.title] + [s.narration for s in script.scenes]) + " " + notes[:4000]
    subj = scenes3d.subjects()
    story_scores = {k: scenes3d.count(story, s["keywords"]) for k, s in subj.items()}
    dominant = max(story_scores, key=story_scores.get)
    if story_scores[dominant] < 3:
        dominant = None
    year = scenes3d.story_year(story)
    variants = {k: scenes3d.variant_for(k, story, year) for k in subj}
    out: list[Reconstruction] = []
    last: dict[str, Reconstruction] = {}
    struck: set[str] = set()
    previous = -2
    for i, scene in enumerate(script.scenes, 1):
        if not convertible(scene):
            continue
        text = " ".join(x for x in (scene.narration, scene.heading or "") if x)
        best_subject, best_score, best_action = None, 0, None
        # "It struck the Yucatan": a scene that goes on from the one before talks about the same subject.
        recent = out[-1].subject if out and out[-1].scene == i - 1 else None
        for name, s in subj.items():
            if s.get("planner") is False:
                continue
            lead = name in (dominant, recent)
            event = next((a for a, v in s["actions"].items() if v.get("event") and scenes3d.find(scene.narration, v["keywords"])), None)
            score = 3 * min(2, scenes3d.count(text, s["keywords"])) + (3 if event else 0) + (1 if lead else 0)
            if lead and not event and any(
                not v.get("neutral") and scenes3d.find(scene.narration, v["keywords"]) for v in s["actions"].values()
            ):
                score += 2  # the story's subject doing something it names ("the first stage fell away")
            if event and not scenes3d.count(text, s["keywords"]) and not lead:
                score = 0  # an event word alone ("struck") doesn't say what struck
            if score > best_score:
                best_subject, best_score, best_action = name, score, event
        if best_subject is None or best_score < 3:
            continue
        s = subj[best_subject]
        action = best_action or next(
            (a for a, v in s["actions"].items() if not v.get("event") and not v.get("neutral") and scenes3d.find(scene.narration, v["keywords"])),
            None,
        )
        # A neutral scene (the ship sailing on) is worth showing, but not back to back.
        if action is None and i - previous < 2:
            continue
        # After its disaster the subject doesn't sail or cross on as if nothing happened, unless the scene
        # names it again ("the inquiry found the bridge..." is not the train crossing the bridge).
        if best_action is None and best_subject in struck and not scenes3d.count(text, s["keywords"]):
            continue
        if scene.type in ACTED_ONLY and (action is None or scenes3d.subjects()[best_subject]["actions"][action].get("neutral")):
            continue
        action = action or scenes3d.neutral_action(best_subject)
        before = last.get(best_subject)
        setting = next((k for k, words in SETTING_WORDS.items() if k in s["settings"] and scenes3d.find(text, words)), None)
        setting = setting or (before.setting if before else None) or (s["settings"][0] if s["settings"] else None)
        weather = next((w for w, words in scenes3d.catalog()["weather"].items() if words and scenes3d.find(text, words)), None)
        weather = weather or (before.weather if before else None)
        effect = None
        if best_subject in ("aircraft", "ship", "train", "vehicle", "rocket"):
            effect = next((e for e, words in scenes3d.catalog()["effects"].items() if scenes3d.find(scene.narration, words)), None)
        obstacle = None
        if best_subject == "train" and action == "collide":
            obstacle = "train"
        if best_subject == "vehicle" and action == "crash":
            obstacle = "car" if scenes3d.find(scene.narration, ["car", "vehicle", "truck", "bus"]) else "wall"
        shot = scenes3d.default_shot(best_subject, action) or SHOT_CYCLE[len(out) % len(SHOT_CYCLE)]
        if before is not None and before.shot == shot and before.scene >= i - 2:
            # The same subject again soon after: a new angle, so it doesn't look like the same scene twice.
            shot = SHOT_CYCLE[(SHOT_CYCLE.index(shot) + 1) % len(SHOT_CYCLE)] if shot in SHOT_CYCLE else "wide"
        r = Reconstruction(
            scene=i, subject=best_subject, variant=variants[best_subject], action=action, obstacle=obstacle, shot=shot,
            setting=setting, weather=weather, effect=effect, subject_name=f"{best_subject}:{variants[best_subject]}",
            priority=1 if scenes3d.is_event(best_subject, action) else 2 if action != scenes3d.neutral_action(best_subject) else 3,
        )
        out.append(r)
        last[best_subject] = r
        if best_action:
            struck.add(best_subject)
        previous = i
    return out


def apply(script: Script, plan: list[Reconstruction], notes: str = "") -> tuple[Script, dict[int, int]]:
    """The script with the plan's reconstructions made into world scenes, every world scene guarded.
    Returns the script and each reconstructed scene's priority, by scene index (from 0)."""
    scenes = list(script.scenes)
    ranked: dict[int, int] = {}
    story = " ".join([script.title] + [s.narration for s in script.scenes])
    for r in sorted(plan, key=lambda r: r.scene):
        k = r.scene - 1
        if not (0 <= k < len(scenes)) or k in ranked or not (convertible(scenes[k]) or (r.overlay and scenes[k].type == r.overlay)):
            continue
        old = scenes[k]
        if old.type not in ("world", "aircraft", "ship") and r.subject in scenes3d.subjects() and r.subject != "stage":
            # The planner's own picks must show what the scene talks about, and only a thing the
            # engine can draw truthfully: no airliner over a narration about a bear, none for a Cessna.
            told = " ".join(x for x in (old.narration, old.heading or "") if x)
            before = scenes3d.legacy_to_world(scenes[k - 1]).subject if k else None
            if not r.in_story and not scenes3d.grounded(r.subject, told, before):
                continue
            if scenes3d.unlike(r.subject, story) and not assets.identify(r.subject, told, story):
                continue
        if old.type in ("world", "aircraft", "ship"):
            # The scriptwriter already staged this one: keep what they chose, fill in only what's missing.
            base = scenes3d.legacy_to_world(old)
            plan_fields = {"subject": r.subject, "variant": r.variant, "action": r.action, "obstacle": r.obstacle, "shot": r.shot,
                           "setting": r.setting, "weather": r.weather, "effect": r.effect, "cue": r.cue, "subject_name": r.subject_name}
            scenes[k] = base.model_copy(update={f: v for f, v in plan_fields.items() if getattr(base, f, None) is None})
            ranked[k] = max(1, min(3, r.priority))
            continue
        scenes[k] = old.model_copy(update={
            "type": "world", "subject": r.subject, "variant": r.variant, "action": r.action, "obstacle": r.obstacle,
            "shot": r.shot, "setting": r.setting, "weather": r.weather, "effect": r.effect, "effect_x": r.effect_x,
            "cue": r.cue, "subject_name": r.subject_name, "image": None, "broll_query": None, "actors": None,
            "backdrop": r.backdrop, "maneuver": None, "vessel": None, "ship_action": None,
            "fallback": old.model_dump(exclude_none=True), "overlay": r.overlay,
            "heading": old.heading or (old.text if old.type == "title" else None),
        })
        ranked[k] = max(1, min(3, r.priority))
    # Weather the script or the sources describe may be shown in any scene of the story (the storm the
    # narrator mentioned a scene earlier is still blowing); events still need this scene's own words.
    context = " ".join(s.narration for s in script.scenes) + " " + notes
    for k, s in enumerate(scenes):
        if s.type in ("world", "aircraft", "ship"):
            scenes[k] = scenes3d.guard(s, context)
            ranked.setdefault(k, 2)  # the scriptwriter's own reconstructions
    return script.model_copy(update={"scenes": scenes}), ranked


def within_budget(cfg: Config, original: Script, script: Script, ranked: dict[int, int]) -> tuple[Script, list[int]]:
    """Keep the highest-ranked reconstructions that fit the render budget; the rest go back to what they
    were (or a statement, for the scriptwriter's own). Returns the script and the scenes put back."""
    budget = cfg.visuals.world_seconds(cfg.format)
    order = sorted(ranked, key=lambda k: (ranked[k], k))
    used, dropped = 0.0, []
    scenes = list(script.scenes)
    for k in order:
        t = seconds(cfg, scenes[k])
        if used + t <= budget:
            used += t
            continue
        dropped.append(k)
        before = original.scenes[k]
        scenes[k] = before if before.type not in ("world", "aircraft", "ship") else scenes[k].model_copy(
            update={"type": "statement", "heading": scenes[k].heading or " ".join(scenes[k].narration.split()[:6])}
        )
    return script.model_copy(update={"scenes": scenes}), dropped


def kind(scene: ScriptScene) -> str:
    """How a scene is drawn: 3D, 2.5D (photo collage, illustration) or 2D motion graphics."""
    if scene.type in ("world", "aircraft", "ship"):
        return "3D"
    if scene.type in ("broll", "story", "map", "title") or scene.image is not None:
        return "2.5D"
    return "2D"


# --- the story's own entities (fyt/manifest.py) ---------------------------------------------


def _about(e: manifest.Entity) -> str:
    return " ".join([e.name, e.kind, *e.search])


def stands_for(subject: str, e: manifest.Entity) -> bool:
    """A catalog module may draw the entity only if the entity is the kind of thing it models (an airliner
    for an airliner, not for a Cessna or a bear)."""
    s = scenes3d.subjects()[subject]
    if s.get("planner") is False:
        return False
    about = _about(e)
    # Whole words only: the catalog's loose prefix match would make "cargo" a "car".
    named = any(re.search(rf"\b{re.escape(k.strip().lower())}(e?s)?\b", about.lower()) for k in s["keywords"] if k.strip())
    # `not_for`: kinds its models can't stand in for that a story may still mention beside the real
    # subject (a lifeboat beside its ship), so they block only this entity, not the story's other scenes.
    return named and not scenes3d.unlike(subject, about + " " + e.look) and not scenes3d.find(about, s.get("not_for", []))


def _place_fits(subject: str, p: manifest.Place) -> bool:
    return bool(scenes3d.count(f"{p.name} {p.look}", scenes3d.subjects()[subject]["keywords"]))


def story_fit(script: Script, story: Manifest, recon: list[Reconstruction]) -> tuple[list[Reconstruction], list[dict]]:
    """The planner's catalog picks that show something the story is about: each must stand for an entity
    (or, for a city or landscape, a place) the manifest lists in that scene; it is then named after that
    entity, so it looks the same wherever it appears. The rest are dropped, with the reason."""
    kept, dropped = [], []
    for r in recon:
        if r.subject == "stage":
            continue
        ents = [e for e in manifest.in_scene(story, r.scene) if stands_for(r.subject, e)]
        places = [p for p in story.places if r.scene in p.scenes and _place_fits(r.subject, p)]
        if ents:
            # The entity decides what the module draws: an 1872 brigantine is a sailing ship, whatever the
            # planner picked (it had drawn the Mary Celeste as a container ship).
            variant = scenes3d.variant_for(r.subject, f"{_about(ents[0])} {ents[0].look}", scenes3d.story_year(
                " ".join([script.title] + [x.narration for x in script.scenes])))
            kept.append(r.model_copy(update={"subject_name": ents[0].id, "in_story": True, "variant": variant or r.variant}))
        elif places and r.subject in ("city", "landscape"):
            kept.append(r.model_copy(update={"subject_name": places[0].id, "in_story": True}))
        else:
            dropped.append({"scene": r.scene, "subject": r.subject, "why": "no entity in this scene is that kind of thing"})
    return kept, dropped


def _setting(text: str, settings: list[str]) -> str | None:
    return next((k for k, words in SETTING_WORDS.items() if k in settings and scenes3d.find(text, words)), None)


def _module_scene(script: Script, m: manifest.Moment, e: manifest.Entity, subject: str, where: str, n: int) -> Reconstruction:
    """The catalog module that models the entity's kind (a sailing ship for the Mary Celeste) acting out a
    manifest moment: an action of its own only when the moment is documented and its cue names it."""
    s = scenes3d.subjects()[subject]
    narration = script.scenes[m.scene - 1].narration
    action = None
    if m.documented and m.cue:
        action = next((a for a, v in s["actions"].items() if not v.get("neutral") and scenes3d.find(m.cue, v["keywords"])), None)
    action = action or scenes3d.neutral_action(subject)
    text = f"{narration} {where}"
    setting = next((k for k, words in SETTING_WORDS.items() if k in s["settings"] and scenes3d.find(text, words)), None)
    return Reconstruction(
        scene=m.scene, subject=subject, variant=scenes3d.variant_for(subject, f"{_about(e)} {e.look}", scenes3d.story_year(" ".join([script.title] + [x.narration for x in script.scenes]))),
        action=action, shot=scenes3d.default_shot(subject, action) or SHOT_CYCLE[n % len(SHOT_CYCLE)],
        setting=setting or (s["settings"][0] if s["settings"] else None), cue=m.cue or None, subject_name=e.id,
        priority=m.priority if m.documented else 3, in_story=True,
    )


def as_stage(script: Script, story: Manifest, r: Reconstruction, n: int) -> Reconstruction:
    """A catalog pick that stands for a manifest entity, turned into a stage scene of that entity, for its
    story world to draw (the moment's motion, its place behind it)."""
    m = next((x for x in story.moments if x.scene == r.scene), None)
    p = manifest.place(story, m.place) if m else None
    where = f"{p.name}, {p.look}" if p else ""
    return Reconstruction(
        scene=r.scene, subject="stage", variant="model", action=m.motion if m and m.entity == r.subject_name else "present",
        shot=STAGE_SHOTS[n % len(STAGE_SHOTS)], setting=_setting(f"{script.scenes[r.scene - 1].narration} {where}", scenes3d.subjects()["stage"]["settings"]) or ("countryside" if p else "room"),
        cue=r.cue or (m.cue if m else None), subject_name=r.subject_name, backdrop=where or None, priority=r.priority, in_story=True,
    )


def stage_plan(script: Script, story: Manifest, taken: set[int], modules: bool = True) -> list[Reconstruction]:
    """A 3D scene for each moment the manifest lists that the planner left out: the catalog module that
    models the entity's kind if there is one, otherwise the stage, where the entity's own model
    (fyt.assetlib) does what the narration says in front of its place."""
    out: list[Reconstruction] = []
    settings = scenes3d.subjects()["stage"]["settings"]
    for m in story.moments:
        if m.scene in taken or not 1 <= m.scene <= len(script.scenes) or not convertible(script.scenes[m.scene - 1]):
            continue
        e = manifest.entity(story, m.entity)
        if e is None:
            continue
        p = manifest.place(story, m.place)
        where = f"{p.name}, {p.look}" if p else ""
        module = next((subj for subj in scenes3d.subjects() if stands_for(subj, e)), None) if modules else None
        if module:
            out.append(_module_scene(script, m, e, module, where, len(out)))
            continue
        shot = STAGE_SHOTS[len(out) % len(STAGE_SHOTS)]
        if out and out[-1].subject_name == e.id and out[-1].shot == shot:
            shot = "wide" if shot != "wide" else "side"
        out.append(Reconstruction(
            scene=m.scene, subject="stage", variant="model", action=m.motion, shot=shot,
            setting=_setting(f"{script.scenes[m.scene - 1].narration} {where}", settings) or ("countryside" if p else "room"),
            cue=m.cue or None, subject_name=e.id, backdrop=where or None,
            priority=m.priority if m.documented else 3,
        ))
    return out


def fill(cfg: Config, script: Script, story: Manifest, recon: list[Reconstruction]) -> list[Reconstruction]:
    """3D first: stage scenes of the story's own cast for scenes the plan left in 2D, until 3D carries
    `visuals.world_share` of the runtime. Narrative scenes go first, then stat, proportion, list and
    timeline scenes, which keep their figures drawn over the 3D scene; a scene goes only when the
    manifest lists an entity in it to show (never a stock stand-in), its moment's motion when it has one.
    Ranked below the story's own moments, so the render budget drops these first."""
    from fyt import worldgen

    scenes = script.scenes
    total = sum(seconds(cfg, s) for s in scenes) or 1.0
    taken = {r.scene for r in recon} | {i for i, s in enumerate(scenes, 1) if s.type in ("world", "aircraft", "ship")}
    have = sum(seconds(cfg, scenes[k - 1]) for k in taken if 1 <= k <= len(scenes))
    settings = scenes3d.subjects()["stage"]["settings"]
    picks = []
    for i, s in enumerate(scenes, 1):
        data = s.type in OVERLAYS
        if i in taken or not (convertible(s) or data):
            continue
        moment = next((m for m in story.moments if m.scene == i and manifest.entity(story, m.entity)), None)
        ents = [e for e in manifest.in_scene(story, i) if not worldgen.is_place(e)]
        # the moment's entity, else the first entity in the scene that can move in it
        lead = next((e.id for e in ([manifest.entity(story, moment.entity)] if moment else []) + ents if _moves(s, e, moment, story, i)), None)
        if lead is None:
            continue  # a 3D scene where nothing would move is a still picture: the 2D scene says more
        picks.append(((1 if data else 0, 0 if moment and moment.documented else 1, i), i, s, moment, lead))
    out: list[Reconstruction] = []
    for _, i, s, moment, lead in sorted(picks):
        if have / total >= cfg.visuals.world_share(cfg.format):
            break
        p = manifest.place(story, moment.place) if moment and moment.place else next((x for x in story.places if i in x.scenes), None)
        where = f"{p.name}, {p.look}" if p else ""
        out.append(Reconstruction(
            scene=i, subject="stage", variant="model", action=moment.motion if moment else "present",
            shot=STAGE_SHOTS[(len(recon) + len(out)) % len(STAGE_SHOTS)],
            setting=_setting(f"{s.narration} {where}", settings) or ("countryside" if p else "room"),
            cue=(moment.cue if moment else None) or None, subject_name=lead, backdrop=where or None, priority=3,
            overlay=s.type if s.type in OVERLAYS else None, in_story=True,
        ))
        have += seconds(cfg, s)
    return out


WATER = ("river", "lake", "sea", "ocean", "water", "harbour", "harbor", "bay", "beach", "coast", "swamp", "waterfall")


def _moves(s: ScriptScene, e: manifest.Entity, moment: manifest.Moment | None, story: Manifest, scene: int) -> bool:
    """Whether a 3D scene of this entity would show something moving: its moment's motion, a living thing
    or a vehicle the narration doesn't say is dead, stuffed, on show or stopped, or water around it."""
    from fyt import worldgen

    if moment and moment.entity == e.id and moment.motion not in ("present", ""):
        return True
    still = scenes3d.find(s.narration, list(worldgen.STILL))
    arche = worldgen.archetype_of(e)
    if not still and arche in worldgen.LIVING:
        return True
    if not still and arche == "vehicle" and not scenes3d.find(s.narration, list(worldgen.LANDED) + ["parked", "abandoned", "crash"]):
        return True
    p = manifest.place(story, moment.place) if moment and moment.place else next((x for x in story.places if scene in x.scenes), None)
    return bool(p) and scenes3d.find(f"{p.name} {p.look}", list(WATER))


def share(cfg: Config, script: Script) -> float:
    """The share of a script's runtime drawn in 3D."""
    total = sum(seconds(cfg, s) for s in script.scenes) or 1.0
    return sum(seconds(cfg, s) for s in script.scenes if kind(s) == "3D") / total


def plan(cfg: Config, script: Script, notes: str = "", log: Callable[[str], None] = print,
         story: Manifest | None = None) -> tuple[Script, dict]:
    """Give the script its visual plan. Returns the planned script and a report of what was decided.
    With the story's manifest, every 3D scene shows one of the story's own entities."""
    planner = "model"
    try:
        recon = _llm_plan(cfg, script, notes)
    except Exception as e:  # the catalog's keywords still give every video a plan
        log(f"visual planner unavailable ({e}); planning from the catalog's keywords")
        planner, recon = "rules", rule_plan(script, notes)
    off_story: list[dict] = []
    filled: list[Reconstruction] = []
    recon = [r for r in recon if r.subject != "stage"]  # stage scenes come from the manifest only
    if story is not None:
        recon, off_story = story_fit(script, story, recon)
        if cfg.visuals.story_worlds:
            # every entity is drawn by its story world's generators, not a catalog module
            recon = [as_stage(script, story, r, n) if manifest.entity(story, r.subject_name) else r for n, r in enumerate(recon)]
        recon += stage_plan(script, story, {r.scene for r in recon}, modules=not cfg.visuals.story_worlds)
        if cfg.visuals.story_worlds:
            filled = fill(cfg, script, story, recon)
            recon += filled
    planned, ranked = apply(script, recon, notes)
    planned, dropped = within_budget(cfg, script, planned, ranked)
    planned = assets.resolve(planned)
    report = {
        "planner": planner,
        "budget_seconds": cfg.visuals.world_seconds(cfg.format),
        "world_seconds": round(sum(seconds(cfg, s) for s in planned.scenes if s.type == "world"), 1),
        "dropped_for_budget": [k + 1 for k in dropped],
        "target_share": cfg.visuals.world_share(cfg.format),
        "world_share": round(share(cfg, planned), 3),
        "filled": sorted(r.scene for r in filled if planned.scenes[r.scene - 1].type == "world"),
        "off_story": off_story,
        "scenes": [
            {"scene": i, "type": s.type, "kind": kind(s)} | ({"overlay": s.overlay} if s.overlay else {})
            | ({"subject": s.subject, "variant": s.variant, "action": s.action, "setting": s.setting, "weather": s.weather,
                "cue": s.cue, "illustrative": s.illustrative, "label": s.label,
                "model": {k: (s.model or {}).get(k) for k in ("id", "level", "title")}} if s.type == "world" else {})
            for i, s in enumerate(planned.scenes, 1)
        ],
    }
    return planned, report


def summary(report: dict) -> str:
    kinds = [s["kind"] for s in report["scenes"]]
    world = [s for s in report["scenes"] if s["type"] == "world"]
    parts = [f"{kinds.count(k)} {k}" for k in ("3D", "2.5D", "2D") if kinds.count(k)]
    acts = ", ".join(f"{s['subject']} {s['action']}" for s in world[:6]) + ("..." if len(world) > 6 else "")
    cover = f" ({report['world_share']:.0%} of the runtime in 3D, aiming for {report['target_share']:.0%})" if "world_share" in report else ""
    return f"visual plan ({report['planner']}): " + ", ".join(parts) + cover + (f"; 3D: {acts}" if world else "")


def dumps(report: dict) -> str:
    return json.dumps(report, indent=2)


def painted(script: Script) -> tuple[Script, list[int]]:
    """With the storyboard on, a 3D scene that is only an illustration (the narration describes no
    action it shows) goes back to the scene it replaced, which then gets a painted picture of what the
    narration actually says, in the same style as the rest of the video. Reconstructions of documented
    events stay, and so do scientific and technology models, which no illustration can replace."""
    scenes, back = list(script.scenes), []
    for i, s in enumerate(scenes):
        # A generated story world is already drawn in the video's one style, from the story's own design.
        if s.type != "world" or not s.fallback or s.subject in ("science", "technology") or s.world:
            continue
        if s.label == "ILLUSTRATION" or s.illustrative:
            scenes[i] = ScriptScene.model_validate(s.fallback)
            back.append(i)
    return script.model_copy(update={"scenes": scenes}), back
