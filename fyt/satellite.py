"""Satellite maps: real imagery of the Earth under a map scene's borders, pins and routes.

A Google Earth look, built only from imagery that is free to use on a monetised channel:

- the whole world and the wide views: NASA's Blue Marble, from NASA GIBS (public domain);
- the close views: a cloud-free mosaic of ESA's Copernicus Sentinel-2 (10 m true colour, free and open
  with attribution), read straight from the Sentinel-2 COGs on AWS (no key).

Google Earth itself can't be used here: its imagery comes only out of Google's own apps, by hand, and
Google's terms don't allow capturing it into an automated render.

`stage` writes, for each map scene of a satellite video, the images its camera passes over, coarse to
fine, as Web Mercator rasters with their lon/lat bounds (`scene.satellite`); the first map also gets an
equirectangular world texture for the opening globe. The renderer lays them under the borders. Nothing
here is required: any failure leaves the video on the drawn atlas map.
"""

from __future__ import annotations

import io
import math
import os
import re
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from pathlib import Path

import httpx
import numpy as np
from PIL import Image, ImageFilter

R = 6378137.0  # Web Mercator sphere radius, metres
MAX_LAT = 85.0511287798
CREDIT_WORLD = "NASA Blue Marble"
CREDIT_S2 = "Contains modified Copernicus Sentinel data"
S2_BUCKET = "https://sentinel-cogs.s3.us-west-2.amazonaws.com"
S2_PREFIX = "sentinel-s2-l2a-cogs"
# NASA GIBS's Blue Marble, tried in order: the first that answers is used for the whole run.
GIBS = [
    "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_NextGeneration/default/{time}/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg",
    "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default/{time}/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg",
]
GIBS_TIMES = ["2004-08-01", "", "default"]
GIBS_MAX_Z = 8
MAX_PX = 4096  # longest side of one layer
S2_MAX_TILES = 160  # Sentinel-2 granules one close view may read
S2_MAX_MPP = 450.0  # coarser than this (metres per pixel on the ground), Blue Marble is as good

# The renderer's frame and the box it fits a map into (renderer/src/scenes/map.tsx): long, short.
FRAME = {"long": (1920, 1080, ((200, 210), (1720, 900))), "short": (1080, 1920, ((90, 420), (990, 1220)))}


# --- Mercator ------------------------------------------------------------------------------------

def merc_y(lat: float) -> float:
    lat = max(-MAX_LAT, min(MAX_LAT, lat))
    return math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))


def lat_of(y: float) -> float:
    return math.degrees(2 * math.atan(math.exp(y)) - math.pi / 2)


def _rel(lon: float, lon0: float) -> float:
    return ((lon - lon0 + 540) % 360) - 180


def mid_lon(pts: list[tuple[float, float]]) -> float:
    x = sum(math.cos(math.radians(p[0])) for p in pts)
    y = sum(math.sin(math.radians(p[0])) for p in pts)
    return math.degrees(math.atan2(y, x))


def box(pts, lon0, factor, minimum):
    """map.tsx's `box`: the places padded by `factor` of their span (at least `minimum` degrees)."""
    lons = [_rel(p[0], lon0) for p in pts]
    lats = [p[1] for p in pts]
    x0, x1, y0, y1 = min(lons), max(lons), min(lats), max(lats)
    pad = max(minimum, max(x1 - x0, y1 - y0) * factor)
    return (max(-179, x0 - pad), max(-80, y0 - pad), min(179, x1 + pad), min(80, y1 + pad))


def fit(b, rect):
    """map.tsx's `fit`: the Mercator scale (pixels per radian) and centre that fit box `b` into `rect`."""
    (rx0, ry0), (rx1, ry1) = rect
    x0, x1 = math.radians(b[0]), math.radians(b[2])
    y0, y1 = merc_y(b[1]), merc_y(b[3])
    scale = min((rx1 - rx0) / max(x1 - x0, 1e-9), (ry1 - ry0) / max(y1 - y0, 1e-9))
    scale = max(scale, (rx1 - rx0) / (2 * math.pi))
    return scale, ((x0 + x1) / 2, (y0 + y1) / 2)


def view_bounds(scale, center, lon0, fmt, zoom=1.0, margin=1.25):
    """The lon/lat box the whole frame shows at this view (with a margin), and its metres per pixel."""
    w, h, _ = FRAME[fmt]
    half_w, half_h = w / 2 / scale * margin, h / 2 / scale * margin
    cx, cy = center
    west = math.degrees(cx - half_w) + lon0
    east = math.degrees(cx + half_w) + lon0
    south, north = lat_of(cy - half_h), lat_of(cy + half_h)
    ground = R * math.cos(math.radians((south + north) / 2)) / (scale * zoom)
    return (west, south, east, north), ground


def mark_points(marks) -> list[tuple[float, float]]:
    """The points a scene's marks cover, as markPoints in renderer/src/scenes/mapmarks.tsx."""
    out = []
    for m in marks or []:
        pt, km = m.get("point"), m.get("km")
        if m.get("kind") == "ring" and pt and km:
            dl = math.degrees(km / 6371)
            dx = dl / max(0.2, math.cos(math.radians(pt[1])))
            out += [tuple(pt), (pt[0], pt[1] + dl), (pt[0], pt[1] - dl), (pt[0] + dx, pt[1]), (pt[0] - dx, pt[1])]
            continue
        out += [tuple(p) for p in m.get("path") or []] + ([tuple(pt)] if pt else [])
    return [p for p in out if abs(p[1]) <= 80 and abs(p[0]) <= 180]


def scene_views(scene, fmt: str):
    """The wide and close views of a map scene, as map.tsx frames them: (lon0, wide, close) with each
    view as (bounds, metres per pixel). None when the scene has nothing to frame."""
    pts = [(p.lon, p.lat) for p in (scene.places or []) if abs(p.lat) <= 80 and abs(p.lon) <= 180]
    frame_pts = (pts or region_points(scene.regions or [])) + mark_points(getattr(scene, "marks", None))
    if not frame_pts:
        return None
    rect = FRAME[fmt][2]
    lon0 = mid_lon(frame_pts)
    close = fit(box(frame_pts, lon0, 0.35 if pts else 0.12, 1.5 if len(pts) > 1 else 3), rect)
    close = (close[0] * max(1.0, scene.zoom or 1.0), close[1])
    wide = fit(box(frame_pts, lon0, 2.5, 25), rect)
    # With a vehicle the camera rides along at 2.2x and tilts; the far edge shows more ground.
    ride = 2.2 if (scene.vehicle and len(pts) > 1 and scene.route is not False) else 1.0
    # halfway through the fly-in, where neither the world nor the close-up is sharp enough
    mid = (math.sqrt(wide[0] * close[0]), ((wide[1][0] + close[1][0]) / 2, (wide[1][1] + close[1][1]) / 2))
    return (
        lon0,
        view_bounds(*wide, lon0, fmt, margin=1.6),
        view_bounds(*close, lon0, fmt, zoom=ride, margin=1.5 if ride == 1 else 1.9),
        view_bounds(*mid, lon0, fmt, margin=1.5),
    )


# --- Region outlines (the same borders the renderer draws) -------------------------------------------

_ATLAS = Path(__file__).resolve().parent.parent / "renderer" / "src" / "data" / "countries-ind-50m.json"
_REGION_CACHE: dict[str, list[tuple[float, float]]] | None = None


def _decode_topology(path: Path) -> dict[str, list[list[tuple[float, float]]]]:
    """Each country's rings (outer rings only), from a quantised TopoJSON file."""
    import json

    topo = json.loads(path.read_text(encoding="utf-8"))
    (sx, sy), (tx, ty) = topo["transform"]["scale"], topo["transform"]["translate"]
    arcs = []
    for arc in topo["arcs"]:
        x = y = 0
        pts = []
        for dx, dy in arc:
            x += dx
            y += dy
            pts.append((x * sx + tx, y * sy + ty))
        arcs.append(pts)

    def ring(ids):
        out = []
        for i in ids:
            a = arcs[i] if i >= 0 else arcs[~i][::-1]
            out.extend(a if not out else a[1:])
        return out

    shapes = {}
    for g in topo["objects"]["countries"]["geometries"]:
        polys = g.get("arcs") or []
        if g["type"] == "Polygon":
            polys = [polys]
        shapes[g.get("properties", {}).get("name", "")] = [ring(p[0]) for p in polys if p]
    return shapes


def _area(r):
    return abs(sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(r, r[1:] + r[:1]))) / 2


ALIASES = {
    "united states": "United States of America", "usa": "United States of America", "us": "United States of America",
    "america": "United States of America", "uk": "United Kingdom", "britain": "United Kingdom",
    "great britain": "United Kingdom", "england": "United Kingdom", "uae": "United Arab Emirates",
    "drc": "Dem. Rep. Congo", "democratic republic of the congo": "Dem. Rep. Congo", "russian federation": "Russia",
    "persia": "Iran", "burma": "Myanmar", "korea": "South Korea", "czech republic": "Czechia",
}


def region_points(names: list[str]) -> list[tuple[float, float]]:
    """The middle and corners of each named country's biggest piece (map.tsx's `regionPoints`)."""
    global _REGION_CACHE
    if not names:
        return []
    if _REGION_CACHE is None:
        _REGION_CACHE = {}
        if _ATLAS.exists():
            for name, rings in _decode_topology(_ATLAS).items():
                if rings:
                    main = max(rings, key=_area)
                    xs, ys = [p[0] for p in main], [p[1] for p in main]
                    c = (sum(xs) / len(xs), sum(ys) / len(ys))
                    _REGION_CACHE[name.lower()] = [c, (min(xs), min(ys)), (max(xs), max(ys))]
    out = []
    for n in names:
        key = re.sub(r"^the ", "", n.strip().lower())
        out += _REGION_CACHE.get(ALIASES.get(key, key).lower(), [])
    return out


# --- Blue Marble (NASA GIBS) ---------------------------------------------------------------------

class _Gibs:
    def __init__(self, client: httpx.Client):
        self.client = client
        self.template: str | None = None
        self.tried = False

    def _url(self, z, x, y):
        return self.template.format(z=z, x=x, y=y)

    def find(self) -> bool:
        if self.tried:
            return self.template is not None
        self.tried = True
        for t in GIBS:
            for time in GIBS_TIMES:
                url = t.format(time=time, z=1, x=1, y=0).replace("default//", "default//")
                try:
                    r = self.client.get(url, timeout=20)
                    if r.status_code == 200 and r.headers.get("content-type", "").startswith("image"):
                        self.template = t.replace("{time}", time)
                        return True
                except httpx.HTTPError:
                    continue
        return False

    def tile(self, z, x, y) -> Image.Image | None:
        for _ in range(3):
            try:
                r = self.client.get(self._url(z, x, y), timeout=30)
                if r.status_code == 200:
                    return Image.open(io.BytesIO(r.content)).convert("RGB")
            except httpx.HTTPError:
                pass
        return None

    def mosaic(self, bounds, z) -> Image.Image | None:
        """Blue Marble over `bounds` (west, south, east, north) at tile zoom `z`, cropped to the bounds."""
        if not self.find():
            return None
        n = 2 ** z
        west, south, east, north = bounds
        fx = lambda lon: (lon + 180) / 360 * n  # noqa: E731
        fy = lambda lat: (1 - merc_y(lat) / math.pi) / 2 * n  # noqa: E731
        x0, x1 = fx(west), fx(east)
        y0, y1 = fy(north), fy(south)
        tx0, tx1, ty0, ty1 = math.floor(x0), math.ceil(x1), max(0, math.floor(y0)), min(n, math.ceil(y1))
        if (tx1 - tx0) * (ty1 - ty0) > 400:
            return None
        canvas = Image.new("RGB", ((tx1 - tx0) * 256, (ty1 - ty0) * 256), (10, 32, 53))
        jobs = [(tx, ty) for tx in range(tx0, tx1) for ty in range(ty0, ty1)]
        with ThreadPoolExecutor(8) as pool:
            tiles = list(pool.map(lambda t: self.tile(z, t[0] % n, t[1]), jobs))
        got = 0
        for (tx, ty), im in zip(jobs, tiles):
            if im is not None:
                canvas.paste(im.resize((256, 256)), ((tx - tx0) * 256, (ty - ty0) * 256))
                got += 1
        if got < len(jobs) * 0.8:
            return None
        crop = (round((x0 - tx0) * 256), round((y0 - ty0) * 256), round((x1 - tx0) * 256), round((y1 - ty0) * 256))
        return canvas.crop(crop)


def gibs_zoom(ground_mpp: float, lat: float) -> int:
    """The GIBS zoom whose pixels are at least as fine as `ground_mpp` metres."""
    at_equator = ground_mpp / max(0.2, math.cos(math.radians(lat)))
    z = math.ceil(math.log2(2 * math.pi * R / 256 / max(at_equator, 1.0)))
    return max(1, min(GIBS_MAX_Z, z))


# --- Sentinel-2 ------------------------------------------------------------------------------------

def granules(bounds) -> list[str]:
    """The Sentinel-2 granules (MGRS 100 km squares such as 40RDQ) covering `bounds`."""
    import mgrs

    m = mgrs.MGRS()
    west, south, east, north = bounds
    step = 0.15
    out = []
    lat = south
    while lat <= north + step:
        lon = west
        while lon <= east + step:
            la, lo = min(lat, north), ((min(lon, east) + 180) % 360) - 180
            if abs(la) < 84:
                g = m.toMGRS(la, lo, MGRSPrecision=0)
                if g not in out:
                    out.append(g)
            lon += step
        lat += step
    return out


def _list(client, prefix) -> list[str]:
    r = client.get(S2_BUCKET + "/", params={"list-type": "2", "prefix": prefix, "delimiter": "/"}, timeout=30)
    r.raise_for_status()
    ns = {"s": "http://s3.amazonaws.com/doc/2006-03-01/"}
    return [e.text for e in ET.fromstring(r.text).findall("s:CommonPrefixes/s:Prefix", ns)]


MGRS_BANDS = "CDEFGHJKLMNPQRSTUVWX"  # 8-degree latitude bands from 80S


def season(band: str) -> tuple[int, ...]:
    """The months that show a granule's ground best: snow-free summer away from the tropics (the
    Volga in October is already white), the clear dry season (November to March) nearer the equator."""
    south = -80 + 8 * MGRS_BANDS.index(band.upper()) if band.upper() in MGRS_BANDS else 0
    return (5, 6, 7, 8, 9) if south >= 40 else (11, 12, 1, 2, 3)


def _months(today: date, prefer: tuple[int, ...] = (11, 12, 1, 2, 3)) -> list[tuple[int, int]]:
    """The last 18 months, the preferred season first, newest first within each."""
    months = []
    y, m = today.year, today.month
    for _ in range(18):
        months.append((y, m))
        y, m = (y, m - 1) if m > 1 else (y - 1, 12)
    return sorted(months, key=lambda ym: (ym[1] not in prefer, -(ym[0] * 12 + ym[1])))


_PICKS: dict[tuple[str, int], list[str]] = {}


def best_scenes(client, granule: str, n: int = 4, today: date | None = None, budget: int = 30) -> list[str]:
    """The `n` clearest recent Sentinel-2 scenes of a granule (folder URLs), clearest first. Remembered
    for the run: the scenes of one video share most of their granules."""
    if (granule, n) not in _PICKS:
        _PICKS[(granule, n)] = _best_scenes(client, granule, n, today, budget)
    return _PICKS[(granule, n)]


def _best_scenes(client, granule: str, n: int, today: date | None, budget: int) -> list[str]:
    zone, band, sq = granule[:-3], granule[-3], granule[-2:]
    base = f"{S2_PREFIX}/{int(zone)}/{band}/{sq}/"
    found: list[tuple[float, str, float, int]] = []
    looked = 0
    for y, m in _months(today or date.today(), season(band)):
        try:
            scenes = _list(client, f"{base}{y}/{m}/")
        except httpx.HTTPError:
            continue
        for sc in sorted(scenes, reverse=True):
            if looked >= budget:
                break
            looked += 1
            # the scene's STAC item (tileinfo_metadata's cloud figure reads 0 on recent scenes)
            name = sc.rstrip("/").rsplit("/", 1)[-1]
            when = re.search(r"_(\d{8})_", name)
            if when and (today or date.today()).toordinal() - date(int(when[1][:4]), int(when[1][4:6]), int(when[1][6:])).toordinal() < 3:
                continue  # still being processed: its files may not all be there yet
            try:
                info = client.get(f"{S2_BUCKET}/{sc}{name}.json", timeout=20).json()["properties"]
            except Exception:
                continue
            cloud = float(info.get("eo:cloud_cover", 100))
            cover = 100 - float(info.get("s2:nodata_pixel_percentage", 100))
            # which pass saw it: the relative orbit, from the product name (..._N0511_R120_T40REQ...)
            hit = re.search(r"_R(\d{3})_", info.get("s2:product_uri", ""))
            orbit = int(hit.group(1)) if hit else round(cover / 8)
            if cloud < 25 and cover > 3:
                found.append((cloud * 3 + (100 - cover) * 0.5, f"{S2_BUCKET}/{sc}", cover, orbit))
        if len({f[3] for f in found if f[0] < 50}) >= 2 and len(found) >= n or looked >= budget:
            break
    # A granule at the edge of an orbit's swath is only ever partly seen from that orbit, so the picks
    # come from each orbit that sees it: the best two of each, until there are `n`.
    ranked = sorted(found)
    by_orbit: dict[int, list[str]] = {}
    for _, u, _, orbit in ranked:
        by_orbit.setdefault(orbit, []).append(u)
    picks: list[str] = []
    for depth in range(n):
        for urls in sorted(by_orbit.values(), key=lambda us: [u for _, u, _, _ in ranked].index(us[0]))[:3]:
            if depth < len(urls) and len(picks) < n and urls[depth] not in picks:
                picks.append(urls[depth])
    return picks


def composite(parts: list[np.ndarray]) -> np.ndarray:
    """One cloud-free picture from a few dates of the same ground: at each pixel, of the dates that saw
    it, the one of middle brightness (three or more), or the darker (two). Clouds are bright and a
    missing date is 0, so neither wins."""
    stack = np.stack(parts)  # (k, 3, h, w)
    bright = stack.astype(np.int32).sum(axis=1)  # (k, h, w)
    valid = bright > 0
    count = valid.sum(axis=0)
    key = np.where(valid, bright, 10**6)  # missing sorts last
    order = np.argsort(key, axis=0)
    # the index (in brightness order) to take: median of the valid ones, the darker of two
    pick_rank = np.where(count >= 3, count // 2, 0)
    pick = np.take_along_axis(order, pick_rank[None], axis=0)[0]
    out = np.take_along_axis(stack, pick[None, None].repeat(3, axis=1), axis=0)[0]
    out[:, count == 0] = 0
    return out


def s2_mosaic(bounds, size: tuple[int, int], ground_mpp: float, log=print) -> Image.Image | None:
    """A Sentinel-2 true-colour mosaic over `bounds`, as a Web Mercator RGBA image of `size` (alpha 0
    where no granule had data)."""
    try:
        import rasterio
        from rasterio.transform import from_bounds
        from rasterio.warp import Resampling, reproject
    except ImportError:
        log("satellite: rasterio isn't installed, no Sentinel-2 close-ups")
        return None
    west, south, east, north = bounds
    gs = granules(bounds)
    if len(gs) > S2_MAX_TILES:
        log(f"satellite: the close view needs {len(gs)} Sentinel-2 granules, more than {S2_MAX_TILES}")
        return None
    w, h = size
    to_m = lambda lon: math.radians(lon) * R  # noqa: E731
    dst_transform = from_bounds(to_m(west), merc_y(south) * R, to_m(east), merc_y(north) * R, w, h)
    # The coarsest overview that is still finer than the view (10 m, then 20, 40, 80, 160).
    level = max(-1, min(3, int(math.floor(math.log2(max(ground_mpp, 10) / 10))) - 1))
    with httpx.Client(follow_redirects=True) as client, ThreadPoolExecutor(6) as pool:
        # a wide mosaic takes fewer dates a granule, to keep its reads in check
        n = 4 if len(gs) <= 40 else 3 if len(gs) <= 90 else 2
        per_granule = [s for s in pool.map(lambda g: best_scenes(client, g, n), gs) if s]
    if not per_granule:
        return None
    env = {"GDAL_DISABLE_READDIR_ON_OPEN": "EMPTY_DIR", "CPL_VSIL_CURL_ALLOWED_EXTENSIONS": ".tif",
           "GDAL_HTTP_MAX_RETRY": "3", "GDAL_HTTP_RETRY_DELAY": "2", "VSI_CACHE": "TRUE"}
    ca = os.environ.get("CURL_CA_BUNDLE") or os.environ.get("SSL_CERT_FILE")
    if ca:
        env["CURL_CA_BUNDLE"] = ca

    def read(url):
        out = np.zeros((3, h, w), dtype=np.uint8)
        try:
            with rasterio.Env(**env), rasterio.open("/vsicurl/" + url + "TCI.tif",
                                                    **({"overview_level": level} if level >= 0 else {})) as src:
                reproject(rasterio.band(src, [1, 2, 3]), out, src_transform=src.transform, src_crs=src.crs, src_nodata=0,
                          dst_transform=dst_transform, dst_crs="EPSG:3857", dst_nodata=0, resampling=Resampling.bilinear)
        except Exception as e:  # one missing granule leaves a gap the coarser layer shows through
            log(f"satellite: couldn't read {url}: {e}")
            return None
        return out

    def granule(urls):
        parts = [p for p in map(read, urls) if p is not None]
        return composite(parts) if parts else None

    # Neighbouring granules were seen on different days, so where they overlap each fades out towards
    # its own edge: the seams blend instead of stepping.
    acc = np.zeros((3, h, w), dtype=np.float32)
    weight = np.zeros((h, w), dtype=np.float32)
    soft = max(4, round(min(w, h) / 80))
    with ThreadPoolExecutor(4) as pool:
        for part in pool.map(granule, per_granule):
            if part is None:
                continue
            have = (part.sum(axis=0) > 0).astype(np.uint8) * 255
            wgt = np.asarray(Image.fromarray(have).filter(ImageFilter.BoxBlur(soft)).filter(ImageFilter.BoxBlur(soft)), np.float32)
            wgt = (wgt / 255) ** 2 * (have > 0) + 1e-6 * (have > 0)
            acc += part.astype(np.float32) * wgt
            weight += wgt
    mosaic = (acc / np.maximum(weight, 1e-9)).clip(0, 255).astype(np.uint8)
    alpha = (weight > 0).astype(np.uint8) * 255
    if alpha.mean() < 255 * 0.25:
        log("satellite: Sentinel-2 covered under a quarter of the close view")
        return None
    rgb = np.moveaxis(mosaic, 0, -1)
    return Image.fromarray(np.dstack([rgb, alpha]), "RGBA")


# --- Look ----------------------------------------------------------------------------------------

def grade(im: Image.Image, ref: Image.Image | None = None, amount: float = 0.6) -> Image.Image:
    """Lift Sentinel-2's flat true colour a little, and pull its colours towards the layer beneath it
    (`ref`, the same ground from Blue Marble) so the close-up doesn't sit in the wide view like a patch."""
    a = np.asarray(im).astype(np.float32)
    rgb, alpha = a[..., :3], a[..., 3:] if a.shape[2] == 4 else None
    valid = (alpha[..., 0] > 0) if alpha is not None else np.ones(rgb.shape[:2], bool)
    rgb = 255 * np.power(np.clip(rgb / 255, 0, 1), 0.85)
    if ref is not None and valid.any():
        r = np.asarray(ref.convert("RGB").resize(im.size)).astype(np.float32)
        for c in range(3):
            src, dst = rgb[..., c][valid], r[..., c][valid]
            if src.std() > 1 and dst.std() > 1:
                matched = (rgb[..., c] - src.mean()) / src.std() * dst.std() + dst.mean()
                rgb[..., c] = rgb[..., c] * (1 - amount) + matched * amount
    grey = rgb.mean(axis=2, keepdims=True)
    rgb = np.clip(grey + (rgb - grey) * 1.12, 0, 255)
    out = np.dstack([rgb, alpha]) if alpha is not None else rgb
    return Image.fromarray(out.astype(np.uint8), "RGBA" if alpha is not None else "RGB")


def feather(im: Image.Image, edge: float = 0.06) -> Image.Image:
    """Fade a layer out towards its edges and gaps, so the coarser one beneath takes over smoothly."""
    im = im.convert("RGBA")
    w, h = im.size
    px = max(4, int(min(w, h) * edge))
    ramp = lambda n: np.clip(np.minimum(np.arange(n), np.arange(n)[::-1]) / px, 0, 1)  # noqa: E731
    edges = np.outer(ramp(h), ramp(w))
    a = np.asarray(im.getchannel("A")).astype(np.float32) / 255
    a = np.asarray(Image.fromarray((a * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(px / 3))).astype(np.float32) / 255
    a = np.minimum(a, edges)
    im.putalpha(Image.fromarray((a * 255).astype(np.uint8)))
    return im


def equirect(world: Image.Image, width: int = 2048) -> Image.Image:
    """The Mercator world (to 85°) as an equirectangular texture for the opening globe; the poles above
    85° take the colour of the last row (ice)."""
    h = width // 2
    src = np.asarray(world.convert("RGB"))
    sh = src.shape[0]
    lats = 90 - (np.arange(h) + 0.5) / h * 180
    ys = np.array([(1 - merc_y(la) / math.pi) / 2 * sh for la in lats]).clip(0, sh - 1).astype(int)
    xs = (np.arange(width) / width * src.shape[1]).astype(int)
    return Image.fromarray(src[ys][:, xs])


# --- Staging -------------------------------------------------------------------------------------

def feathered(cache: dict, key: str, public: Path) -> bool:
    """Give a layer soft edges (once), so it fades into the coarser one beneath."""
    layer = cache[key]
    if not layer["src"].endswith(".jpg"):
        return True
    src = public / layer["src"]
    out = src.with_suffix(".webp")
    feather(Image.open(src)).save(out, quality=86, method=4)
    src.unlink()
    layer["src"] = layer["src"][:-4] + ".webp"
    return True


def _size(bounds, ground_mpp, oversample=1.3) -> tuple[int, int]:
    west, south, east, north = bounds
    mid = math.cos(math.radians((south + north) / 2))
    m_per_px = ground_mpp / oversample / mid  # in Mercator metres
    w = (math.radians(east - west) * R) / m_per_px
    hgt = ((merc_y(north) - merc_y(south)) * R) / m_per_px
    k = min(1.0, MAX_PX / max(w, hgt))
    return max(16, round(w * k)), max(16, round(hgt * k))


# --- Terrain ---------------------------------------------------------------------------------------

DEM_MAX_TILES = 40
DEM_SIZE = 384  # elevation samples across the flyover's longer side
CREDIT_DEM = "Copernicus DEM"


def _dem_url(lat: int, lon: int, res: int) -> str:
    ns, ew = ("N" if lat >= 0 else "S"), ("E" if lon >= 0 else "W")
    name = f"Copernicus_DSM_COG_{10 if res == 30 else 30}_{ns}{abs(lat):02d}_00_{ew}{abs(lon):03d}_00_DEM"
    return f"https://copernicus-dem-{res}m.s3.amazonaws.com/{name}/{name}.tif"


def dem_grid(bounds, size: tuple[int, int], log=print) -> np.ndarray | None:
    """Elevation in metres over `bounds` on a grid even in latitude and longitude (rows north to
    south), from the Copernicus DEM (sea, where it has no tile, is 0). None without rasterio or data."""
    try:
        import rasterio
        from rasterio.transform import from_bounds
        from rasterio.warp import Resampling, reproject
    except ImportError:
        return None
    west, south, east, north = bounds
    tiles = [(la, lo) for la in range(math.floor(south), math.ceil(north)) for lo in range(math.floor(west), math.ceil(east))]
    if len(tiles) > DEM_MAX_TILES:
        log(f"satellite: the flyover needs {len(tiles)} elevation tiles, more than {DEM_MAX_TILES}")
        return None
    w, h = size
    res = 30 if (east - west) / w * 111_000 < 60 else 90
    dst = from_bounds(west, south, east, north, w, h)
    env = {"GDAL_DISABLE_READDIR_ON_OPEN": "EMPTY_DIR", "CPL_VSIL_CURL_ALLOWED_EXTENSIONS": ".tif", "GDAL_HTTP_MAX_RETRY": "3"}
    ca = os.environ.get("CURL_CA_BUNDLE") or os.environ.get("SSL_CERT_FILE")
    if ca:
        env["CURL_CA_BUNDLE"] = ca

    def read(tile):
        out = np.full((h, w), np.nan, dtype=np.float32)
        try:
            with rasterio.Env(**env), rasterio.open("/vsicurl/" + _dem_url(*tile, res)) as src:
                reproject(rasterio.band(src, 1), out, src_transform=src.transform, src_crs=src.crs, dst_transform=dst,
                          dst_crs="EPSG:4326", dst_nodata=np.nan, resampling=Resampling.bilinear)
        except Exception:  # no tile: open sea
            return None
        return out

    grid = np.zeros((h, w), dtype=np.float32)
    found = 0
    with ThreadPoolExecutor(6) as pool:
        for part in pool.map(read, tiles):
            if part is not None:
                found += 1
                grid = np.where(np.isnan(part), grid, part)
    if not found:
        log("satellite: no elevation data under the flyover")
        return None
    return np.clip(grid, -500, 9000)


def terrain_rgb(grid: np.ndarray) -> Image.Image:
    """Heights packed into a PNG's colours (Mapbox terrain-RGB: metres = -10000 + (R*65536 + G*256 + B) / 10)."""
    v = np.round((grid + 10000) * 10).astype(np.uint32)
    rgb = np.dstack([(v >> 16) & 255, (v >> 8) & 255, v & 255]).astype(np.uint8)
    return Image.fromarray(rgb, "RGB")


def flyover_bounds(scene) -> tuple[float, float, float, float] | None:
    """The ground a flyover shows: its places (or regions) with room round them, at least 0.6 degrees."""
    pts = [(p.lon, p.lat) for p in (scene.places or []) if abs(p.lat) <= 80 and abs(p.lon) <= 180]
    pts = pts or region_points(scene.regions or [])
    if not pts:
        return None
    lons, lats = [p[0] for p in pts], [p[1] for p in pts]
    cx, cy = (min(lons) + max(lons)) / 2, (min(lats) + max(lats)) / 2
    half_lat = max(0.3, (max(lats) - min(lats)) * 0.8)
    half_lon = max(half_lat / max(0.2, math.cos(math.radians(cy))), (max(lons) - min(lons)) * 0.8)
    # a 16:9 piece of ground, so the far horizon is filled whichever way the camera looks
    half_lon = max(half_lon, half_lat * 1.4 / max(0.2, math.cos(math.radians(cy))))
    return (cx - half_lon, max(-80, cy - half_lat), cx + half_lon, min(80, cy + half_lat))


def stage_terrain(scene, i: int, public: Path, gibs, log=print) -> dict | None:
    b = flyover_bounds(scene)
    if b is None:
        return None
    west, south, east, north = b
    lat = (south + north) / 2
    across_lon = (east - west) * math.cos(math.radians(lat))
    span = max(across_lon, north - south)
    w = round(DEM_SIZE * across_lon / span)
    h = round(DEM_SIZE * (north - south) / span)
    grid = dem_grid(b, (w, h), log=log)
    if grid is None:
        return None
    tw = 3072
    th = round(tw * (merc_y(north) - merc_y(south)) / math.radians(east - west))
    mpp = (east - west) * 111_320 * math.cos(math.radians(lat)) / tw
    tex = s2_mosaic(b, (tw, th), max(mpp, 10), log=log) if mpp <= S2_MAX_MPP else None
    if tex is not None:
        ref = gibs.mosaic(b, gibs_zoom(mpp * 2, lat))
        tex = grade(tex, ref)
        # gaps in the mosaic show the Blue Marble underneath
        if ref is not None:
            base = ref.convert("RGBA").resize(tex.size, Image.LANCZOS)
            tex = Image.alpha_composite(base, tex)
    else:
        tex = gibs.mosaic(b, gibs_zoom(mpp, lat))
    if tex is None:
        return None
    dem_name, tex_name = f"satellite/s{i + 1}-dem.png", f"satellite/s{i + 1}-terrain.jpg"
    terrain_rgb(grid).save(public / dem_name)
    tex.convert("RGB").save(public / tex_name, quality=88)
    log(f"satellite: scene {i + 1}: flyover {w}x{h} elevation, {float(grid.min()):.0f} to {float(grid.max()):.0f} m")
    path = [[p.lon, p.lat] for p in (scene.places or [])] if scene.route else None
    # the ground's colour round its edge, for the plain that carries it on to the horizon
    rim = np.asarray(tex.convert("RGB").resize((64, 64)), np.float32)
    rim = np.concatenate([rim[0], rim[-1], rim[:, 0], rim[:, -1]]).mean(axis=0) * 0.8
    edge = "#" + "".join(f"{int(v):02x}" for v in rim)
    return {"dem": dem_name, "tex": tex_name, "bounds": [west, south, east, north], "edge": edge,
            "minM": float(grid.min()), "maxM": float(grid.max()), "path": path}


def stage(script, public: Path, fmt: str, log=print) -> object:
    """Fetch the imagery for every map scene of a satellite video and attach it to the scenes. Returns
    the script (unchanged when imagery isn't wanted or can't be had) and records the credits on it."""
    if (script.map_style or "") != "satellite":
        return script
    maps = [i for i, s in enumerate(script.scenes) if s.type == "map"]
    if not maps:
        return script
    out = public / "satellite"
    out.mkdir(parents=True, exist_ok=True)
    with httpx.Client(follow_redirects=True, headers={"User-Agent": "fyt-satellite/1.0"}) as client:
        gibs = _Gibs(client)
        world = gibs.mosaic((-180, -MAX_LAT, 180, MAX_LAT), 3)
        if world is None:
            log("satellite: NASA GIBS didn't answer; the maps stay drawn")
            return script
        world.save(out / "world.jpg", quality=88)
        equirect(world).save(out / "globe.jpg", quality=88)
        world_layer = {"src": "satellite/world.jpg", "west": -180, "south": -MAX_LAT, "east": 180, "north": MAX_LAT}
        used_s2 = used_dem = False
        scenes = list(script.scenes)
        cache: dict[str, dict] = {}
        for n, i in enumerate(maps):
            s = scenes[i]
            views = scene_views(s, fmt)
            if not views:
                continue
            _, (wide_b, wide_mpp), (close_b, close_mpp), (mid_b, mid_mpp) = views
            layers = [world_layer]
            for tag, b, mpp in (("wide", wide_b, wide_mpp), ("mid", mid_b, mid_mpp)):
                key = repr(tuple(round(v, 2) for v in b))
                if key not in cache:
                    z = gibs_zoom(mpp / 1.3, (b[1] + b[3]) / 2)
                    im = None
                    while z > 3 and im is None:  # too many tiles at this zoom: one coarser
                        im = gibs.mosaic(b, z)
                        z -= 1
                    if im is not None:
                        name = f"satellite/s{i + 1}-{tag}.jpg"
                        if max(im.size) > MAX_PX:
                            k = MAX_PX / max(im.size)
                            im = im.resize((round(im.width * k), round(im.height * k)), Image.LANCZOS)
                        im.save(public / name, quality=88)
                        cache[key] = {"src": name, "west": b[0], "south": b[1], "east": b[2], "north": b[3]}
                if key in cache and (tag == "wide" or feathered(cache, key, public)):
                    layers.append(cache[key])
            lat = (close_b[1] + close_b[3]) / 2
            size = _size(close_b, close_mpp)
            close = None
            if close_mpp / 1.3 <= S2_MAX_MPP:
                log(f"satellite: scene {i + 1}: Sentinel-2 mosaic {size[0]}x{size[1]} at ~{close_mpp / 1.3:.0f} m/px")
                close = s2_mosaic(close_b, size, close_mpp / 1.3, log=log)
                if close is not None:
                    ref = gibs.mosaic(close_b, gibs_zoom(close_mpp, lat))
                    close = feather(grade(close, ref))
                    used_s2 = True
            if close is None:
                im = gibs.mosaic(close_b, gibs_zoom(close_mpp / 1.3, lat))
                close = feather(im) if im is not None else None
            if close is not None:
                name = f"satellite/s{i + 1}-close.webp"
                close.save(public / name, quality=86, method=4)
                layers.append({"src": name, "west": close_b[0], "south": close_b[1], "east": close_b[2], "north": close_b[3]})
            if n == 0:
                layers.insert(0, {"src": "satellite/globe.jpg", "kind": "globe"})
            update = {"satellite": layers}
            if s.flyover:
                try:
                    terrain = stage_terrain(s, i, public, gibs, log=log)
                except Exception as e:  # the flat satellite map still shows the place
                    log(f"satellite: scene {i + 1}: no flyover: {e}")
                    terrain = None
                if terrain:
                    update["terrain"] = terrain
                    used_dem = True
            scenes[i] = s.model_copy(update=update)
    credit = CREDIT_WORLD + (" · " + CREDIT_S2 + f" {date.today().year}" if used_s2 else "") + (" · " + CREDIT_DEM if used_dem else "")
    return script.model_copy(update={"scenes": scenes, "map_credit": "Imagery: " + credit})
