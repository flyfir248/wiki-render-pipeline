from fyt import insights
from fyt.config import Config
from fyt.store import Uploads


def curve_dropping_in(spans, total=60.0, fast=0.02, slow=0.002):
    """A retention curve that loses viewers fast inside `spans` (seconds) and slowly elsewhere."""
    points, level = [], 1.0
    for i in range(101):
        t = total * i / 100
        points.append((i / 100, level))
        level -= (fast if any(a <= t < b for a, b in spans) else slow) * total / 100
    return points


OUTLINE = {
    "duration": 60.0,
    "format": "short",
    "scenes": [["title", 0, 6], ["list", 6, 18], ["story", 18, 30], ["list", 30, 42], ["story", 42, 54], ["stat", 54, 60]],
}


def test_scenes_that_lose_viewers_fast_score_above_one():
    losses = insights.scene_losses(OUTLINE, curve_dropping_in([(6, 18), (30, 42)]))
    by = {}
    for kind, loss in losses:
        by.setdefault(kind, []).append(loss)
    assert min(by["list"]) > 1.2 and max(by["story"]) < 0.6
    assert "title" not in by  # the opening is judged on its own


def test_summary_names_what_to_use_more_and_less():
    outlines = {f"v{i}": OUTLINE for i in range(5)}
    curves = {f"v{i}": curve_dropping_in([(6, 18), (30, 42)]) for i in range(5)}
    text = insights.summarise(outlines, curves, "short")
    held, lost = text.split("\n")[:2]
    assert "story" in held and "list" in lost
    assert "3 seconds in" in text
    assert insights.summarise(outlines, curves, "long") == ""  # Shorts don't teach long videos


def test_uploads_keep_the_scene_outline(tmp_path):
    cfg = Config(jobs_dir=str(tmp_path))
    (tmp_path / "job1").mkdir()
    (tmp_path / "job1" / "props.json").write_text(
        '{"duration": 12.0, "format": "short", "scenes": [{"type": "title", "start": 0, "end": 4}, {"type": "map", "start": 4, "end": 12}]}'
    )
    Uploads(cfg).record("short", "job1", "yt1", None)
    assert Uploads(cfg).outlines()["yt1"]["scenes"] == [["title", 0, 4], ["map", 4, 12]]


def test_opening_hold_is_measured_against_the_curves_start():
    from fyt.insights import opening_hold

    # A looping Short: the watch ratio starts above 1, so a raw reading would say "122% still watching".
    curve = [(0.0, 1.5), (0.06, 1.22), (1.0, 0.6)]
    hold = opening_hold({"duration": 50.0, "scenes": []}, curve)
    assert hold is not None and abs(hold - 1.22 / 1.5) < 0.01
    assert opening_hold({"duration": 50.0, "scenes": []}, [(0.0, 1.0), (1.0, 1.4)]) == 1.0
