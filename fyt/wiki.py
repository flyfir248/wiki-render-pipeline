"""Wikipedia as a content source: pick a niche article, fetch its text.

Articles become research notes; the script is written fresh from them in the
channel's own words. Wikipedia text is CC BY-SA 4.0, so every video built from
an article carries an attribution line in its description.
"""

from __future__ import annotations

import random
from dataclasses import dataclass

import requests

from fyt.config import Config

PREFIX = "wiki:"
USER_AGENT = "FacelessYT/0.1 (https://github.com/flyfir248/FacelessYT)"


@dataclass
class Article:
    title: str
    url: str
    text: str

    @property
    def attribution(self) -> str:
        return f'Based on the Wikipedia article "{self.title}" ({self.url}), licensed CC BY-SA 4.0.'


def is_wiki_topic(topic: str) -> bool:
    return topic.startswith(PREFIX)


def topic_for(title: str) -> str:
    return PREFIX + title


def _api(cfg: Config, **params) -> dict:
    r = requests.get(
        f"https://{cfg.wikipedia.lang}.wikipedia.org/w/api.php",
        params={"format": "json", "formatversion": 2, **params},
        headers={"User-Agent": USER_AGENT},
        timeout=30,
    )
    r.raise_for_status()
    body = r.json()
    if "error" in body:
        raise RuntimeError(f"Wikipedia API error: {body['error'].get('info')}")
    return body


def fetch_article(cfg: Config, title: str) -> Article:
    page = _api(
        cfg,
        action="query",
        prop="extracts|info",
        explaintext=1,
        inprop="url",
        redirects=1,
        titles=title,
    )["query"]["pages"][0]
    if page.get("missing") or not page.get("extract"):
        raise RuntimeError(f"Wikipedia has no article named {title!r}")
    text = _strip_tail(page["extract"])[: cfg.wikipedia.max_chars]
    return Article(title=page["title"], url=page["fullurl"], text=text)


def _strip_tail(text: str) -> str:
    """Drop reference-only sections that add noise to the notes."""
    for heading in ("\n== See also ==", "\n== References ==", "\n== Notes ==", "\n== External links ==", "\n== Further reading =="):
        i = text.find(heading)
        if i != -1:
            text = text[:i]
    return text.strip()


def candidates(cfg: Config) -> list[str]:
    """Article titles from the configured list pages and categories."""
    w = cfg.wikipedia
    titles: list[str] = list(w.articles)
    for page in w.list_pages:
        body = _api(cfg, action="parse", page=page, prop="links", redirects=1)
        titles += [link["title"] for link in body["parse"]["links"] if link["ns"] == 0 and link.get("exists", True)]
    for cat in w.categories:
        cont: dict = {}
        while True:
            body = _api(
                cfg,
                action="query",
                list="categorymembers",
                cmtitle=cat if cat.startswith("Category:") else f"Category:{cat}",
                cmtype="page",
                cmnamespace=0,
                cmlimit=500,
                **cont,
            )
            titles += [m["title"] for m in body["query"]["categorymembers"]]
            if "continue" not in body:
                break
            cont = body["continue"]
    seen, unique = set(), []
    for t in titles:
        if t not in seen:
            seen.add(t)
            unique.append(t)
    return unique


def pick_articles(cfg: Config, n: int, used: set[str], rng: random.Random | None = None) -> list[str]:
    """Up to n unused article titles with enough text to make a video from."""
    pool = [t for t in candidates(cfg) if topic_for(t) not in used]
    (rng or random).shuffle(pool)
    picked: list[str] = []
    for title in pool:
        if len(picked) >= n:
            break
        try:
            article = fetch_article(cfg, title)
        except Exception as e:
            print(f"skipping {title}: {e}")
            continue
        if len(article.text) >= cfg.wikipedia.min_chars and topic_for(article.title) not in used:
            picked.append(article.title)
    return picked


def notes(article: Article) -> str:
    return f"# {article.title}\nSource: {article.url}\n\n{article.text}"
