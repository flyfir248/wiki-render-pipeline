from fyt import freeimages, media, pipeline, wiki
from fyt.config import Config
from fyt.models import Script
from fyt.store import Job


def _fake_get(monkeypatch, bodies: dict):
    calls = []

    def get(url, params):
        calls.append((url, params))
        return bodies[url]

    monkeypatch.setattr(freeimages, "_get", get)
    return calls


def test_openverse_asks_only_for_licences_a_monetised_video_may_use(monkeypatch):
    calls = _fake_get(monkeypatch, {freeimages.OPENVERSE: {"results": [
        {"id": "a1", "title": "Man in a white suit, 1952", "url": "https://live.staticflickr.com/1/a.jpg",
         "foreign_landing_url": "https://www.flickr.com/photos/x/1", "creator": "Jane Roe", "license": "by",
         "license_version": "2.0", "width": 1024, "height": 768, "filetype": "jpg", "tags": [{"name": "suit"}]},
        {"id": "a2", "title": "Tiny", "url": "https://x/t.jpg", "license": "cc0", "width": 120, "height": 90},
        {"id": "a3", "title": "Company logo", "url": "https://x/l.png", "license": "cc0", "width": 900, "height": 900},
        {"id": "a4", "title": "A drawing", "url": "https://x/d.svg", "license": "pdm", "filetype": "svg"},
    ]}})
    hits = freeimages.search_openverse("white suit")
    assert calls[0][1]["license_type"] == "commercial,modification"  # never NC or ND
    assert [h.title for h in hits] == ["Man in a white suit, 1952"]
    assert hits[0].credit == "Man in a white suit, 1952 (Jane Roe, CC BY 2.0): https://www.flickr.com/photos/x/1"
    assert hits[0].source == "openverse" and "suit" in hits[0].description


def test_library_of_congress_keeps_only_items_free_to_publish(monkeypatch):
    item = lambda title, rights, urls: {
        "title": title, "url": f"https://www.loc.gov/item/{title[:3]}/", "access_restricted": False,
        "image_url": urls, "item": {"rights_advisory": rights, "contributors": ["Genthe, Arnold"]},
    }
    _fake_get(monkeypatch, {freeimages.LOC: {"results": [
        item("Man wearing a white suit", "No known restrictions on publication.",
             ["https://tile.loc.gov/storage-services/service/pnp/agc/7a1/7a17874_150px.jpg#h=150&w=108",
              "https://tile.loc.gov/storage-services/service/pnp/agc/7a1/7a17874r.jpg#h=420&w=303"]),
        item("Press photo", "Publication may be restricted.", ["https://x/p.jpg#h=900&w=900"]),
        item("Small scan", "No known restrictions", ["https://x/s.jpg#h=200&w=150"]),
    ]}})
    hits = freeimages.search_loc("white suit")
    assert [h.title for h in hits] == ["Man wearing a white suit"]
    assert hits[0].url.endswith("7a17874v.jpg")  # the 1024px copy, not the 303px one
    assert hits[0].artist == "Genthe, Arnold" and hits[0].source == "loc"


def test_nasa_leaves_out_photos_it_credits_to_someone_else(monkeypatch):
    it = lambda i, desc: {"data": [{"nasa_id": i, "title": f"Apollo {i}", "description": desc, "center": "JSC"}],
                          "links": [{"href": f"https://images-assets.nasa.gov/image/{i}/{i}~thumb.jpg"}]}
    _fake_get(monkeypatch, {freeimages.NASA: {"collection": {"items": [it("11", "Crew portrait"), it("12", "Photo © Getty Images")]}}})
    hits = freeimages.search_nasa("apollo")
    assert [h.url for h in hits] == ["https://images-assets.nasa.gov/image/11/11~medium.jpg"]
    assert hits[0].license == "Public domain, NASA"


def test_search_goes_past_commons_only_when_it_has_too_few_of_the_subject(monkeypatch):
    im = lambda t, src: wiki.WikiImage(t, f"https://x/{t}.jpg", "p", t, "", "CC0", src)
    asked = []

    def source(name, hits):
        def fn(q, n):
            asked.append(name)
            if hits is None:
                raise RuntimeError("down")
            return hits
        return fn

    monkeypatch.setitem(freeimages.SOURCES, "commons", source("commons", [im("Somerton beach", "commons"), im("Luchador", "commons")]))
    monkeypatch.setitem(freeimages.SOURCES, "openverse", source("openverse", None))
    monkeypatch.setitem(freeimages.SOURCES, "loc", source("loc", [im("Somerton man", "loc"), im("Somerton beach", "loc")]))
    monkeypatch.setitem(freeimages.SOURCES, "nasa", source("nasa", [im("Somerton x", "nasa")]))
    keep = lambda hits: [h for h in hits if "Somerton" in h.title]
    warned = []
    found = freeimages.search(Config(), "Somerton", limit=2, keep=keep, log=warned.append)
    assert [h.title for h in found] == ["Somerton beach", "Somerton man"]  # off-subject and repeats dropped
    assert asked == ["commons", "openverse", "loc"]  # a failing source is skipped; stops once it has enough
    assert "openverse" in warned[0]

    cfg = Config()
    cfg.growth.image_sources = ["commons"]
    assert [h.title for h in freeimages.search(cfg, "Somerton", keep=keep)] == ["Somerton beach"]


def test_a_topic_with_no_article_images_gets_searched_photos_to_script_with(monkeypatch, tmp_path):
    found = [wiki.WikiImage(f"Man in a white suit {n}", f"https://x/{n}.jpg", f"https://p/{n}", f"White suit {n}", "", "CC BY 2.0", "openverse") for n in range(4)]
    monkeypatch.setattr(freeimages, "search", lambda cfg, q, limit=6, keep=None, log=print: keep(found)[:limit])
    job = Job(tmp_path / "job")
    job.public.mkdir(parents=True)
    menu = pipeline._more_images(Config(), job, [], "White suit mystery")
    assert [im.title for im in menu] == [im.title for im in found]
    article = [wiki.WikiImage(f"File:{n}.jpg", "u", "p", "d", "", "CC0") for n in range(6)]
    assert pipeline._more_images(Config(), job, article, "White suit mystery") == article  # enough already


def test_a_searched_photo_the_script_picked_is_still_checked_by_eye(monkeypatch, tmp_path):
    images = [wiki.WikiImage("File:Lead.jpg", "https://x/a.jpg", "p", "the man", "", "CC0"),
              wiki.WikiImage("Fashion shoot", "https://x/b.jpg", "p", "white suit", "", "CC BY 2.0", "openverse")]
    monkeypatch.setattr(wiki, "download_image", lambda im, dst: dst.write_bytes(b"jpg"))
    monkeypatch.setattr(wiki, "search_commons", lambda q: [])
    monkeypatch.setattr(media, "fetch_broll", lambda *a: None)
    monkeypatch.setattr(media, "fetch_photo", lambda *a: None)
    seen = []

    def review(cfg, path, meant, rules=""):
        seen.append(path.name)
        return pipeline.storyboard.Verdict(matches=False, problems="a fashion shoot")

    monkeypatch.setattr(pipeline.storyboard, "review", review)
    s = Script.model_validate({
        "title": "t", "description": "d", "tags": [], "thumbnail_text": "x", "thumbnail_kicker": "y",
        "thumbnail_query": "z", "sources": [], "scenes": [
            {"narration": "He was found on the beach.", "type": "title", "heading": "a", "image": 1},
            {"narration": "He wore a white suit.", "type": "statement", "text": "Suit", "image": 2},
        ]})
    job = Job(tmp_path / "job")
    job.public.mkdir(parents=True)
    scene_media, credits, _ = pipeline.scene_visuals(Config(), job, s, images, "x", "White suit")
    assert scene_media[0].src == "media/wiki1.jpg"  # the article's own image is not second-guessed
    assert 1 not in scene_media and seen == ["wiki2.jpg"]
    assert len(credits) == 1
