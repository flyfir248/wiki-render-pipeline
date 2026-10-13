"""Turn a script + voiced clips into renderer props (scene timings, captions)."""

from __future__ import annotations

import re

from fyt.config import Config
from fyt.models import Media, Music, RenderBeat, RenderProps, RenderScene, Script, ScriptScene, Sfx, Word

TAIL_SECONDS = 1.5  # hold the last scene after the voice ends


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
) -> RenderProps:
    if len(spans) != len(script.scenes):
        raise ValueError("one audio span per scene is required")
    # Long videos hold an end card after the voice, where YouTube's end screen (subscribe, next video) sits.
    end_card = cfg.growth.end_card_seconds if cfg.format == "long" else 0.0
    duration = (spans[-1][1] if spans else 0) + TAIL_SECONDS + end_card
    scenes: list[RenderScene] = []
    captions: list[Word] = []
    # The video's first map opens on a globe that dives in; later maps start from the flat map.
    first_map = next((i for i, s in enumerate(script.scenes) if s.type == "map"), None)
    for i, (scene, (start, _end)) in enumerate(zip(script.scenes, spans)):
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
                text=scene.text,
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
                actors=[a for a in scene.actors or [] if a.src] or None,
                effect=scene.effect,
                effectX=scene.effect_x,
                effectY=scene.effect_y,
                effectAt=scene.effect_at,
                effectSrc=scene.effect_src,
                revealTimes=reveal_times(revealed(scene), clip_words[i], start - vis_start),
                camera=scene.camera,
                transition=scene.transition,
            )
        )
        captions.extend(
            Word(word=w.word, start=round(w.start + start, 3), end=round(w.end + start, 3)) for w in clip_words[i]
        )
    return RenderProps(
        format=cfg.format,
        title=script.title,
        duration=round(duration, 3),
        theme=cfg.theme.model_dump(),
        voice=voice,
        music=Music(src=music, volume=cfg.music_volume) if music else None,
        sfx=Sfx(dir=sfx, volume=cfg.sfx_volume) if sfx else None,
        scenes=scenes,
        captions=captions,
        showCaptions=cfg.captions,
        showVisualizer=cfg.visualizer,
        badge=(script.series or None) if cfg.growth.series_badge else None,
        subscribe=cfg.growth.subscribe_line.strip() or None,
        endCard=round(end_card, 3),
    )


STOPWORDS = {"from", "with", "into", "they", "them", "their", "that", "this", "were", "what", "when", "where", "there", "been", "have"}


def _stems(text: str) -> set[str]:
    words = ("".join(c if c.isalnum() else " " for c in text.lower())).split()
    return {w[:5] for w in words if len(w) >= 4 and w not in STOPWORDS}


def revealed(scene: ScriptScene) -> list[str] | None:
    """What a scene shows one piece at a time as it is said: an evidence board's clues, or the
    [bracketed] words a document scene starts with blacked out."""
    if scene.type == "evidence":
        return scene.items
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
