import numpy as np

from fyt import satellite as S
from fyt.models import ScriptScene


def _inside(pt, ring):
    x, y = pt
    hit = False
    for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1]):
        if (y1 > y) != (y2 > y) and x < x1 + (y - y1) * (x2 - x1) / (y2 - y1):
            hit = not hit
    return hit


def test_borders_are_india_view():
    shapes = S._decode_topology(S._ATLAS)
    india = shapes["India"]
    # Aksai Chin, Gilgit and Arunachal Pradesh are drawn inside India
    for pt in [(79.3, 35.2), (74.3, 35.9), (93.6, 28.0)]:
        assert any(_inside(pt, r) for r in india), pt
    # names stay as the map's aliases expect
    assert {"United States of America", "North Korea", "South Korea", "Dem. Rep. Congo"} <= set(shapes)


def test_zoom_tightens_the_close_view():
    base = {"type": "map", "narration": "x", "heading": "h", "places": [{"name": "A", "lat": 26.6, "lon": 56.2}]}
    _, _, (b1, m1), _ = S.scene_views(ScriptScene.model_validate(base), "long")
    _, _, (b4, m4), _ = S.scene_views(ScriptScene.model_validate({**base, "zoom": 4}), "long")
    assert abs(m1 / m4 - 4) < 0.01
    assert (b4[2] - b4[0]) < (b1[2] - b1[0]) / 3.9


def test_regions_frame_the_country():
    pts = S.region_points(["Iran"])
    assert pts and 44 < pts[0][0] < 63 and 25 < pts[0][1] < 40


def test_composite_skips_clouds_and_gaps():
    clear, cloud, gap = (np.full((3, 2, 2), v, np.uint8) for v in (60, 250, 0))
    assert (S.composite([cloud, clear, clear]) == 60).all()  # middle of three
    assert (S.composite([cloud, clear]) == 60).all()  # darker of two
    assert (S.composite([gap, cloud]) == 250).all()  # the only one that saw it
    assert (S.composite([gap, gap]) == 0).all()


def test_granules_cover_the_strait():
    gs = S.granules((55.8, 26.0, 56.8, 27.0))
    assert "40RCQ" in gs or "40RDQ" in gs


def test_no_satellite_unless_asked(tmp_path):
    from fyt.models import Script

    script = Script.model_validate({
        "title": "t", "description": "d", "tags": ["a"], "thumbnail_text": "x", "thumbnail_kicker": "x",
        "thumbnail_query": "x", "core_message": "x", "sources": ["x"], "comment_question": "x",
        "scenes": [{"type": "map", "narration": "x", "heading": "h", "places": [{"name": "A", "lat": 1, "lon": 2}]}],
    })
    assert S.stage(script, tmp_path, "long") is script


def test_satellite_style_skips_3d(tmp_path, monkeypatch):
    from fyt import pipeline, visualplan
    from fyt.config import load_config
    from fyt.models import Script

    script = Script.model_validate({
        "title": "t", "description": "d", "tags": ["a"], "thumbnail_text": "x", "thumbnail_kicker": "x",
        "thumbnail_query": "x", "core_message": "x", "sources": ["x"], "comment_question": "x", "map_style": "satellite",
        "scenes": [{"type": "statement", "narration": "Tankers were hit.", "text": "Hit", "broll_query": "tanker"}],
    })
    monkeypatch.setattr(visualplan, "plan", lambda *a, **k: (_ for _ in ()).throw(AssertionError("planned 3D")))
    monkeypatch.setattr(pipeline, "log", lambda job, m: None)
    out = pipeline.plan_visuals(load_config(), None, script, "")
    assert all(s.type != "world" for s in out.scenes)
