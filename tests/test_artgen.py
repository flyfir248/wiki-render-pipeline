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
    monkeypatch.setattr(artgen, "generate", lambda p, vertical=False, seed=0, **kw: prompts.append(p) or drawing(p))
    s = story_script()
    assert artgen.illustrate(Config(format="short"), s, tmp_path) == 3
    scene = s.scenes[0]
    assert scene.backdrop_src.startswith("art/plate-") and (tmp_path / scene.backdrop_src).exists()
    prop = Image.open(tmp_path / scene.actors[0].src)
    assert prop.mode == "RGBA" and prop.getpixel((0, 0))[3] == 0  # the white around it is gone
    assert "A single grey 1970 navy recovery ship" in prompts[1] and "never a real person's likeness" in prompts[1]
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


class _Resp:
    def __init__(self, status, payload=None, text=""):
        self.status_code, self._payload, self.text = status, payload, text
        self.ok = status < 400

    def json(self):
        return self._payload


def _png_b64(size=(4, 7)):
    import base64
    import io

    out = io.BytesIO()
    Image.new("RGB", size).save(out, "PNG")
    return base64.b64encode(out.getvalue()).decode()


def test_cloudflare_draws_a_short_tall_with_references_and_falls_back_to_square(monkeypatch, tmp_path):
    monkeypatch.setenv("CLOUDFLARE_ACCOUNT_ID", "acc")
    monkeypatch.setenv("CLOUDFLARE_API_TOKEN", "tok")
    monkeypatch.setattr(artgen, "_klein_ok", True)
    ref = tmp_path / "ref.jpg"
    Image.new("RGB", (900, 1600)).save(ref)
    sent = []

    def post(url, headers=None, files=None, json=None, timeout=None):
        sent.append((url, files, json))
        return _Resp(200, {"result": {"image": _png_b64()}})

    monkeypatch.setattr(artgen.requests, "post", post)
    artgen.generate("a ship", vertical=True, refs=[ref])
    url, files, _ = sent[0]
    assert url.endswith(artgen.KLEIN) and files["width"][1] == "768" and files["height"][1] == "1344"
    assert files["input_image_0"][2] == "image/jpeg" and max(Image.open(__import__("io").BytesIO(files["input_image_0"][1])).size) <= 448

    sent.clear()
    replies = iter([_Resp(400, text="bad input"), _Resp(200, {"result": {"image": _png_b64()}})])
    monkeypatch.setattr(artgen.requests, "post", lambda url, **kw: sent.append(url) or next(replies))
    artgen.generate("a ship", vertical=True)
    assert sent[0].endswith(artgen.KLEIN) and sent[1].endswith(artgen.SCHNELL) and artgen._klein_ok is False
