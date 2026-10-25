"""Freely licensed photos of a subject from more than Wikimedia Commons.

Commons is searched first; when it has too few photos of the subject, the search goes on to:
- openverse: Openverse (WordPress.org), 800M+ openly licensed images from Flickr, museums and
  archives. Only licences that allow commercial use and changes are asked for (CC0, public domain
  mark, CC BY, CC BY-SA), never NC or ND.
- loc: the Library of Congress's photo collections, only items it marks "No known restrictions on
  publication" or public domain (old news photos, portraits, street scenes).
- nasa: NASA's image library (US government work, public domain), minus anything it marks as
  copyrighted or courtesy of someone else.

None needs a key. Every hit carries its author, licence and page for the video's credits, and goes
through the same subject filter and vision check as a Commons photo. Search engines' image results
(Google Images, Bing) are deliberately not a source: most of what they find is copyrighted, and on a
monetised channel one claim can take down a video or strike the channel.
"""

from __future__ import annotations

import re
from typing import Callable

import requests

from fyt import wiki
from fyt.config import Config
from fyt.wiki import USER_AGENT, WikiImage

OPENVERSE = "https://api.openverse.org/v1/images/"
LOC = "https://www.loc.gov/photos/"
NASA = "https://images-api.nasa.gov/search"
MIN_SIDE = 400

Keep = Callable[[list[WikiImage]], list[WikiImage]]


def _get(url: str, params: dict) -> dict:
    r = requests.get(url, params=params, headers={"User-Agent": USER_AGENT}, timeout=30)
    r.raise_for_status()
    return r.json()


def _skip(name: str) -> bool:
    return any(w in name.lower() for w in wiki.SKIP_WORDS)


def _licence(code: str, version: str) -> str:
    code = (code or "").lower()
    if code == "cc0":
        return "CC0"
    if code == "pdm":
        return "Public domain"
    return f"CC {code.upper()} {version}".strip()


def search_openverse(query: str, limit: int = 6) -> list[WikiImage]:
    body = _get(OPENVERSE, {"q": query, "license_type": "commercial,modification", "page_size": 20, "mature": "false"})
    hits = []
    for r in body.get("results", []):
        w, h = r.get("width") or 0, r.get("height") or 0
        if (w and h and min(w, h) < MIN_SIDE) or not r.get("url"):
            continue
        if (r.get("filetype") or "jpg").lower() not in ("jpg", "jpeg", "png", "webp"):
            continue
        title = (r.get("title") or "").strip()
        if _skip(title):
            continue
        tags = ", ".join(t["name"] for t in (r.get("tags") or [])[:6] if t.get("name"))
        hits.append(
            WikiImage(
                title=title or f"Openverse {r.get('id', '')}",
                url=r["url"],
                page=r.get("foreign_landing_url") or f"https://openverse.org/image/{r.get('id', '')}",
                description=(f"{title} ({tags})" if tags else title)[:120],
                artist=(r.get("creator") or "")[:80],
                license=_licence(r.get("license", ""), r.get("license_version") or ""),
                source="openverse",
            )
        )
    return hits[:limit]


FREE_RIGHTS = ("no known restrictions", "public domain")


def _loc_image(item: dict) -> str | None:
    """The largest image a search result lists, as a pnp 1024px 'v' file where there is one."""
    best, best_w = None, 0
    for u in item.get("image_url") or []:
        m = re.search(r"#h=(\d+)&w=(\d+)", u)
        w = int(m.group(2)) if m else 0
        if u.split("#")[0].lower().endswith((".jpg", ".jpeg", ".png")) and w >= best_w:
            best, best_w = u.split("#")[0], w
    if best and re.search(r"/service/pnp/.+r\.jpg$", best):
        return best[: -len("r.jpg")] + "v.jpg"  # the Prints & Photographs 1024px copy
    return best if best and best_w >= MIN_SIDE else None


def search_loc(query: str, limit: int = 6) -> list[WikiImage]:
    body = _get(LOC, {"q": query, "fo": "json", "c": 25, "fa": "online-format:image"})
    hits = []
    for r in body.get("results", []):
        info = r.get("item") or {}
        rights = " ".join(str(x) for x in (info.get("rights_advisory"), info.get("rights_information"), r.get("rights")) if x)
        if r.get("access_restricted") or not any(f in rights.lower() for f in FREE_RIGHTS):
            continue
        url = _loc_image(r)
        title = (r.get("title") or info.get("title") or "").strip()
        if not url or _skip(title):
            continue
        who = (info.get("contributors") or r.get("contributor") or [""])[0]
        hits.append(
            WikiImage(
                title=title[:100],
                url=url,
                page=r.get("url") or info.get("link", ""),
                description=title[:120],
                artist=str(who)[:80],
                license="No known restrictions, Library of Congress",
                source="loc",
            )
        )
    return hits[:limit]


NOT_NASA = ("©", "copyright", "courtesy of", "getty", "reuters", "associated press")


def search_nasa(query: str, limit: int = 6) -> list[WikiImage]:
    body = _get(NASA, {"q": query, "media_type": "image", "page_size": 25})
    hits = []
    for r in body.get("collection", {}).get("items", []):
        data = (r.get("data") or [{}])[0]
        preview = next((l.get("href", "") for l in r.get("links") or [] if "~thumb" in l.get("href", "")), "")
        nasa_id = data.get("nasa_id", "")
        if not preview or not nasa_id:
            continue
        said = f"{data.get('description', '')} {data.get('photographer', '')} {data.get('secondary_creator', '')}".lower()
        title = (data.get("title") or nasa_id).strip()
        if any(w in said for w in NOT_NASA) or _skip(title):
            continue
        hits.append(
            WikiImage(
                title=title[:100],
                url=preview.replace("~thumb", "~medium"),
                page=f"https://images.nasa.gov/details/{nasa_id}",
                description=wiki._plain(f"{title}: {data.get('description', '')}")[:120],
                artist=(data.get("photographer") or data.get("center") or "NASA")[:80],
                license="Public domain, NASA",
                source="nasa",
            )
        )
    return hits[:limit]


SOURCES: dict[str, Callable[[str, int], list[WikiImage]]] = {
    "commons": lambda q, n: wiki.search_commons(q),
    "openverse": search_openverse,
    "loc": search_loc,
    "nasa": search_nasa,
}


def search(cfg: Config, query: str, limit: int = 6, keep: Keep | None = None, log: Callable[[str], None] = print) -> list[WikiImage]:
    """Photos for `query` from each source in `growth.image_sources` in turn, best match first, until
    `limit` pass `keep` (the caller's subject filter). A source that fails is skipped."""
    found: list[WikiImage] = []
    seen: set[str] = set()
    for name in cfg.growth.image_sources:
        fn = SOURCES.get(name)
        if fn is None:
            continue
        try:
            hits = fn(query, limit)
        except Exception as e:  # any one source is a nice-to-have
            log(f"warning: {name} image search failed for {query!r}: {e}")
            continue
        hits = [im for im in (keep(hits) if keep else hits) if im.url not in seen and im.title not in seen]
        seen.update(im.url for im in hits)
        seen.update(im.title for im in hits)
        found += hits
        if len(found) >= limit:
            break
    return found[:limit]
