"""The character kit: ready-made rigged people and animals and the animation clips they share, fetched
once from CC0 packs into the model library (assets/models/_kit) and reused by every story world.

Quaternius' Universal Base Characters and Universal Animation Library 1 and 2 share one humanoid
skeleton, so every clip plays on every body. `fetch` downloads the packs, keeps only their glTF files and
writes an inventory (meshes, joints, clips, size) so the renderer can be built against what is really
in them.
"""
from __future__ import annotations

import io
import json
import re
import struct
import zipfile
from pathlib import Path

import requests

UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"}

# (id, where from, licence). An opengameart.org entry is a direct file; an itch.io one is a free
# ("name your own price") page whose download link is asked for the way the page's button does.
PACKS = [
    ("ual1", "https://opengameart.org/sites/default/files/universal_animation_librarystandard.zip", "CC0"),
    ("ual2", "https://opengameart.org/sites/default/files/universal_animation_library_2standard.zip", "CC0"),
    ("bodies", "itch:quaternius/universal-base-characters", "CC0"),
    ("animals", "itch:quaternius/lowpoly-animated-animals", "CC0"),
]
KEEP = (".glb", ".gltf", ".bin", ".png", ".jpg", ".jpeg", ".txt", ".md")
# a pack's Godot glTF may come on another skeleton (UAL1's is Rigify's); its Unreal FBX is on the shared
# one (pelvis, spine_01, ... as in UAL2 and the base bodies), so that is converted to glTF instead
FBX2GLTF = "fbx2gltf@0.9.7-p1"


def _csrf(html: str):
    for pat in (r'<meta[^>]*name="csrf_token"[^>]*value="([^"]+)"', r'<meta[^>]*value="([^"]+)"[^>]*name="csrf_token"',
                r'name="csrf_token"[^>]*content="([^"]+)"', r'"csrf_token"\s*:\s*"([^"]+)"', r'name="csrf_token"\s+value="([^"]+)"'):
        m = re.search(pat, html)
        if m:
            return m
    return None


def _itch_files(user: str, slug: str, want: str = "standard") -> list[tuple[str, bytes]]:
    """A free itch.io pack's files, through the page's own download flow (no account needed)."""
    s = requests.Session()
    s.headers.update(UA)
    page = f"https://{user}.itch.io/{slug}"
    r0 = s.get(page, timeout=60)
    html = r0.text
    csrf = _csrf(html)
    if not csrf:
        raise RuntimeError(f"no csrf token on the page (HTTP {r0.status_code}): {re.sub(r'\\s+', ' ', html[:1500])}")
    r = s.post(f"{page}/download_url", data={"csrf_token": csrf.group(1)}, timeout=60).json()
    dl = r.get("url")
    if not dl:
        raise RuntimeError(f"no download page: {r}")
    key = dl.rstrip("/").split("/")[-1]
    html = s.get(dl, timeout=60).text
    csrf = _csrf(html) or csrf
    uploads = re.findall(r'data-upload_id="(\d+)".{0,600}?class="upload_name".{0,200}?title="([^"]+)"', html, re.S)
    if not uploads:
        uploads = [(u, u) for u in dict.fromkeys(re.findall(r'data-upload_id="(\d+)"', html))]
    picked = [u for u in uploads if want in u[1].lower()] or uploads[:1]
    out = []
    for uid, name in picked:
        j = s.post(f"{page}/file/{uid}", params={"source": "game_download", "key": key}, data={"csrf_token": csrf.group(1)}, timeout=60).json()
        out.append((name, s.get(j["url"], timeout=900).content))
    return out


def _to_glb(fbx: Path) -> None:
    """An FBX converted to a binary glTF beside it (FBX2glTF's Linux build, from npm)."""
    import subprocess
    import tempfile

    tool = Path(tempfile.gettempdir()) / "fbx2gltf"
    exe = tool / "node_modules" / "fbx2gltf" / "bin" / "Linux" / "FBX2glTF"
    if not exe.exists():
        subprocess.run(["npm", "install", "--silent", "--prefix", str(tool), FBX2GLTF], check=True, timeout=600)
    exe.chmod(0o755)
    subprocess.run([str(exe), "--binary", "--input", str(fbx), "--output", str(fbx.with_suffix(""))], check=True, timeout=900)


def _glb_json(data: bytes) -> dict:
    if data[:4] != b"glTF":
        return json.loads(data)
    n = struct.unpack_from("<I", data, 12)[0]
    return json.loads(data[20:20 + n])


def inventory(g: dict) -> dict:
    """What a glTF holds: its meshes, the joints of its skins, its clips and their lengths."""
    nodes = g.get("nodes", [])
    acc = g.get("accessors", [])
    clips = []
    for a in g.get("animations", []):
        t = max((acc[s["input"]].get("max", [0])[0] for s in a.get("samplers", []) if s.get("input") is not None and s["input"] < len(acc)), default=0)
        clips.append({"name": a.get("name", ""), "seconds": round(t, 2)})
    skins = [[nodes[j].get("name", "") for j in sk.get("joints", [])] for sk in g.get("skins", [])]
    return {"meshes": [m.get("name", "") for m in g.get("meshes", [])], "skins": [{"joints": len(j), "names": j} for j in skins[:1]] + [{"joints": len(j)} for j in skins[1:]],
            "clips": clips, "materials": [m.get("name", "") for m in g.get("materials", [])], "images": len(g.get("images", []))}


def fetch(root: Path) -> dict:
    root.mkdir(parents=True, exist_ok=True)
    report = {}
    for pid, src, licence in PACKS:
        dest = root / pid
        try:
            if src.startswith("itch:"):
                user, slug = src[5:].split("/")
                files = _itch_files(user, slug)
            else:
                r = requests.get(src, headers=UA, timeout=900)
                r.raise_for_status()
                files = [(src.rsplit("/", 1)[-1], r.content)]
            kept = []
            for name, blob in files:
                if not zipfile.is_zipfile(io.BytesIO(blob)):
                    continue
                with zipfile.ZipFile(io.BytesIO(blob)) as z:
                    names = z.namelist()
                    gl = [n for n in names if n.lower().endswith((".glb", ".gltf"))]
                    # glTF only (the packs also carry FBX and engine projects); their buffers and textures with them
                    dirs = {str(Path(n).parent) for n in gl}
                    for n in names:
                        if n.lower().endswith(".fbx") and "unreal" in n.lower() and not any("unreal" in g.lower() for g in gl):
                            out = dest / n
                            out.parent.mkdir(parents=True, exist_ok=True)
                            out.write_bytes(z.read(n))
                            kept.append(n)
                            continue
                        if n.endswith("/") or not n.lower().endswith(KEEP) or (not n.lower().endswith((".glb", ".gltf")) and str(Path(n).parent) not in dirs and not n.lower().endswith((".txt", ".md"))):
                            continue
                        out = dest / n
                        out.parent.mkdir(parents=True, exist_ok=True)
                        out.write_bytes(z.read(n))
                        kept.append(n)
                    report.setdefault(pid, {})["all_files"] = len(names)
                    report[pid]["sample_names"] = names[:40]
            for f in sorted(dest.rglob("*.fbx")):
                _to_glb(f)
                f.unlink()
            items = {}
            for f in sorted(dest.rglob("*")):
                if f.suffix.lower() in (".glb", ".gltf"):
                    try:
                        items[str(f.relative_to(dest))] = {"bytes": f.stat().st_size} | inventory(_glb_json(f.read_bytes()))
                    except Exception as e:  # noqa: BLE001 - an unreadable file is reported, not fatal
                        items[str(f.relative_to(dest))] = {"error": str(e)[:200]}
            report.setdefault(pid, {}).update({"source": src, "licence": licence, "kept": len(kept), "models": items})
        except Exception as e:  # noqa: BLE001 - one pack failing leaves the others
            report[pid] = {"source": src, "licence": licence, "error": f"{type(e).__name__}: {str(e)[:300]}"}
    (root / "inventory.json").write_text(json.dumps(report, indent=1))
    return {k: (v.get("error") or f"{len(v.get('models', {}))} models, {v.get('kept', 0)} files kept") for k, v in report.items()}
