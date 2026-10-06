from fyt import illustrate
from fyt.config import Config
from fyt.models import Actor, Script, ScriptScene
from fyt.timeline import build_props

ICONS = {
    "width": 32,
    "height": 32,
    "icons": {
        "police-car": {"body": "<path d='M0 0'/>"},
        "oncoming-police-car": {"body": "<path/>"},
        "automobile": {"body": "<path/>"},
        "collision": {"body": "<circle r='4'/>"},
        "man-pilot": {"body": "<path/>"},
        "man-pilot-dark": {"body": "<path/>"},
        "rocket": {"body": "<path/>", "width": 36},
    },
}


def test_resolve_matches_plain_nouns():
    icons = ICONS["icons"]
    assert illustrate.resolve("Police car", icons) == "police-car"
    assert illustrate.resolve("car", icons) == "automobile"  # synonym
    assert illustrate.resolve("rockets", icons) == "rocket"  # plural
    assert illustrate.resolve("pilot", icons) == "man-pilot"  # word match, no skin-tone variant
    assert illustrate.resolve("an old car", icons) == "automobile"
    assert illustrate.resolve("oxygen tank", icons) is None


def test_props_are_written_and_unmatched_ones_left_out(tmp_path):
    scene = ScriptScene(
        narration="x",
        type="story",
        setting="space",
        actors=[Actor(thing="rocket", x=10, y=50, to_x=90), Actor(thing="oxygen tank")],
        effect="explosion",
    )
    s = Script(title="t", description="d", tags=[], thumbnail_text="t", thumbnail_kicker="k", thumbnail_query="q",
               scenes=[scene], sources=[])
    assert illustrate.add_props(s, tmp_path, ICONS) == 1
    svg = (tmp_path / "icons" / "rocket.svg").read_text()
    assert svg.startswith("<svg") and 'viewBox="0 0 36 32"' in svg
    assert scene.effect_src == "icons/collision.svg"
    props = build_props(Config(), s, [(0.0, 2.0)], [[]], {}, None, None)
    out = props.model_dump(exclude_none=True)["scenes"][0]
    assert [a["thing"] for a in out["actors"]] == ["rocket"]  # the prop with no drawing is dropped
    assert out["actors"][0]["src"] == "icons/rocket.svg" and out["actors"][0]["to_x"] == 90
    assert out["setting"] == "space" and out["effectSrc"] == "icons/collision.svg"


def test_the_real_icon_set_covers_the_synonyms():
    if not illustrate.ICONS.exists():  # installed with the renderer
        return
    icons = illustrate._icon_set()["icons"]
    assert all(v in icons for v in illustrate.SYNONYMS.values())
    assert all(v in icons for v in illustrate.EFFECTS.values() if v)
