import random

from fyt import pipeline, wiki
from fyt.config import Config
from fyt.models import Script


class FakeResponse:
    def __init__(self, body):
        self.body = body

    def raise_for_status(self):
        pass

    def json(self):
        return self.body


def fake_api(monkeypatch, pages):
    """pages: title -> extract text. The list page links to every title."""

    def get(url, params, headers, timeout):
        assert "wikipedia.org" in url and headers["User-Agent"]
        if params["action"] == "parse":
            links = [{"ns": 0, "title": t, "exists": True} for t in pages] + [{"ns": 4, "title": "Wikipedia:Foo"}]
            return FakeResponse({"parse": {"links": links}})
        title = params["titles"]
        if title not in pages:
            return FakeResponse({"query": {"pages": [{"title": title, "missing": True}]}})
        url = "https://en.wikipedia.org/wiki/" + title.replace(" ", "_")
        return FakeResponse({"query": {"pages": [{"title": title, "fullurl": url, "extract": pages[title]}]}})

    monkeypatch.setattr(wiki.requests, "get", get)


def test_fetch_article_strips_reference_sections(monkeypatch):
    fake_api(monkeypatch, {"Boston Molasses Disaster": "Intro.\n\n== History ==\nFacts.\n\n== References ==\nJunk"})
    a = wiki.fetch_article(Config(), "Boston Molasses Disaster")
    assert a.text == "Intro.\n\n== History ==\nFacts."
    assert a.url.endswith("/Boston_Molasses_Disaster")
    assert "CC BY-SA 4.0" in a.attribution


def test_pick_articles_skips_used_and_stubs(monkeypatch):
    long = "x" * 5000
    fake_api(monkeypatch, {"Used one": long, "Stub": "short", "Fresh": long, "Also fresh": long})
    used = {wiki.topic_for("Used one")}
    picked = wiki.pick_articles(Config(), 5, used, random.Random(0))
    assert sorted(picked) == ["Also fresh", "Fresh"]


def test_wiki_attribution_added_once():
    a = wiki.Article(title="Tardigrade", url="https://en.wikipedia.org/wiki/Tardigrade", text="...")
    s = Script.model_validate(
        {
            "title": "t",
            "description": "About water bears.",
            "tags": [],
            "thumbnail_text": "x",
            "thumbnail_kicker": "y",
            "thumbnail_query": "z",
            "sources": [],
            "scenes": [{"narration": "Hi.", "type": "title", "heading": "Hi"}],
        }
    )
    once = pipeline.wiki_attribute(s, a)
    twice = pipeline.wiki_attribute(once, a)
    assert twice.description.count("CC BY-SA 4.0") == 1
    assert twice.sources == [a.url]


def test_upload_sheet_has_title_description_and_credit():
    from fyt import youtube

    a = wiki.Article(title="Tardigrade", url="https://en.wikipedia.org/wiki/Tardigrade", text="...")
    s = Script.model_validate(
        {
            "title": "The animal that survives space",
            "description": "About water bears.",
            "tags": ["tardigrade", "science"],
            "thumbnail_text": "x",
            "thumbnail_kicker": "y",
            "thumbnail_query": "z",
            "sources": [],
            "scenes": [{"narration": "Hi.", "type": "title", "heading": "Hi"}],
        }
    )
    cfg = Config(format="short")
    sheet = youtube.upload_sheet(cfg, pipeline.wiki_attribute(s, a))
    assert sheet.startswith("TITLE\nThe animal that survives space\n")
    assert "CC BY-SA 4.0" in sheet and "#Shorts" in sheet and "tardigrade, science" in sheet
