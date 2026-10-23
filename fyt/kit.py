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
]
# Quaternius' Universal Base Characters and Farm Animals are free on itch.io but only through a browser,
# so they were downloaded by hand and imported once with `add` (python -m fyt kit --add ZIP): the people,
# packed small, live in the repository's own kit (BUNDLED); the animals are library models in the
# renderer's project library (renderer/public/models and renderer/src/scenes/world/assets.json).
BUNDLED = Path(__file__).resolve().parent.parent / "assets" / "kit"
BODIES_PAGE = "https://quaternius.itch.io/universal-base-characters"
ANIMALS_PAGE = "https://quaternius.itch.io/lowpoly-animated-animals"
# the farm animals each named by the words a story uses for them (whole words only: no "horsepower")
ANIMALS = {
    "Horse": ["=horse", "=horses", "=pony", "=ponies", "=stallion", "=mare", "=foal", "=steed"],
    "Cow": ["=cow", "=cows", "=cattle", "=bull", "=bulls", "=ox", "=oxen", "=calf", "=heifer"],
    "Zebra": ["=zebra", "=zebras"],
    "Sheep": ["=sheep", "=lamb", "=lambs", "=ram", "=ewe", "=ewes"],
    "Pig": ["=pig", "=pigs", "=hog", "=hogs", "=boar", "=piglet", "=swine", "=sow"],
    "Llama": ["=llama", "=llamas", "=alpaca", "=alpacas"],
    "Pug": ["=pug", "=dog", "=dogs", "=puppy", "=pup", "=hound"],
}
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
        head = re.sub(r"\s+", " ", html[:1500])
        raise RuntimeError(f"no csrf token on the page (HTTP {r0.status_code}): {head}")
    r = s.post(f"{page}/download_url", data={"csrf_token": csrf.group(1)}, timeout=60).json()
    dl = r.get("url")
    if not dl:
        raise RuntimeError(f"no download page: {r}")
    # the download page's last path part is its key, url-quoted (requests would quote it again)
    from urllib.parse import unquote, urlparse

    key = unquote(urlparse(dl).path.rstrip("/").split("/")[-1])
    html = s.get(dl, timeout=60).text
    csrf = _csrf(html) or csrf
    uploads = re.findall(r'data-upload_id="(\d+)".{0,600}?class="upload_name".{0,200}?title="([^"]+)"', html, re.S)
    if not uploads:
        uploads = [(u, u) for u in dict.fromkeys(re.findall(r'data-upload_id="(\d+)"', html))]
    picked = [u for u in uploads if want in u[1].lower()] or uploads[:1]
    out = []
    for uid, name in picked:
        r = s.post(f"{page}/file/{uid}", params={"source": "game_download", "key": key}, data={"csrf_token": csrf.group(1)}, timeout=60)
        try:
            j = r.json()
        except ValueError:
            j = {}
        if not j.get("url"):
            raise RuntimeError(f"no file link for {name!r} (HTTP {r.status_code}): {r.text[:400]}; uploads seen: {uploads}; download page {dl}")
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
    subprocess.run([str(exe), "--binary", "--input", str(fbx), "--output", str(fbx.with_suffix(""))], check=True, timeout=900, capture_output=True)


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


def pack(src: Path, dst: Path, texture: int = 1024) -> None:
    """A glTF (with its .bin and image files beside it) packed into one small .glb: only the base-colour
    texture is kept, as a JPEG at most `texture` pixels across (normal and roughness maps cost megabytes
    for detail a person a few hundred pixels tall never shows), and only the first UV set; exporters'
    extra vertex colours and UV sets are dropped, as are the buffers nothing uses any more."""
    from PIL import Image

    g = json.loads(src.read_text())
    blobs = [(src.parent / b["uri"]).read_bytes() for b in g.get("buffers", [])]
    for m in g.get("meshes", []):
        for p in m.get("primitives", []):
            p["attributes"] = {k: v for k, v in p["attributes"].items() if not re.match(r"COLOR_|TEXCOORD_[1-9]", k)}
    for mat in g.get("materials", []):
        for k in ("normalTexture", "occlusionTexture", "emissiveTexture"):
            mat.pop(k, None)
        pbr = mat.setdefault("pbrMetallicRoughness", {})
        if pbr.pop("metallicRoughnessTexture", None) is not None:
            pbr.setdefault("roughnessFactor", 0.75)
        if "baseColorTexture" in pbr:
            pbr["baseColorTexture"].pop("texCoord", None)
    # the accessors and images still in use, renumbered, and one new buffer holding just them
    used_acc = sorted({v for m in g.get("meshes", []) for p in m["primitives"] for v in [*p["attributes"].values(), p.get("indices")] if v is not None}
                      | {s["inverseBindMatrices"] for s in g.get("skins", []) if "inverseBindMatrices" in s}
                      | {x for a in g.get("animations", []) for s in a["samplers"] for x in (s["input"], s["output"])})
    used_tex = sorted({m["pbrMetallicRoughness"]["baseColorTexture"]["index"] for m in g.get("materials", []) if "baseColorTexture" in m.get("pbrMetallicRoughness", {})})
    out = bytearray()
    views = []

    def put(data: bytes, **extra) -> int:
        while len(out) % 4:
            out.append(0)
        views.append({"buffer": 0, "byteOffset": len(out), "byteLength": len(data)} | extra)
        out.extend(data)
        return len(views) - 1

    acc_map = {}
    accessors = []
    for i in used_acc:
        a = dict(g["accessors"][i])
        bv = g["bufferViews"][a["bufferView"]]
        data = blobs[bv.get("buffer", 0)][bv.get("byteOffset", 0):bv.get("byteOffset", 0) + bv["byteLength"]]
        extra = {k: bv[k] for k in ("byteStride", "target") if k in bv}
        a["bufferView"] = put(data, **extra)
        acc_map[i] = len(accessors)
        accessors.append(a)
    tex_map = {}
    images = []
    for t in used_tex:
        img = g["images"][g["textures"][t]["source"]]
        f = src.parent / img["uri"]
        if not f.exists():  # a few files are named differently from the glTF's reference ("x_png.png" for "x.png")
            alts = [src.parent / img["uri"].replace("_png.png", ".png"), src.parent / img["uri"].replace(".png", "_png.png")]
            f = next((a for a in alts if a.exists()), f)
        if not f.exists():
            continue
        im = Image.open(f).convert("RGB")
        im.thumbnail((texture, texture))
        buf = io.BytesIO()
        im.save(buf, "JPEG", quality=88)
        tex_map[t] = len(images)
        images.append({"bufferView": put(buf.getvalue()), "mimeType": "image/jpeg"})
    for m in g.get("meshes", []):
        for p in m["primitives"]:
            p["attributes"] = {k: acc_map[v] for k, v in p["attributes"].items()}
            if "indices" in p:
                p["indices"] = acc_map[p["indices"]]
    for s in g.get("skins", []):
        if "inverseBindMatrices" in s:
            s["inverseBindMatrices"] = acc_map[s["inverseBindMatrices"]]
    for a in g.get("animations", []):
        for s in a["samplers"]:
            s["input"], s["output"] = acc_map[s["input"]], acc_map[s["output"]]
    for mat in g.get("materials", []):
        pbr = mat["pbrMetallicRoughness"]
        if "baseColorTexture" in pbr:
            if pbr["baseColorTexture"]["index"] in tex_map:
                pbr["baseColorTexture"]["index"] = tex_map[pbr["baseColorTexture"]["index"]]
            else:
                pbr.pop("baseColorTexture")
    g["accessors"], g["bufferViews"], g["images"] = accessors, views, images
    g["textures"] = [{"sampler": 0, "source": i} for i in range(len(images))]
    g["samplers"] = [{"magFilter": 9729, "minFilter": 9987}]
    while len(out) % 4:
        out.append(0)
    g["buffers"] = [{"byteLength": len(out)}]
    if not images:
        for k in ("images", "textures", "samplers"):
            g.pop(k)
    js = json.dumps(g, separators=(",", ":")).encode()
    js += b" " * (-len(js) % 4)
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_bytes(struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(out)) + struct.pack("<II", len(js), 0x4E4F534A) + js
                    + struct.pack("<II", len(out), 0x004E4942) + bytes(out))


def add(archive: Path) -> dict:
    """Import a hand-downloaded pack: the base characters (bodies and rigged hair) into the bundled kit,
    or the farm animals into the project library. Returns what was added."""
    import shutil
    import subprocess
    import tempfile

    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        with zipfile.ZipFile(archive) as z:
            z.extractall(work / "x")
        files = sorted((work / "x").rglob("*"))
        bodies = [f for f in files if f.suffix == ".gltf" and "Godot - UE" in str(f) and "FullBody" in f.name]
        hairs = [f for f in files if f.suffix == ".gltf" and "Rigged to Head Bone" in str(f) and f.name.startswith("Hair_")]
        if bodies:
            BUNDLED.mkdir(parents=True, exist_ok=True)
            models = {}
            for f in bodies + hairs:
                # a body's skin texture is what shows; a strand of hair a few pixels wide needs less
                out = BUNDLED / "bodies" / f"{f.stem}.glb"
                pack(f, out, 1024 if f in bodies else 512)
                models[out.name] = {"bytes": out.stat().st_size} | inventory(_glb_json(out.read_bytes()))
            inv = {"bodies": {"source": BODIES_PAGE, "licence": "CC0", "author": "Quaternius", "models": models}}
            (BUNDLED / "inventory.json").write_text(json.dumps(inv, indent=1))
            return {k: f"{len(v['models'])} models" for k, v in inv.items()}
        fbx = {f.stem: f for f in files if f.suffix.lower() == ".fbx" and f.stem in ANIMALS}
        if not fbx:
            raise ValueError(f"{archive.name}: neither the base characters nor the farm animals")
        from fyt import assets
        from fyt.assetlib import RENDERER_DIR

        reg_path = assets.WORLD / "assets.json"
        reg = json.loads(reg_path.read_text())
        added = {}
        for name, f in fbx.items():
            glb = f.with_suffix(".glb")
            _to_glb(f)
            key = f"kit-{name.lower()}"
            out = assets.MODELS_DIR / f"{key}.glb"
            out.parent.mkdir(parents=True, exist_ok=True)
            r = subprocess.run(["node", "prepare-model.mjs", str(glb), str(out), "--triangles", "40000", "--texture", "1024"],
                               cwd=RENDERER_DIR, capture_output=True, text=True, timeout=300, check=True)
            info = json.loads(r.stdout.strip().splitlines()[-1])
            reg["assets"][key] = {"kind": "library", "subject": "animal", "variant": name.lower(), "names": ANIMALS[name],
                                  "title": f"{name} (Quaternius Farm Animals)", "src": out.name, "source": ANIMALS_PAGE,
                                  "licence": "CC0", "author": "Quaternius", "clips": info["clips"]}
            added[key] = info["clips"]
        reg_path.write_text(json.dumps(reg, indent=2) + "\n")
        shutil.rmtree(work / "x", ignore_errors=True)
        return added


def _joints(m: dict) -> list[str]:
    sk = m.get("skins") or [{}]
    return sk[0].get("names", [])


# the base characters' rigged hair, by the style the renderer asks for (kit.tsx HAIR_STYLE)
HAIR = {"Hair_Long": "long", "Hair_Buns": "buns", "Hair_Buzzed": "buzzed", "Hair_BuzzedFemale": "buzzedf",
        "Hair_SimpleParted": "parted", "Hair_Beard": "beard"}


def stage(public: Path, root: Path | None = None) -> dict | None:
    """Copy the kit into a video's public folder; returns the world's `kit` (bodies, clip libraries) for
    the renderer, or None when the library has no kit. Everything is on the shared skeleton (pelvis,
    spine_01, ...); a body pack's own people beat the clip libraries' plain mannequins."""
    import shutil

    from fyt.assetlib import CACHE

    root = root or CACHE / "_kit"
    places = {}
    for where in (root, BUNDLED):
        try:
            for pid, v in json.loads((where / "inventory.json").read_text()).items():
                if not places.get(pid, (None, {}))[1].get("models"):  # (an earlier failed fetch has none)
                    places[pid] = (where, v)
        except (OSError, ValueError):
            continue
    inv = {pid: v for pid, (_, v) in places.items()}
    shared = lambda m: "pelvis" in _joints(m)  # noqa: E731
    bodies: dict[str, tuple[int, str]] = {}
    clips: list[str] = []
    hair: dict[str, str] = {}
    copy: dict[str, Path] = {}
    for rank, pid in enumerate(("bodies", "ual2", "ual1")):
        for rel, m in (inv.get(pid, {}).get("models") or {}).items():
            src = places[pid][0] / pid / rel
            if "error" in m or not shared(m) or not src.exists():
                continue
            name = f"kit/{pid}-{Path(rel).stem}.glb".replace(" ", "_")
            style = HAIR.get(Path(rel).stem)
            if style:
                hair[style] = name
                copy[name] = src
                continue
            if m.get("clips"):
                clips.append(name)
                copy[name] = src
            if m.get("meshes"):
                sex = "f" if re.search(r"female|woman|(^|[^a-z])f($|[^a-z])", Path(rel).stem.lower()) else "m"
                if sex not in bodies or rank < bodies[sex][0]:
                    bodies[sex] = (rank, name)
                    copy[name] = src
    if not bodies or not clips:
        return None
    used = {n for _, n in bodies.values()} | set(clips) | set(hair.values())
    for name, src in copy.items():
        if name in used:
            (public / name).parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, public / name)
    return {"bodies": {k: n for k, (_, n) in bodies.items()}, "clips": clips} | ({"hair": hair} if hair else {})
