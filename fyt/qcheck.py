"""The quality gate: a video is finished when it passes these checks, not when the renderer exits.

Before rendering, the production storyboard and props are checked for what can be known without a
picture: every asset present, timing sane, on-screen text readable, a recurring subject drawn the same
way, every reconstruction backed by its narration and every library model by a licence. After
rendering, the video itself: its frames (no black or frozen scene; a 3D scene that does not move has
failed to draw), its size, frame rate and sound. A broken 3D scene is reported for repair (the
pipeline swaps it for the scene it replaced and renders once more); anything else material is a
problem, which holds the video from upload. Warnings are logged and kept in qc.json.

These checks catch technical faults and some composition faults. They cannot judge whether a scene
looks good, so the contact sheet kept with every job stays part of the review.
"""

from __future__ import annotations

import re
import subprocess
from dataclasses import dataclass, field
from pathlib import Path

import imageio_ffmpeg
import numpy as np

from fyt import scenes3d
from fyt.config import Config
from fyt.models import RenderProps, Script, ScriptScene

TEXT_ONLY = ("statement", "title")
MIN_SCENE = 1.2  # seconds: shorter and the picture is a flicker
READ_RATE = 3.5  # on-screen words a second a viewer can read alongside the narration
SIZE = {"short": (1080, 1920), "long": (1920, 1080)}


@dataclass
class Report:
    problems: list[str] = field(default_factory=list)  # material: the video is held
    warnings: list[str] = field(default_factory=list)
    repair: list[int] = field(default_factory=list)  # scene indexes (from 0) whose 3D failed to draw
    checks: dict[str, str] = field(default_factory=dict)

    def mark(self, name: str, problems: list[str], warnings: list[str] = ()) -> None:
        self.problems += problems
        self.warnings += list(warnings)
        self.checks[name] = "fail" if problems else "warn" if warnings else "pass"

    def as_dict(self) -> dict:
        return {"checks": self.checks, "problems": self.problems, "warnings": self.warnings, "repair": self.repair}


def _files(props: RenderProps) -> list[str]:
    out = []
    for s in props.scenes:
        for m in [s.media] + list(s.shots or []):
            if m is not None:
                out += [x for x in (m.src, m.styled, m.cutout) if x]
        out += [b.src for b in s.beats or []] + [x for x in (s.backdropSrc, s.effectSrc) if x]
        if s.model and s.model.get("src"):
            out.append(s.model["src"])
    if props.voice:
        out.append(props.voice)
    if props.music:
        out.append(props.music.src)
    return out


def before_render(cfg: Config, script: Script, props: RenderProps, public: Path) -> Report:
    r = Report()
    # Story coverage: no long run of scenes that are only words on screen.
    run, longest, warns = 0, 0, []
    for i, (s, p) in enumerate(zip(script.scenes, props.scenes), 1):
        bare = s.type in TEXT_ONLY and p.media is None and not p.beats and not p.shots
        run = run + 1 if bare else 0
        if run == 3:
            warns.append(f"scenes {i - 2}-{i} are words on screen with no picture")
        longest = max(longest, run)
    r.mark("coverage", [], warns)

    missing = sorted({f for f in _files(props) if not (public / f).exists()})
    r.mark("assets", [f"missing asset: {f}" for f in missing])

    problems, warns = [], []
    for i, p in enumerate(props.scenes, 1):
        if p.end - p.start < MIN_SCENE:
            warns.append(f"scene {i} is on screen for {p.end - p.start:.1f}s")
        if p.effectAt is not None and not 0 <= p.effectAt <= 1:
            problems.append(f"scene {i}'s key moment falls outside it ({p.effectAt})")
    if props.captions and props.captions[-1].end > props.duration + 0.05:
        problems.append("captions run past the end of the video")
    r.mark("timing", problems, warns)

    warns = []
    for i, (s, p) in enumerate(zip(script.scenes, props.scenes), 1):
        shown = " ".join(x for x in [p.heading or "", p.text or ""] + list(p.items or []) if x)
        words = len(shown.split())
        if words and words / max(0.5, p.end - p.start) > READ_RATE and s.type not in ("quote", "document", "dialogue"):
            warns.append(f"scene {i} shows {words} words in {p.end - p.start:.1f}s")
        if p.heading and len(p.heading) > 60:
            warns.append(f"scene {i}'s heading is {len(p.heading)} characters")
    r.mark("readability", [], warns)

    problems = []
    groups: dict[str, set] = {}
    for s in script.scenes:
        if s.type == "world" and s.subject_name:
            groups.setdefault(s.subject_name, set()).add(((s.model or {}).get("id"), s.variant))
    for name, looks in groups.items():
        if len(looks) > 1:
            problems.append(f"{name} is drawn {len(looks)} different ways: {sorted(map(str, looks))}")
    r.mark("continuity", problems)

    problems, warns = [], []
    context = " ".join(s.narration for s in script.scenes)
    for i, s in enumerate(script.scenes, 1):
        if s.type != "world":
            continue
        g = scenes3d.guard(s, context)
        if g.action != s.action:
            problems.append(f"scene {i} shows {s.subject} {s.action}, which its narration doesn't describe")
        m = s.model or {}
        if s.label == "RECONSTRUCTION" and m.get("level") == "generic":
            problems.append(f"scene {i} calls a generic model a reconstruction of the real thing")
        if not s.illustrative and s.label == "ILLUSTRATION" and m.get("kind") != "concept":
            warns.append(f"scene {i} is documented but labelled an illustration")
        if m.get("level") == "library" and not (m.get("licence") and m.get("sources")):
            problems.append(f"scene {i}'s model {m.get('id')} has no recorded licence or source")
    if not script.sources:
        warns.append("the script lists no sources")
    r.mark("provenance", problems, warns)
    return r


def probe(video: Path) -> dict:
    """Size, frame rate and audio of a video, read from ffmpeg's banner."""
    err = subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), "-i", str(video)], capture_output=True, text=True, check=False).stderr
    v = re.search(r"Video:.*?(\d{2,5})x(\d{2,5}).*?([\d.]+) fps", err)
    return {"width": int(v[1]) if v else None, "height": int(v[2]) if v else None,
            "fps": float(v[3]) if v else None, "audio": "Audio:" in err}


def loudness(video: Path) -> tuple[float | None, float | None]:
    """Mean and peak volume of the soundtrack in dB."""
    err = subprocess.run(
        [imageio_ffmpeg.get_ffmpeg_exe(), "-i", str(video), "-vn", "-af", "volumedetect", "-f", "null", "-"],
        capture_output=True, text=True, check=False,
    ).stderr
    mean = re.search(r"mean_volume: (-?[\d.]+) dB", err)
    peak = re.search(r"max_volume: (-?[\d.]+) dB", err)
    return (float(mean[1]) if mean else None, float(peak[1]) if peak else None)


def frames_at(video: Path, times: list[float], w: int = 96, h: int = 54) -> np.ndarray:
    """Small grey frames at the given times."""
    out = []
    for t in times:
        raw = subprocess.run(
            [imageio_ffmpeg.get_ffmpeg_exe(), "-loglevel", "error", "-ss", f"{t:.3f}", "-i", str(video), "-frames:v", "1",
             "-vf", f"scale={w}:{h},format=gray", "-f", "rawvideo", "-"],
            capture_output=True, check=False,
        ).stdout
        out.append(np.frombuffer(raw[: w * h], dtype=np.uint8).reshape(h, w).astype(np.float32) if len(raw) >= w * h else np.zeros((h, w), np.float32))
    return np.stack(out)


def after_render(cfg: Config, script: Script, props: RenderProps, video: Path, voiced: bool = True) -> Report:
    r = Report()
    info = probe(video)
    problems = []
    want = SIZE[cfg.format]
    if (info["width"], info["height"]) != want:
        problems.append(f"video is {info['width']}x{info['height']}, not {want[0]}x{want[1]}")
    if info["fps"] is None or abs(info["fps"] - props.fps) > 0.5:
        problems.append(f"video runs at {info['fps']} fps, not {props.fps}")
    warns = []
    if voiced or props.music:
        if not info["audio"]:
            problems.append("video has no soundtrack")
        else:
            mean, peak = loudness(video)
            if mean is not None and mean < -40:
                problems.append(f"soundtrack is nearly silent ({mean:.0f} dB mean)")
            if peak is not None and peak >= 0:
                warns.append(f"soundtrack clips (peak {peak:.1f} dB)")
    r.mark("technical", problems, warns)

    problems, warns = [], []
    for i, (s, p) in enumerate(zip(script.scenes, props.scenes)):
        length = p.end - p.start
        if length < 1:
            continue
        f = frames_at(video, [p.start + length * k for k in (0.3, 0.55, 0.8)])
        black = all(x.mean() < 20 and x.std() < 4 for x in f)  # black decodes near 16 in limited range
        # A 3D scene's camera always drifts, so its picture changes; judged on a band clear of the
        # captions and labels, which change on their own.
        h, w = f.shape[1:]
        band = f[:, int(h * 0.18) : int(h * (0.42 if cfg.format == "short" else 0.7)), int(w * 0.1) : int(w * 0.9)]
        frozen = s.type == "world" and float(np.abs(np.diff(band, axis=0)).mean()) < 0.25
        if black or frozen:
            what = "is black" if black else "does not move"
            if s.type == "world" and s.fallback:
                r.repair.append(i)
                warns.append(f"scene {i + 1}'s 3D {what}: swapping in its 2D scene")
            else:
                problems.append(f"scene {i + 1} {what}")
    r.mark("frames", problems, warns)
    return r


def repaired(script: Script, scenes: list[int]) -> Script:
    """The script with the given 3D scenes put back to the scenes they replaced."""
    out = list(script.scenes)
    for i in scenes:
        if out[i].fallback:
            out[i] = ScriptScene.model_validate(out[i].fallback)
    return script.model_copy(update={"scenes": out})
