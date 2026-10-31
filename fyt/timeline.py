"""Turn a script + voiced clips into renderer props (scene timings, captions)."""

from __future__ import annotations

import re
import zlib

from fyt import artdirect, journey, scenes3d, whatif
from fyt.config import Config
from fyt.models import Media, Music, RenderBeat, RenderProps, RenderScene, Script, ScriptScene, Sfx, Word

TAIL_SECONDS = 1.5  # hold the last scene after the voice ends
THREE_D = ("aircraft", "ship", "world")  # scenes drawn in 3D: their clouds, cities and liveries come from the video's seed


def build_props(
    cfg: Config,
    script: Script,
    spans: list[tuple[float, float]],
    clip_words: list[list[Word]],
    media: dict[int, Media],
    voice: str | None,
    music: str | None,
    sfx: str | None = None,
    shots: dict[int, list[Media]] | None = None,
    beats: dict[int, list[RenderBeat]] | None = None,
    look: str | None = None,
) -> RenderProps:
    if len(spans) != len(script.scenes):
        raise ValueError("one audio span per scene is required")
    # Long videos hold an end card after the voice, where YouTube's end screen (subscribe, next video) sits.
    end_card = cfg.growth.end_card_seconds if cfg.format == "long" else 0.0
    duration = (spans[-1][1] if spans else 0) + TAIL_SECONDS + end_card
    scenes: list[RenderScene] = []
    captions: list[Word] = []
    # The video's first map opens on a globe that dives in; later maps start from the flat map.
    video_seed = zlib.crc32(script.title.encode()) & 0x7FFFFFFF
    first_map = next((i for i, s in enumerate(script.scenes) if s.type == "map"), None)
    # A long video's chapters after the first open on a card: a beat to breathe, and a sign of progress.
    # The first chapter is the cold open, which plays without one.
    chapters = {c.scene: (n, c.title) for n, c in enumerate(script.chapters or [], 1) if n > 1 and c.scene > 0}
    if cfg.format != "long":
        chapters = {}
    level_before = 0.0  # What If videos: each scene's world starts where the last one left it
    for i, (scene, (start, _end)) in enumerate(zip(script.scenes, spans)):
        scene = scenes3d.legacy_to_world(scene)
        # A scene stays on screen until the next one starts, so pauses are covered.
        vis_start = 0.0 if i == 0 else start
        vis_end = spans[i + 1][0] if i + 1 < len(spans) else duration
        scenes.append(
            RenderScene(
                id=f"s{i + 1}",
                type=scene.type,
                start=round(vis_start, 3),
                end=round(vis_end, 3),
                heading=scene.heading,
                text=scene.narration if scene.type == "journey" else scene.text,  # a journey shows its line
                items=scene.items,
                value=scene.value,
                prefix=scene.prefix,
                suffix=scene.suffix,
                data=scene.data,
                events=scene.events,
                left=scene.left,
                right=scene.right,
                leftTitle=scene.left_title,
                rightTitle=scene.right_title,
                author=scene.author,
                media=media.get(i),
                shots=(shots or {}).get(i) or None,
                beats=(beats or {}).get(i) or None,
                places=scene.places,
                route=scene.route,
                vehicle=scene.vehicle,
                regions=scene.regions,
                regionChange=scene.region_change,
                yearFrom=scene.year_from,
                yearTo=scene.year_to,
                globe=True if scene.type == "map" and i == first_map else None,
                lines=scene.lines,
                setting=scene.setting,
                backdropSrc=scene.backdrop_src,
                overlay=scene.overlay,
                world=timed_world(scene.world, clip_words[i], start - vis_start, vis_end - vis_start),
                actors=[a for a in scene.actors or [] if a.src] or None,
                effect=scene.effect,
                effectX=scene.effect_x,
                effectY=scene.effect_y,
                effectAt=key_moment(scene, clip_words[i], start - vis_start, vis_end - vis_start),
                effectSrc=scene.effect_src,
                maneuver=scene.maneuver,
                shot=scene.shot,
                altitudeFrom=scene.altitude_from,
                altitudeTo=scene.altitude_to,
                vessel=scene.vessel,
                shipAction=scene.ship_action,
                obstacle=scene.obstacle,
                weather=scene.weather,
                subject=scene.subject,
                variant=scene.variant,
                action=scene.action,
                subjectName=scene.subject_name,
                illustrative=scene.illustrative,
                model=scene.model,
                label=scene.label,
                seed=video_seed if scene.type in THREE_D else None,
                revealTimes=reveal_times(revealed(scene), clip_words[i], start - vis_start),
                landTimes=land_times(scene, clip_words[i], start - vis_start),
                camera=scene.camera,
                transition=scene.transition,
                chapter=chapters[i][1] if i in chapters else None,
                chapterNumber=chapters[i][0] if i in chapters else None,
                clock=scene.clock,
                clockNote=scene.clock_note,
                level=scene.level,
                levelFrom=level_before if scene.level is not None else None,
            )
        )
        if scene.level is not None:
            level_before = scene.level
        captions.extend(
            Word(word=w.word, start=round(w.start + start, 3), end=round(w.end + start, 3)) for w in clip_words[i]
        )
    return RenderProps(
        format=cfg.format,
        title=script.title,
        duration=round(duration, 3),
        theme=artdirect.theme(cfg.theme.model_dump(), look, script) if look else cfg.theme.model_dump() | {"era": artdirect.era(script)},
        voice=voice,
        music=Music(src=music, volume=cfg.music_volume) if music else None,
        sfx=Sfx(dir=sfx, volume=cfg.sfx_volume) if sfx else None,
        scenes=scenes,
        captions=captions,
        showCaptions=cfg.captions,
        showVisualizer=cfg.visualizer,
        badge=(script.series or None) if cfg.growth.series_badge and not journey.is_journey(script) else None,  # a journey's readout sits there
        subscribe=(whatif.SUBSCRIBE if script.series == whatif.SERIES else cfg.growth.subscribe_for(script.title)) or None,
        endCard=round(end_card, 3),
        journey=journey.build(script, spans) if journey.is_journey(script) else None,
    )


STOPWORDS = {"from", "with", "into", "they", "them", "their", "that", "this", "were", "what", "when", "where", "there", "been", "have"}


def _stems(text: str) -> set[str]:
    words = ("".join(c if c.isalnum() else " " for c in text.lower())).split()
    return {w[:5] for w in words if len(w) >= 4 and w not in STOPWORDS}


def revealed(scene: ScriptScene) -> list[str] | None:
    """What a scene shows one piece at a time as it is said: an evidence board's clues, a cycle's
    steps, a statement's words, a scale scene's things (smallest first, the order they are drawn in), or the [bracketed]
    words a document scene starts with blacked out."""
    if scene.type in ("evidence", "cycle") or scene.overlay == "list":
        return scene.items
    if scene.overlay == "timeline":
        return [e.label for e in scene.events or []] or None
    if scene.type == "statement" and (scene.text or "").strip():
        return scene.text.split()
    if scene.type == "statement" and (scene.heading or "").strip():  # the renderer says the heading instead
        return scene.heading.split()
    if scene.type == "scale":
        return [d.label for d in sorted((d for d in scene.data or [] if d.value > 0), key=lambda d: d.value)][:5] or None
    if scene.type == "document":
        return re.findall(r"\[([^\]]+)\]", scene.text or "") or None
    return None


def reveal_times(clues: list[str] | None, words: list[Word], offset: float) -> list[float] | None:
    """When the narration first mentions each clue (or hidden phrase), so it appears as it is said.
    Clues stay in order; one the narration never names is shown halfway to the next. None when
    nothing matches, and the renderer spreads them evenly."""
    if not clues or not words:
        return None
    times: list[float | None] = []
    after = 0
    for clue in clues:
        stems = _stems(clue)
        hit = next((j for j in range(after, len(words)) if _stems(words[j].word) & stems), None)
        times.append(None if hit is None else round(words[hit].start + offset, 3))
        if hit is not None:
            after = hit + 1
    if all(t is None for t in times):
        return None
    end = words[-1].end + offset
    filled = list(times)
    for k, t in enumerate(filled):
        if t is None:
            prev = filled[k - 1] if k else offset
            nxt = next((x for x in times[k + 1:] if x is not None), end)
            filled[k] = round((prev + nxt) / 2, 3)
    return filled


# Spoken figures: "36,417", "thirty-six thousand", "three hundred and thirty eight", "two thirds".
_UNITS = {w: i for i, w in enumerate(
    "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen "
    "seventeen eighteen nineteen".split()
)}
_UNITS.update({w: 10 * i for i, w in enumerate("_ _ twenty thirty forty fifty sixty seventy eighty ninety".split()) if i > 1})
_UNITS.update({"a": 1, "an": 1})
_SCALES = {"thousand": 1e3, "million": 1e6, "billion": 1e9, "trillion": 1e12}
_FRACTIONS = {"half": 2, "halves": 2, "third": 3, "thirds": 3, "quarter": 4, "quarters": 4}


def _token(word: str) -> str:
    return re.sub(r"[^\w.,%-]", "", word.lower()).strip(".,")


def _number_parts(word: str) -> list[str] | None:
    """The number words a written word stands for, or None if it isn't part of a figure."""
    t = _token(word)
    if re.fullmatch(r"\d[\d,]*(\.\d+)?(%|[kmb])?", t):
        return [t]
    parts = [x for x in t.split("-") if x]
    if parts and all(x in _UNITS or x in _SCALES or x in _FRACTIONS or x in ("hundred", "percent") for x in parts):
        return parts
    return None


def _value(parts: list[str]) -> float | None:
    total, cur, seen = 0.0, 0.0, False
    for p in parts:
        m = re.fullmatch(r"(\d[\d,]*(?:\.\d+)?)(%|[kmb])?", p)
        if m:
            cur += float(m.group(1).replace(",", "")) * {"k": 1e3, "m": 1e6, "b": 1e9}.get(m.group(2) or "", 1)
            seen = True
        elif p in _UNITS:
            cur += _UNITS[p]
            seen = seen or p not in ("a", "an")
        elif p == "hundred":
            cur = (cur or 1) * 100
            seen = True
        elif p in _SCALES:
            total += (cur or 1) * _SCALES[p]
            cur, seen = 0.0, True
        elif p in _FRACTIONS:
            cur = (cur or 1) / _FRACTIONS[p]
            seen = True
    return total + cur if seen else None


def spoken_numbers(words: list[Word]) -> list[tuple[float, float, float, bool]]:
    """Each figure the narrator says: (value, start, end, is_share) in clip seconds. is_share marks a
    fraction or a percentage, whose value is then a percentage ("two thirds" -> 66.7)."""
    out, j = [], 0
    while j < len(words):
        parts = _number_parts(words[j].word)
        if parts is None or parts in (["a"], ["an"]):
            j += 1
            continue
        k, run = j, list(parts)
        while k + 1 < len(words) and not re.search(r"[.,;:!?%]$", words[k].word):
            nxt = _number_parts(words[k + 1].word)
            digits = run[-1][0].isdigit()
            # "three hundred and thirty eight": an "and" after a hundred or a thousand stays in the figure.
            if (
                nxt is None and _token(words[k + 1].word) == "and" and not digits
                and any(p == "hundred" or p in _SCALES for p in run)
                and k + 2 < len(words) and (after := _number_parts(words[k + 2].word)) and after[0] in _UNITS
            ):
                k += 1
                continue
            # Spelled words join up ("thirty six thousand"); a digit only takes a scale ("3 million").
            if nxt is None or nxt in (["a"], ["an"]) or nxt[0][0].isdigit() or (digits and nxt[0] not in _SCALES):
                break
            run += nxt
            k += 1
        value = _value(run)
        if value is not None:
            fraction = run[-1] in _FRACTIONS
            share = fraction or run[-1] == "percent" or run[-1].endswith("%")
            if not share and k + 1 < len(words) and _token(words[k + 1].word) in ("percent", "per"):
                share = True
            out.append((value * 100 if fraction else value, words[j].start, words[k].end, share))
        j = k + 1
    return out


def _close(a: float, b: float, tolerance: float = 0.12) -> bool:
    """Same figure as said aloud: rounding ("about thirty six thousand" for 36,417) is fine."""
    if b == 0:
        return a == 0
    return abs(a - b) / abs(b) <= tolerance


def land_times(scene: ScriptScene, words: list[Word], offset: float) -> list[float] | None:
    """When a figure shown on screen is said, so it lands on the word and not before it: a stat's
    number, a proportion's share, an aircraft's altitude readout, and each point of a trend line (its year or its value, whichever
    the narration says first). Seconds from the scene's start; None leaves the renderer's pacing."""
    aircraft = scene.type == "aircraft" or (scene.type == "world" and scene.subject == "aircraft")
    figure = scene.type in ("stat", "proportion") or scene.overlay in ("stat", "proportion")
    if not words or not (figure or scene.type == "trend" or aircraft):
        return None
    said = spoken_numbers(words)
    if figure or aircraft:
        target = scene.altitude_to if aircraft else scene.value
        if target is None:
            return None
        hit = next((s for s in said if _close(s[0], target)), None)
        return None if hit is None else [round(hit[2] + offset, 3)]
    points = scene.data or []
    years = [int(m.group()) if (m := re.search(r"-?\d{3,4}", d.label)) else None for d in points]

    def owner(value: float) -> int | None:
        # A figure said aloud belongs to the point whose value it is closest to ("421" is 2023's 421.1,
        # not 2020's 414.2, though both are within 3%).
        near = [(abs(value - d.value) / abs(d.value), j) for j, d in enumerate(points) if d.value and _close(value, d.value, 0.03)]
        return min(near)[1] if near else None

    times: list[float | None] = []
    after = 0.0
    for j, d in enumerate(points):
        year = years[j]
        hit = next(
            (s for s in said if s[1] >= after and ((year is not None and s[0] == year) or owner(s[0]) == j)),
            None,
        )
        times.append(None if hit is None else round(hit[2] + offset, 3))
        if hit is not None:
            after = hit[2]
    if not any(t is not None for t in times[1:]):
        return None
    end = words[-1].end + offset
    for k, t in enumerate(times):
        if t is None:
            prev = times[k - 1] if k else offset
            nxt = next((x for x in times[k + 1:] if x is not None), end)
            times[k] = round((prev + nxt) / 2, 3)
    return times


def _tokens(text: str) -> list[str]:
    return re.findall(r"[a-z0-9']+", text.lower())


def cue_time(cue: str | None, words: list[Word], offset: float) -> float | None:
    """When the narration says the cue phrase (its first word), seconds from the scene's start."""
    want = _tokens(cue or "")
    if not want or not words:
        return None
    said = [(_tokens(w.word) or [""])[0] for w in words]
    for j in range(len(said)):
        if said[j : j + len(want)] == want:
            return round(words[j].start + offset, 3)
    stem = want[0][:5]
    hit = next((j for j, w in enumerate(said) if w.startswith(stem)), None)
    return None if hit is None else round(words[hit].start + offset, 3)


def timed_direction(d: dict, words: list[Word], offset: float, length: float) -> dict:
    """The scene director's shots and acts on their cue words (0-1 through the scene). A shot whose words
    can't be found, or that would hold for under 1.6 seconds, is dropped; an act whose words can't be
    found starts with the scene."""
    shots, last = [], 0.0
    for n, sh in enumerate(d.get("shots") or []):
        if n == 0:
            shots.append(sh | {"from": 0.0})
            continue
        t = cue_time(sh.get("cue"), words, offset) if sh.get("cue") else (sh["at"] * length if "at" in sh else None)
        if t is None:
            continue
        u = round(t / length, 3)
        if 0.1 <= u <= 0.9 and (u - last) * length >= 1.6 and (1 - u) * length >= 1.6:
            shots.append(sh | {"from": u})
            last = u
    acts = {}
    for e, a in (d.get("acts") or {}).items():
        t = cue_time(a.get("cue"), words, offset) if a.get("cue") else None
        acts[e] = a | {"from": round(min(0.9, max(0.0, t / length)), 3) if t is not None else 0.0}
    return d | {"shots": shots, "acts": acts}


def timed_world(world: dict | None, words: list[Word], offset: float, length: float) -> dict | None:
    """A story world with each director's beat placed on its cue (0-1 through the scene, as the narrator
    says the words); a beat whose words can't be found, or that would last under a second, is dropped."""
    if world and world.get("direction") and length > 0:
        world = world | {"direction": timed_direction(world["direction"], words, offset, length)}
    if not world or not world.get("beats") or length <= 0:
        return world
    timed, last = [], 0.0
    for bt in world["beats"]:
        t = cue_time(bt.get("cue"), words, offset)
        if t is None:
            continue
        u = round(t / length, 3)
        if 0.08 <= u <= 0.92 and u - last >= 1.0 / length:
            timed.append(bt | {"from": u})
            last = u
    return world | {"beats": timed}


def key_moment(scene: ScriptScene, words: list[Word], offset: float, length: float) -> float | None:
    """When a scene's key moment (a collision, an engine fire, an eruption) happens, 0-1 through the scene.

    A world scene's moment lands on its cue words as the narrator says them, a beat after the word starts;
    without a cue it falls back to the scene's own effect_at, then the catalog's moment for the action."""
    if scene.type == "world" and scene.subject:
        t = cue_time(scene.cue, words, offset)
        if t is not None and length > 0:
            return round(min(0.9, max(0.05, (t + 0.15) / length)), 3)
        if scene.effect_at is None:
            return scenes3d.moment(scene.subject, scene.action or "")
    if scene.effect_at is not None and not 0 <= scene.effect_at <= 1:
        return round(min(0.95, max(0.05, scene.effect_at)), 3)  # the writer's guess past the scene's end
    return scene.effect_at


def to_srt(words: list[Word], max_words: int = 7) -> str:
    """Build an SRT caption file for YouTube from word timings."""

    def ts(t: float) -> str:
        ms = int(round(t * 1000))
        h, ms = divmod(ms, 3_600_000)
        m, ms = divmod(ms, 60_000)
        s, ms = divmod(ms, 1000)
        return f"{h:02}:{m:02}:{s:02},{ms:03}"

    lines, group = [], []
    for w in words:
        group.append(w)
        if len(group) >= max_words or w.word.endswith((".", "!", "?")):
            lines.append(group)
            group = []
    if group:
        lines.append(group)
    return "\n".join(
        f"{i}\n{ts(g[0].start)} --> {ts(g[-1].end)}\n{' '.join(w.word for w in g)}\n" for i, g in enumerate(lines, 1)
    )
