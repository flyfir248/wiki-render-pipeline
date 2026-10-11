import pytest
from PIL import Image

from fyt import artgen, storyboard
from fyt.config import Config
from fyt.models import Script, Word
from fyt.timeline import build_props


def _script() -> Script:
    return Script.model_validate(
        {
            "title": "The Molasses Flood", "description": "d", "tags": [], "thumbnail_text": "x",
            "thumbnail_kicker": "y", "thumbnail_query": "z", "sources": [],
            "scenes": [
                {"narration": "A wave of syrup hit Boston. It moved at 35 miles an hour.", "type": "title", "heading": "Syrup wave"},
                {"narration": "The tank held 8.7 million litres.", "type": "stat", "value": 8.7},
                {"narration": "It ran down Commercial Street. Then it reached the harbour.", "type": "map",
                 "places": [{"name": "Boston", "lat": 42.36, "lon": -71.05}]},
                {"narration": "Nobody expected it. Some people still smell it on hot days!", "type": "statement", "text": "t"},
            ],
        }
    )


def test_sentences_split_on_full_stops_but_not_decimals():
    assert storyboard.sentences("It held 8.7 million litres. Then it burst! Why?") == ["It held 8.7 million litres.", "Then it burst!", "Why?"]


def test_later_sentences_of_picture_scenes_are_illustrated():
    todo = storyboard.wanted(_script())
    # The opening and the number keep their own graphic for the first sentence; a statement is only
    # words, so its first sentence gets a picture too; maps draw their own picture.
    assert [(i, k) for i, k, _ in todo] == [(0, 1), (3, 0), (3, 1)]


def test_sentence_starts_follow_the_voice():
    words = [Word(word=w, start=0.4 * n, end=0.4 * n + 0.3) for n, w in enumerate("One two three. Four five.".split())]
    assert storyboard.sentence_starts("One two three. Four five.", words, 2.0) == pytest.approx([0.0, 1.2])
    assert storyboard.sentence_starts("One two three. Four five.", [], 2.0) == pytest.approx([0.0, 1.2])  # an even pace


def test_make_draws_checks_and_times_each_beat(monkeypatch, tmp_path):
    s = _script()
    monkeypatch.setattr(artgen, "provider", lambda: "cloudflare")
    prompts = []
    monkeypatch.setattr(artgen, "generate", lambda p, vertical=False, seed=7: prompts.append(p) or Image.new("RGB", (8, 8)))
    board = storyboard.Board(
        cast=[storyboard.CastMember(name="the tank", look="a riveted steel tank, rust streaks")],
        beats=[
            storyboard.Beat(scene=1, sentence=2, picture="Brown wave sweeping a cobbled street", cast=["the tank"]),
            storyboard.Beat(scene=4, sentence=1, picture="Crowds staring at a burst tank"),
            storyboard.Beat(scene=4, sentence=2, picture="A woman sniffing the air on a hot street"),
        ],
    )
    monkeypatch.setattr(storyboard, "plan", lambda cfg, script, todo: board)
    verdicts = iter([storyboard.Verdict(matches=False, problems="garbled sign"), storyboard.Verdict(matches=True), None, None])
    monkeypatch.setattr(storyboard, "review", lambda cfg, path, meant: next(verdicts))
    words = [[Word(word=w, start=0.3 * n, end=0.3 * n + 0.2) for n, w in enumerate(sc.narration.split())] for sc in s.scenes]
    spans = [(0.0, 4.0), (4.1, 6.0), (6.1, 9.0), (9.1, 12.0)]
    beats = storyboard.make(Config(format="short"), s, spans, words, tmp_path, log=lambda m: None)
    assert [b.src for b in beats[0]] == ["art/beat-1-2.jpg"] and beats[0][0].at == 1.8  # "It" is word 7
    assert [b.at for b in beats[3]] == [0.0, 0.9]  # the first opens the scene; the next from the scene's start
    assert "a riveted steel tank" in prompts[0] and artgen.SCENE_STYLE in prompts[0]
    assert "Avoid: garbled sign." in prompts[1]  # the failed picture is drawn again
    assert len(prompts) == 4
    props = build_props(Config(format="short"), s, spans, words, {}, None, None, None, None, beats)
    assert props.scenes[0].beats[0].src == "art/beat-1-2.jpg" and props.scenes[1].beats is None


def test_no_image_provider_means_no_storyboard(monkeypatch, tmp_path):
    monkeypatch.setattr(artgen, "provider", lambda: None)
    assert storyboard.make(Config(format="short"), _script(), [(0, 1)] * 4, [[]] * 4, tmp_path) == {}
