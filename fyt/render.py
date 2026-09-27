"""Call the Remotion renderer (renderer/render.mjs) for the video and thumbnail."""

from __future__ import annotations

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
