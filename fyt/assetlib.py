"""Models for the story's own entities: found, checked, prepared and kept for every later video.

fyt.manifest lists what a story shows (a black bear, a Cessna 404, a ferry). Each entity the visual
plan wants in 3D is resolved here, best first:

1. project: a vetted model in the project library (renderer/src/scenes/world/assets.json) that names it;
2. cache: a model found for the same search term before (assets/models/<term>/), with its licence;
3. external sources, in `visuals.asset_sources` order, searched by the entity's own words:
   - sketchfab: Sketchfab's search (no key needed to search), only models whose licence is in
     `visuals.licences`; downloaded from the Objaverse mirror on Hugging Face (no key), or from
     Sketchfab itself with SKETCHFAB_TOKEN;
   - polypizza: Poly Pizza's CC0 / CC-BY library, with POLY_PIZZA_KEY;
   - image_to_3d: a picture of the entity drawn in the house style and made 3D by an image-to-3D model
     on Hugging Face (`visuals.image_to_3d_space`), when one is configured;
4. nothing: the entity has no 3D model and its scenes keep their painted pictures. A model of
   something else is never used in its place.

Every candidate must name the entity's own noun in its title or tags, pass a vision check of its
preview against the entity's look, load, and hold real detail (not a few primitives). It is then
prepared (renderer/prepare-model.mjs: old materials converted, meshes simplified to the shot's
triangle budget, textures shrunk) and stored with its source, author and licence, so the video's
description can credit it and the next video that needs one reuses it without searching.
"""

from __future__ import annotations

import gzip
import json
import re
import shutil
import subprocess
import tempfile
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Callable

import requests

from fyt import assets, manifest, scenes3d
from fyt.config import RENDERER_DIR, ROOT, Config, secret
from fyt.manifest import Entity

CACHE = ROOT / "assets" / "models"
SKETCHFAB = "https://api.sketchfab.com/v3"
OBJAVERSE = "https://huggingface.co/datasets/allenai/objaverse/resolve/main"
POLY_PIZZA = "https://api.poly.pizza/v1.1"
MISS_DAYS = 14  # a search that found nothing is not repeated for this long
MIN_TRIANGLES = 300  # fewer is a handful of boxes, not a recognisable model
CANDIDATES = 6  # per search term, checked in the order the source ranks them
LICENCES = {  # Sketchfab's licence slugs and labels, and Poly Pizza's, to one code
    "cc0": "cc0", "cc0 1.0": "cc0", "public domain": "cc0", "cc zero": "cc0",
    "by": "by", "cc attribution": "by", "cc-by": "by", "cc-by 3.0": "by", "cc-by 4.0": "by", "cc by 3.0": "by", "cc by 4.0": "by",
    "by-sa": "by-sa", "cc attribution-sharealike": "by-sa",
    "by-nd": "by-nd", "cc attribution-noderivs": "by-nd",
    "by-nc": "by-nc", "cc attribution-noncommercial": "by-nc",
    "by-nc-sa": "by-nc-sa", "cc attribution-noncommercial-sharealike": "by-nc-sa",
    "by-nc-nd": "by-nc-nd", "cc attribution-noncommercial-noderivs": "by-nc-nd",
}
LICENCE_NAMES = {"cc0": "CC0", "by": "CC BY 4.0", "by-sa": "CC BY-SA 4.0"}
# A model whose title says it is several things or a whole place, not the one thing asked for.
NOT_ONE_THING = re.compile(r"\b(pack|collection|bundle|kit|set of|diorama|scene|environment|room|level|map|asset ?pack)\b", re.I)
# A model of a part or remains of the thing (a bear's jawbone scan), unless that part is what was asked for.
A_PART = ("skull", "skeleton", "bone", "bones", "mandible", "jaw", "tooth", "teeth", "fossil", "fragment", "head", "paw",
          "footprint", "track", "fur", "texture", "femur", "tibia", "fibula", "radius", "ulna", "humerus", "rib",
          "vertebra", "pelvis", "scapula", "limb", "leg", "claw", "hoof", "horn", "antler", "detector", "fountain", "rig only", "base mesh", "sculpt", "bust", "statue", "figurine", "toy", "plush")
HEADERS = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) FacelessYT model finder"}

CHECK = """You check the preview of a 3D model before it is used in a documentary video. Pass it only if it
shows one whole {thing} that a viewer would recognise as that at a glance. Fail it if it shows
something else, several objects or a whole scene, only a part or fragment, a broken or very rough
scan, text or a logo, or a famous cartoon or brand character. Stylised or low-poly is fine when the
thing is clearly recognisable.
Reply with a single JSON object: {{"matches": true or false, "problems": "at most 12 words, or empty"}}."""


def slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:60] or "thing"


def _words(text: str) -> set[str]:
    return {w.rstrip("s") for w in re.findall(r"[a-z0-9]+", (text or "").lower()) if len(w) > 1}


def head_noun(term: str) -> str:
    """The noun a search term is about: its last word ('american black bear' is about a bear)."""
    words = re.findall(r"[a-z0-9]+", term.lower())
    return words[-1].rstrip("s") if words else ""


def relevant(term: str, title: str, tags: list[str]) -> float:
    """How well a candidate's title and tags match the term: 0 unless they name the term's noun, then
    the share of the term's words they contain."""
    have = _words(title) | set().union(*(_words(t) for t in tags)) if tags else _words(title)
    want = _words(term)
    if not want or head_noun(term) not in have or NOT_ONE_THING.search(title or ""):
        return 0.0
    if any(p.rstrip("s") in _words(title) and p.rstrip("s") not in want for p in A_PART):
        return 0.0
    return len(want & have) / len(want)


def licence_code(value: str | dict | None) -> str:
    if isinstance(value, dict):
        value = value.get("slug") or value.get("label") or ""
    v = (value or "").strip().lower()
    return LICENCES.get(v, v)


def credit(asset: dict) -> str:
    """The line the video's description carries for a model it shows."""
    by = f" by {asset['author']}" if asset.get("author") else ""
    lic = LICENCE_NAMES.get(asset.get("licence", ""), asset.get("licence", ""))
    return f"{asset.get('title') or asset['key']}{by} ({lic}) {asset.get('url', '')}".strip()


# --- the cache --------------------------------------------------------------------------


def _read(path: Path, default):
    try:
        return json.loads(path.read_text())
    except Exception:
        return default


def cached(key: str) -> dict | None:
    meta = _read(CACHE / key / "meta.json", None)
    # Only models whose preview a vision check passed (an older, text-only match is searched for again).
    if meta and meta.get("ok") and meta.get("checked") in ("vision", "vetted") and (CACHE / key / "model.glb").is_file():
        return meta | {"file": str(CACHE / key / "model.glb")}
    return None


def _missed(term: str) -> bool:
    when = _read(CACHE / "_misses.json", {}).get(slug(term))
    return bool(when) and datetime.fromisoformat(when) > datetime.now(timezone.utc) - timedelta(days=MISS_DAYS)


def _note_miss(term: str) -> None:
    CACHE.mkdir(parents=True, exist_ok=True)
    misses = _read(CACHE / "_misses.json", {})
    misses[slug(term)] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    (CACHE / "_misses.json").write_text(json.dumps(misses, indent=1, sort_keys=True))


def _rejected() -> dict:
    return _read(CACHE / "_rejected.json", {})


def _note_rejected(uid: str, why: str) -> None:
    CACHE.mkdir(parents=True, exist_ok=True)
    seen = _rejected()
    seen[uid] = why[:120]
    (CACHE / "_rejected.json").write_text(json.dumps(seen, indent=1, sort_keys=True))


# --- sources ------------------------------------------------------------------------------
# Each source yields candidates: dicts with uid, source, title, tags, author, licence, url, thumb,
# triangles, animated, and fetch(dest) -> Path that downloads the model file.


def _get(url: str, **kw) -> requests.Response:
    kw["headers"] = HEADERS | kw.get("headers", {})
    r = requests.get(url, timeout=kw.pop("timeout", 30), **kw)
    r.raise_for_status()
    return r


_paths: dict | None = None


def objaverse_paths() -> dict:
    """Objaverse's uid -> file index (one download, kept with the model cache)."""
    global _paths
    if _paths is None:
        file = CACHE / "_objaverse" / "object-paths.json.gz"
        if not file.is_file():
            file.parent.mkdir(parents=True, exist_ok=True)
            with _get(f"{OBJAVERSE}/object-paths.json.gz", timeout=300, stream=True) as r, open(file.with_suffix(".part"), "wb") as f:
                shutil.copyfileobj(r.raw, f)
            file.with_suffix(".part").rename(file)
        _paths = json.loads(gzip.decompress(file.read_bytes()))
    return _paths


def _download(url: str, dest: Path, headers: dict | None = None, limit_mb: float = 80) -> Path:
    with requests.get(url, headers=HEADERS | (headers or {}), timeout=120, stream=True) as r:
        r.raise_for_status()
        size = 0
        with open(dest, "wb") as f:
            for chunk in r.iter_content(1 << 16):
                size += len(chunk)
                if size > limit_mb * 1e6:
                    raise RuntimeError(f"model file over {limit_mb:g} MB")
                f.write(chunk)
    return dest


def _thumb(images: list[dict]) -> str | None:
    images = sorted((i for i in images or [] if i.get("url")), key=lambda i: abs((i.get("width") or 0) - 640))
    return images[0]["url"] if images else None


def sketchfab(cfg: Config, term: str, log) -> list[dict]:
    r = _get(f"{SKETCHFAB}/search", params={"type": "models", "q": term, "downloadable": "true", "count": 24})
    token = secret("SKETCHFAB_TOKEN")
    out = []
    for m in r.json().get("results", []):
        uid = m.get("uid")
        tags = [t.get("name", "") if isinstance(t, dict) else str(t) for t in m.get("tags", [])]
        if not uid or not relevant(term, m.get("name", ""), tags):
            continue
        if not token:
            try:
                path = objaverse_paths().get(uid)
            except Exception as e:
                log(f"assets: the Objaverse index is out of reach ({str(e)[:80]}); Sketchfab models need SKETCHFAB_TOKEN")
                return []
            if not path:
                continue  # newer than the mirror: downloadable only with a token
        else:
            path = None
        user = m.get("user") or {}
        out.append({
            "uid": f"sketchfab:{uid}", "source": "sketchfab" if token else "objaverse", "title": m.get("name", ""), "tags": tags,
            "author": user.get("displayName") or user.get("username") or "", "licence": licence_code(m.get("license")),
            "url": m.get("viewerUrl") or f"https://sketchfab.com/3d-models/{uid}", "thumb": _thumb((m.get("thumbnails") or {}).get("images")),
            "triangles": m.get("faceCount") or 0, "animated": bool(m.get("animationCount")), "score": relevant(term, m.get("name", ""), tags),
            "_uid": uid, "_path": path,
        })
        if len(out) >= CANDIDATES:
            break
    for c in out:  # search results don't always carry the licence: the model's own page does
        if c["licence"] not in LICENCES.values():
            try:
                d = _get(f"{SKETCHFAB}/models/{c['_uid']}").json()
                c["licence"] = licence_code(d.get("license"))
                c["url"] = d.get("viewerUrl") or c["url"]
            except Exception:
                c["licence"] = ""

    def fetcher(c):
        def fetch(dest: Path) -> Path:
            if token:
                d = _get(f"{SKETCHFAB}/models/{c['_uid']}/download", headers={"Authorization": f"Token {token}"}).json()
                if not d.get("glb"):
                    raise RuntimeError("no glb download offered")
                return _download(d["glb"]["url"], dest)
            return _download(f"{OBJAVERSE}/{c['_path']}", dest)
        return fetch

    for c in out:
        c["fetch"] = fetcher(c)
    return out


def _pick(d: dict, *names, default=None):
    low = {k.lower().replace(" ", ""): v for k, v in d.items()}
    for n in names:
        if n.lower().replace(" ", "") in low:
            return low[n.lower().replace(" ", "")]
    return default


def polypizza(cfg: Config, term: str, log) -> list[dict]:
    key = secret("POLY_PIZZA_KEY")
    if not key:
        return []
    r = _get(f"{POLY_PIZZA}/search/{requests.utils.quote(term)}", params={"Limit": 24}, headers={"x-auth-token": key})
    out = []
    for m in r.json().get("results", []):
        title, tags = _pick(m, "Title", "name", default=""), _pick(m, "Tags", default=[]) or []
        url = _pick(m, "Download", default="")
        if not url or not relevant(term, title, tags):
            continue
        creator = _pick(m, "Creator", default={}) or {}
        uid = _pick(m, "ID", "id", default=title)
        out.append({
            "uid": f"polypizza:{uid}", "source": "polypizza", "title": title, "tags": tags,
            "author": _pick(creator, "Username", "name", default="") if isinstance(creator, dict) else str(creator),
            "licence": licence_code(_pick(m, "Licence", "License", default="")), "url": f"https://poly.pizza/m/{uid}",
            "thumb": _pick(m, "Thumbnail", default=None), "triangles": _pick(m, "Tri Count", "TriCount", default=0) or 0,
            "animated": bool(_pick(m, "Animated", default=False)), "score": relevant(term, title, tags),
            "fetch": (lambda u: (lambda dest: _download(u, dest)))(url),
        })
        if len(out) >= CANDIDATES:
            break
    return out


def image_to_3d(cfg: Config, term: str, log, entity: Entity | None = None) -> list[dict]:
    """A model generated from a picture of the entity (drawn in the house style on white), by the
    image-to-3D Space configured in `visuals.image_to_3d_space`. Its look is the picture's, so the
    scene is labelled an illustration."""
    space = cfg.visuals.image_to_3d_space
    if not space or entity is None:
        return []
    from fyt import artgen

    if not artgen.provider():
        return []

    def fetch(dest: Path) -> Path:
        from gradio_client import Client, handle_file  # optional: pip install gradio_client

        picture = dest.with_suffix(".png")
        thing = f"{entity.search[0]}, {entity.look}"
        artgen.cut_out(artgen.generate(f"{artgen.PROP.format(thing=thing)} {artgen.STYLE}", seed=23)).save(picture)
        client = Client(space, hf_token=secret("HF_TOKEN"))
        names = {e for e in (client.view_api(return_format="dict", print_info=False) or {}).get("named_endpoints", {})}
        if "/start_session" in names:
            client.predict(api_name="/start_session")
        if "/image_to_3d" in names and "/extract_glb" in names:  # TRELLIS
            client.predict(image=handle_file(str(picture)), multiimages=[], api_name="/image_to_3d")
            glb = client.predict(mesh_simplify=0.95, texture_size=1024, api_name="/extract_glb")
        elif "/generation_all" in names:  # Hunyuan3D-style
            glb = client.predict(image=handle_file(str(picture)), api_name="/generation_all")
        else:
            raise RuntimeError(f"{space} offers no image-to-3D endpoint this code knows: {sorted(names)[:8]}")
        file = glb[0] if isinstance(glb, (list, tuple)) else glb
        file = file.get("path") if isinstance(file, dict) else file
        shutil.copy2(file, dest)
        return dest

    return [{
        "uid": f"generated:{slug(term)}", "source": "generated", "title": f"{term} (generated)", "tags": [term],
        "author": f"generated with {space}", "licence": "generated", "url": f"https://huggingface.co/spaces/{space}",
        "thumb": None, "triangles": 0, "animated": False, "score": 1.0, "fetch": fetch, "illustrative": True,
    }]


SOURCES: dict[str, Callable] = {"sketchfab": sketchfab, "polypizza": polypizza, "image_to_3d": image_to_3d}


# --- checks and preparation -----------------------------------------------------------------


def looks_right(cfg: Config, entity: Entity, term: str, picture: Path) -> tuple[bool | None, str]:
    """The vision check of a preview: (True / False / None when no check could be made, problems)."""
    from fyt import storyboard

    v = storyboard.review(cfg, picture, f"{term}: {entity.look}", rules=CHECK.format(thing=term))
    return (None, "") if v is None else (v.matches, v.problems)


def prepare(raw: Path, out: Path, triangles: int, texture: int = 1024) -> dict:
    """renderer/prepare-model.mjs on a downloaded model: what it holds, or {"ok": False, "error": ...}."""
    try:
        p = subprocess.run(
            ["node", "prepare-model.mjs", str(raw), str(out), "--triangles", str(triangles), "--texture", str(texture)],
            cwd=RENDERER_DIR, capture_output=True, text=True, timeout=300,
        )
        line = next((x for x in reversed(p.stdout.splitlines()) if x.startswith("{")), "")
        return json.loads(line) if line else {"ok": False, "error": (p.stderr or "no output")[-300:]}
    except Exception as e:
        return {"ok": False, "error": str(e)[:300]}


def sound(info: dict, max_mb: float) -> str | None:
    """Why a prepared model can't be used, or None: it must load, hold real detail and fit the budget."""
    if not info.get("ok"):
        return info.get("error") or "did not load"
    if info.get("triangles", 0) < MIN_TRIANGLES:
        return f"only {info.get('triangles')} triangles"
    if info.get("bytes", 0) > max_mb * 1e6:
        return f"{info['bytes'] / 1e6:.0f} MB after preparation"
    size = info.get("size") or [0, 0, 0]
    if min(size) <= 0 or max(size) <= 0:
        return "empty bounds"
    return None


def _try(cfg: Config, entity: Entity, term: str, c: dict, fidelity: str, log) -> dict | None:
    if c["licence"] not in cfg.visuals.licences and c["source"] != "generated":
        return None
    if c["uid"] in _rejected():
        return None
    work = Path(tempfile.mkdtemp(prefix="fyt-model-"))
    try:
        # Its preview must be seen to show the thing: a title and tags alone have let through a bear's
        # jawbone for a bear. Without a preview or a vision check, the model is not used.
        if c["source"] != "generated":
            if not c.get("thumb"):
                log(f"assets: {c['title']!r} ({c['source']}) has no preview to check; skipped")
                return None
            try:
                _download(c["thumb"], work / "thumb.jpg", limit_mb=5)
            except requests.RequestException as e:
                log(f"assets: {c['title']!r}: preview out of reach ({str(e)[:80]}); skipped")
                return None
            ok, why = looks_right(cfg, entity, term, work / "thumb.jpg")
            if ok is None:
                raise Unchecked(c["title"])
            if not ok:
                log(f"assets: {c['title']!r} ({c['source']}) is not a {term}: {why}")
                _note_rejected(c["uid"], f"vision: {why}")
                return None
            c["checked"] = "vision"
        raw = c["fetch"](work / "raw.glb")
        budget = cfg.visuals.triangles.get(fidelity, 40000)
        info = prepare(raw, work / "model.glb", budget)
        bad = sound(info, cfg.visuals.max_model_mb)
        if bad:
            log(f"assets: {c['title']!r} ({c['source']}) can't be used: {bad}")
            _note_rejected(c["uid"], bad)
            return None
        key = slug(term)
        folder = CACHE / key
        if folder.exists():
            shutil.rmtree(folder)
        folder.mkdir(parents=True)
        shutil.copy2(work / "model.glb", folder / "model.glb")
        if (work / "thumb.jpg").exists():
            shutil.copy2(work / "thumb.jpg", folder / "preview.jpg")
        meta = {
            "ok": True, "key": key, "query": term, "source": c["source"], "uid": c["uid"], "title": c["title"],
            "author": c.get("author", ""), "licence": c["licence"], "url": c.get("url", ""), "checked": c.get("checked", "text"),
            "triangles": info["triangles"], "bytes": info["bytes"], "size": info["size"], "clips": info.get("clips", []),
            "skinned": info.get("skinned", False), "morphs": info.get("morphs", False), "fidelity": fidelity,
            "illustrative": bool(c.get("illustrative")), "look": entity.look,
            "added": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        }
        (folder / "meta.json").write_text(json.dumps(meta, indent=2))
        log(f"assets: {entity.name} -> {c['title']!r} from {c['source']} ({c['licence']}, {info['triangles']} triangles, "
            f"{len(meta['clips'])} animations)")
        return meta | {"file": str(folder / "model.glb")}
    except Unchecked:
        raise
    except Exception as e:
        log(f"assets: {c['title']!r} ({c['source']}) failed: {str(e)[:160]}")
        return None
    finally:
        shutil.rmtree(work, ignore_errors=True)


def project_model(entity: Entity) -> dict | None:
    """A vetted model in the project library that names the entity."""
    text = " ".join([entity.name] + entity.search)
    for key, e in assets.registry().items():
        if assets.library_ready(e) and scenes3d.find(text, e.get("names", [])):
            file = assets.MODELS_DIR / Path(e["src"]).name
            return {"ok": True, "key": key, "query": entity.search[0], "source": "project", "title": e.get("title", key),
                    "author": e.get("author", ""), "licence": e.get("licence", ""), "url": e.get("source", ""),
                    "checked": "vetted", "clips": e.get("clips", []), "file": str(file), "fit": e.get("fit", {})}
    return None


class Unchecked(Exception):
    """No vision check can be made now (the free allowance is spent, or none is configured)."""


def resolve(cfg: Config, entity: Entity, fidelity: str = "medium", log=print) -> dict | None:
    """The model for one entity, best source first (see the module docstring), or None."""
    try:
        return _resolve(cfg, entity, fidelity, log)
    except Unchecked as e:  # not a miss: the same search is tried again when the check is back
        log(f"assets: no vision check could be made (first candidate {str(e)!r}); {entity.name} stays painted this time")
        return None


def _resolve(cfg: Config, entity: Entity, fidelity: str, log) -> dict | None:
    found = project_model(entity)
    if found:
        return found
    for term in entity.search:
        hit = cached(slug(term))
        if hit:
            return hit
    for term in entity.search:
        if _missed(term):
            continue
        searched = False
        for name in cfg.visuals.asset_sources:
            source = SOURCES.get(name)
            if source is None:
                continue
            try:
                found_ = source(cfg, term, log, entity) if name == "image_to_3d" else source(cfg, term, log)
            except Exception as e:
                log(f"assets: {name} search for {term!r} failed: {str(e)[:120]}")
                continue
            searched = searched or name != "image_to_3d" or bool(found_)
            for c in sorted(found_, key=lambda c: -c["score"]):
                hit = _try(cfg, entity, term, c, fidelity, log)
                if hit:
                    return hit
        if searched:  # a search that ran and found nothing usable; an outage is tried again next time
            _note_miss(term)
    return None


def resolve_all(cfg: Config, m: "manifest.Manifest", wanted: dict[str, str], log=print, time_limit: float = 600) -> dict[str, dict]:
    """Models for the entities the plan wants in 3D ({entity id: fidelity}), within a time limit."""
    out: dict[str, dict] = {}
    start = time.monotonic()
    for eid, fidelity in wanted.items():
        e = manifest.entity(m, eid)
        if e is None or time.monotonic() - start > time_limit:
            continue
        hit = resolve(cfg, e, fidelity, log)
        if hit:
            out[eid] = hit
        else:
            log(f"assets: no usable model of {e.name} ({', '.join(e.search)}): its scenes stay painted")
    return out


def stage(found: dict[str, dict], public: Path) -> dict[str, str]:
    """Copy the video's models into its public folder; returns {entity id: src for the renderer}."""
    srcs = {}
    for eid, a in found.items():
        (public / "models").mkdir(parents=True, exist_ok=True)
        name = f"{slug(a['key'])}.glb"
        shutil.copy2(a["file"], public / "models" / name)
        srcs[eid] = f"models/{name}"
    return srcs


def wanted(script, story: "manifest.Manifest") -> dict[str, str]:
    """{entity id: fidelity} for the entities the plan put on the stage, the closest shot deciding."""
    out: dict[str, str] = {}
    rank = {"wide": 0, "medium": 1, "close": 2}
    for s in script.scenes:
        if s.type == "world" and s.subject == "stage" and manifest.entity(story, s.subject_name):
            f = "wide" if s.shot == "wide" else "medium"
            if rank[f] > rank.get(out.get(s.subject_name, "wide"), -1) or s.subject_name not in out:
                out[s.subject_name] = f
    return out


def back_to_2d(scene):
    """A 3D scene put back to the scene it replaced (or a statement, for one the scriptwriter staged)."""
    from fyt.models import ScriptScene

    if scene.fallback:
        return ScriptScene.model_validate(scene.fallback)
    return scene.model_copy(update={"type": "statement", "heading": scene.heading or " ".join(scene.narration.split()[:6]),
                                    "subject": None, "action": None, "model": None, "label": None})


def attach(script, story: "manifest.Manifest", found: dict[str, dict], srcs: dict[str, str]):
    """Stage scenes given their entity's model, the same one in every scene (continuity); a stage scene
    whose entity has no model goes back to its 2D scene. Returns (script, scene indexes put back)."""
    scenes, back = list(script.scenes), []
    for i, s in enumerate(scenes):
        if s.type != "world" or s.subject != "stage":
            continue
        e, a = manifest.entity(story, s.subject_name), found.get(s.subject_name or "")
        if e is None or a is None or s.subject_name not in srcs:
            scenes[i] = back_to_2d(s)
            back.append(i)
            continue
        generated = a.get("source") == "generated" or a.get("illustrative")
        model = {"id": a["key"], "level": "generated" if generated else "found", "title": a.get("title"), "kind": "object",
                 "src": srcs[s.subject_name], "fit": a.get("fit") or {}, "clips": a.get("clips", []), "params": {},
                 "sources": [a["url"]] if a.get("url") else [], "licence": a.get("licence"), "author": a.get("author", ""),
                 "notes": f"{a.get('source')} model for {e.name}: {e.look}"}
        if s.illustrative:
            label = "ILLUSTRATION"
        elif generated or not e.certain:
            label = "RECONSTRUCTION · ILLUSTRATIVE"  # the event is told; the thing's exact look is not known
        else:
            label = "RECONSTRUCTION"
        scenes[i] = s.model_copy(update={"model": model, "label": label})
    return script.model_copy(update={"scenes": scenes}), back


def registry(story: "manifest.Manifest", found: dict[str, dict]) -> dict:
    """The video's asset registry: every entity, its look and the one model that draws it, with credit."""
    return {
        "entities": [
            e.model_dump() | {"model": ({k: v for k, v in found[e.id].items() if k != "file"} | {"credit": credit(found[e.id])}) if e.id in found else None}
            for e in story.entities
        ],
        "places": [p.model_dump() for p in story.places],
        "moments": [m.model_dump() for m in story.moments],
    }


def credits(found: dict[str, dict]) -> list[str]:
    """Description lines for the models a video shows that ask for credit (CC BY, CC BY-SA)."""
    return sorted({credit(a) for a in found.values() if a.get("licence") in ("by", "by-sa")})
