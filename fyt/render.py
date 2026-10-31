"""Call the Remotion renderer (renderer/render.mjs) for the video and thumbnail."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path

from fyt.config import RENDERER_DIR

# Chromium bundled with Playwright, when present; Remotion downloads its own otherwise.
_KNOWN_BROWSERS = [Path("/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell")]


def _env() -> dict:
    env = dict(os.environ)
    if "REMOTION_BROWSER_EXECUTABLE" not in env:
        for p in _KNOWN_BROWSERS:
            if p.exists():
                env["REMOTION_BROWSER_EXECUTABLE"] = str(p)
    return env


def ensure_renderer() -> None:
    if not (RENDERER_DIR / "node_modules").exists():
        npm = shutil.which("npm")
        if not npm:
            raise RuntimeError("Node.js/npm is required for rendering (https://nodejs.org)")
        subprocess.run([npm, "install"], cwd=RENDERER_DIR, check=True)


def render(props_json: Path, public: Path, out: Path, still: bool = False, lufs: float | None = None) -> Path:
    ensure_renderer()
    cmd = ["node", "render.mjs", "--props", str(props_json), "--public", str(public), "--out", str(out)]
    if still:
        cmd.append("--still")
    subprocess.run(cmd, cwd=RENDERER_DIR, check=True, env=_env())
    if lufs is not None and not still:
        master(out, lufs)
    return out


def _ffmpeg() -> str:
    try:
        import imageio_ffmpeg

        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return shutil.which("ffmpeg") or "ffmpeg"


def loudnorm_stats(stderr: str) -> dict | None:
    """The measurements ffmpeg's loudnorm filter prints (its last JSON block), or None."""
    end = stderr.rfind("}")
    start = stderr.rfind("{", 0, end)
    if start < 0 or end < 0:
        return None
    try:
        stats = json.loads(stderr[start : end + 1])
    except ValueError:
        return None
    return stats if "input_i" in stats else None


def master(video: Path, lufs: float = -14.0, peak: float = -1.0) -> bool:
    """Bring the video's sound to `lufs` integrated loudness with a true-peak ceiling of `peak` dBTP, in two
    passes (measure, then correct linearly where it can), keeping the picture as it is. The voice, music
    and effects are already balanced against each other in the render; this only sets the overall level.
    False when there is no sound to master or ffmpeg fails (the video is left as rendered)."""
    ff = _ffmpeg()
    target = f"I={lufs}:TP={peak}:LRA=11"
    probe = subprocess.run([ff, "-hide_banner", "-nostats", "-i", str(video), "-af", f"loudnorm={target}:print_format=json", "-vn", "-f", "null", "-"],
                           capture_output=True, text=True)
    stats = loudnorm_stats(probe.stderr)
    if not stats or stats["input_i"] in ("-inf", "inf"):
        return False
    tmp = video.with_name(video.stem + ".master" + video.suffix)
    measured = (f"{target}:measured_I={stats['input_i']}:measured_TP={stats['input_tp']}:measured_LRA={stats['input_lra']}"
                f":measured_thresh={stats['input_thresh']}:offset={stats['target_offset']}:linear=true")
    done = subprocess.run([ff, "-hide_banner", "-loglevel", "error", "-y", "-i", str(video), "-af", f"loudnorm={measured},aresample=48000",
                           "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", str(tmp)], capture_output=True, text=True)
    if done.returncode != 0 or not tmp.exists():
        tmp.unlink(missing_ok=True)
        return False
    tmp.replace(video)
    return True


def frames(props_json: Path, public: Path, out_dir: Path, at: list[int]) -> list[Path]:
    """Render single frames of a video (one bundle) as frame-00042.png files; returns their paths."""
    ensure_renderer()
    out_dir.mkdir(parents=True, exist_ok=True)
    cmd = ["node", "render.mjs", "--frames", ",".join(str(f) for f in at), "--props", str(props_json), "--public", str(public), "--out", str(out_dir)]
    subprocess.run(cmd, cwd=RENDERER_DIR, check=True, env=_env())
    return [out_dir / f"frame-{f:05d}.png" for f in at]


def motion_check(props_json: Path, timeout: float = 300) -> list[dict]:
    """The story-world scenes played through frame by frame without drawing them (renderer/motion-check.mjs):
    what would look jerky, as {scene, frame, what, detail}. Empty when it can't run: a check, never a gate."""
    try:
        ensure_renderer()
        done = subprocess.run(["node", "motion-check.mjs", "--props", str(Path(props_json).resolve())], cwd=RENDERER_DIR,
                              capture_output=True, text=True, timeout=timeout, env=_env())
    except Exception:
        return []
    found = []
    for line in done.stdout.splitlines():
        try:
            row = json.loads(line)
        except ValueError:
            continue
        if isinstance(row, dict) and "what" in row:
            found.append(row)
    return found
