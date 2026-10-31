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


def render(props_json: Path, public: Path, out: Path, still: bool = False) -> Path:
    ensure_renderer()
    cmd = ["node", "render.mjs", "--props", str(props_json), "--public", str(public), "--out", str(out)]
    if still:
        cmd.append("--still")
    subprocess.run(cmd, cwd=RENDERER_DIR, check=True, env=_env())
    return out


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
