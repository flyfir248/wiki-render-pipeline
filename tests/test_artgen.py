from PIL import Image, ImageDraw

from fyt import artgen
from fyt.config import Config
from fyt.models import Actor, Script, ScriptScene


def story_script():
    scene = ScriptScene(
        narration="x",
        type="story",
        setting="sea",
        backdrop="calm Pacific ocean at dawn",
        actors=[Actor(thing="ship", look="a grey 1970 navy recovery ship"), Actor(thing="parachute")],
    )
    other = ScriptScene(narration="y", type="statement", text="t")
    return Script(title="t", description="d", tags=[], thumbnail_text="t", thumbnail_kicker="k", thumbnail_query="q",
                  scenes=[scene, other], sources=[])


def drawing(prompt, vertical=False, seed=0):
    im = Image.new("RGB", (120, 120), (252, 252, 250))
    ImageDraw.Draw(im).ellipse((30, 30, 90, 90), fill=(20, 40, 80))
    return im


def test_provider_needs_keys(monkeypatch):
    for k in ("CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN", "TOGETHER_API_KEY"):
        monkeypatch.delenv(k, raising=False)
    assert artgen.provider() is None
    monkeypatch.setenv("TOGETHER_API_KEY", "k")
    assert artgen.provider() == "together"
    monkeypatch.setenv("CLOUDFLARE_ACCOUNT_ID", "a")
    monkeypatch.setenv("CLOUDFLARE_API_TOKEN", "t")
    assert artgen.provider() == "cloudflare"


def test_story_scenes_get_a_plate_and_cut_out_props(monkeypatch, tmp_path):
    monkeypatch.setenv("TOGETHER_API_KEY", "k")
    prompts = []
    monkeypatch.setattr(artgen, "generate", lambda p, vertical=False, seed=0: prompts.append(p) or drawing(p))
    s = story_script()
    assert artgen.illustrate(Config(format="short"), s, tmp_path) == 3
    scene = s.scenes[0]
    assert scene.backdrop_src.startswith("art/plate-") and (tmp_path / scene.backdrop_src).exists()
    prop = Image.open(tmp_path / scene.actors[0].src)
    assert prop.mode == "RGBA" and prop.getpixel((0, 0))[3] == 0  # the white around it is gone
    assert "A single grey 1970 navy recovery ship" in prompts[1] and "no facial features" in prompts[1]
    assert "Pacific ocean" in prompts[0] and "no people or vehicles" in prompts[0]


def test_failed_drawings_keep_the_fallback(monkeypatch, tmp_path):
    monkeypatch.setenv("TOGETHER_API_KEY", "k")

    def broken(p, vertical=False, seed=0):
        raise RuntimeError("quota")

    monkeypatch.setattr(artgen, "generate", broken)
    s = story_script()
    assert artgen.illustrate(Config(), s, tmp_path, log=lambda m: None) == 0
    assert s.scenes[0].backdrop_src is None and all(a.src is None for a in s.scenes[0].actors)


def test_no_keys_draws_nothing(monkeypatch, tmp_path):
    for k in ("CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN", "TOGETHER_API_KEY"):
        monkeypatch.delenv(k, raising=False)
    assert artgen.illustrate(Config(), story_script(), tmp_path) == 0
