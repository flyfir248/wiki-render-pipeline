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


def test_long_sentences_are_told_in_two_pictures():
    long = "On January 15, 1919, a giant tank of molasses burst in Boston's North End, sending a wave down the street."
    assert storyboard.parts(long + " It killed 21.") == [
        "On January 15, 1919, a giant tank of molasses burst in Boston's North End,",
        "sending a wave down the street.",
        "It killed 21.",
    ]
    assert storyboard.parts("A short one, with a comma.") == ["A short one, with a comma."]


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
    monkeypatch.setattr(artgen, "generate", lambda p, vertical=False, seed=7, **kw: prompts.append(p) or Image.new("RGB", (8, 8)))
    board = storyboard.Board(
        cast=[storyboard.CastMember(name="the tank", look="a riveted steel tank, rust streaks")],
        beats=[
            storyboard.Beat(scene=1, sentence=2, subject="a brown wave", picture="Brown wave sweeping a cobbled street", cast=["the tank"]),
            storyboard.Beat(scene=4, sentence=1, picture="Crowds staring at a burst tank"),
            storyboard.Beat(scene=4, sentence=2, picture="A woman sniffing the air on a hot street"),
        ],
    )
    monkeypatch.setattr(storyboard, "plan", lambda cfg, script, todo, known=None: board)
    verdicts = iter([storyboard.Verdict(matches=False, problems="blood on the street"), storyboard.Verdict(matches=True), None, None])
    meant = []
    monkeypatch.setattr(storyboard, "review", lambda cfg, path, m: meant.append(m) or next(verdicts))
    words = [[Word(word=w, start=0.3 * n, end=0.3 * n + 0.2) for n, w in enumerate(sc.narration.split())] for sc in s.scenes]
    spans = [(0.0, 4.0), (4.1, 6.0), (6.1, 9.0), (9.1, 12.0)]
    beats = storyboard.make(Config(format="short"), s, spans, words, tmp_path, log=lambda m: None)
    assert [b.src for b in beats[0]] == ["art/beat-1-2.jpg"] and beats[0][0].at == 1.8  # "It" is word 7
    assert [b.at for b in beats[3]] == [0.0, 0.9]  # the first opens the scene; the next from the scene's start
    assert "a riveted steel tank" in prompts[0] and artgen.SCENE_STYLE in prompts[0]
    assert storyboard.CALM in prompts[1] and "blood on the street" not in prompts[1]  # drawn again, more gently
    assert len(prompts) == 4
    assert meant[0] == "a brown wave"  # the check judges the subject, not every detail of the picture
    props = build_props(Config(format="short"), s, spans, words, {}, None, None, None, None, beats)
    assert props.scenes[0].beats[0].src == "art/beat-1-2.jpg" and props.scenes[1].beats is None


def test_no_image_provider_means_no_storyboard(monkeypatch, tmp_path):
    monkeypatch.setattr(artgen, "provider", lambda: None)
    assert storyboard.make(Config(format="short"), _script(), [(0, 1)] * 4, [[]] * 4, tmp_path) == {}


def test_story_scenes_move_on_after_their_first_sentence():
    s = _script()
    s.scenes[2].type = "story"
    assert (2, 1) in [(i, k) for i, k, _ in storyboard.wanted(s)] and (2, 0) not in [(i, k) for i, k, _ in storyboard.wanted(s)]


def test_verdict_reads_text_or_parsed_json():
    assert storyboard._verdict('Sure: {"matches": false, "problems": "extra arm"}').problems == "extra arm"
    assert storyboard._verdict({"matches": True, "problems": ""}).matches is True


def test_story_scene_pictures_count_against_the_budget_and_an_empty_allowance_stops_drawing(monkeypatch, tmp_path):
    s = _script()
    monkeypatch.setattr(artgen, "provider", lambda: "cloudflare")
    monkeypatch.setattr(storyboard, "plan", lambda cfg, script, todo, known=None: storyboard.Board())
    monkeypatch.setattr(storyboard, "review", lambda cfg, path, meant: None)
    calls = []
    monkeypatch.setattr(artgen, "generate", lambda p, vertical=False, seed=7, **kw: calls.append(p) or Image.new("RGB", (8, 8)))
    spans = [(0.0, 4.0), (4.1, 6.0), (6.1, 9.0), (9.1, 12.0)]
    beats = storyboard.make(Config(format="short"), s, spans, [[]] * 4, tmp_path, log=lambda m: None, drawn=artgen.ART_PER_SHORT - 1)
    assert len(calls) == 1 and sum(len(v) for v in beats.values()) == 1
    monkeypatch.setattr(artgen, "_spent", True)
    assert storyboard.make(Config(format="short"), s, spans, [[]] * 4, tmp_path, log=lambda m: None) == {}


def test_a_recurring_subject_is_drawn_from_its_first_picture_and_each_shot_keeps_its_direction(monkeypatch, tmp_path):
    s = _script()
    monkeypatch.setattr(artgen, "provider", lambda: "cloudflare")
    calls = []
    monkeypatch.setattr(artgen, "generate", lambda p, vertical=False, seed=7, refs=None, **kw: calls.append((p, refs)) or Image.new("RGB", (9, 16)))
    board = storyboard.Board(
        cast=[storyboard.CastMember(name="the tank", look="a riveted steel tank")],
        beats=[
            storyboard.Beat(scene=1, sentence=2, picture="The tank towering over a street", cast=["the tank"], camera="rise"),
            storyboard.Beat(scene=4, sentence=1, picture="The burst tank at dawn", cast=["the tank"], camera="pull_out", effect="fog"),
            storyboard.Beat(scene=4, sentence=2, picture="A hot street"),
        ],
    )
    monkeypatch.setattr(storyboard, "plan", lambda cfg, script, todo, known=None: board)
    monkeypatch.setattr(storyboard, "review", lambda cfg, path, m: None)
    words = [[Word(word=w, start=0.3 * n, end=0.3 * n + 0.2) for n, w in enumerate(sc.narration.split())] for sc in s.scenes]
    beats = storyboard.make(Config(format="short"), s, [(0.0, 4.0), (4.1, 6.0), (6.1, 9.0), (9.1, 12.0)], words, tmp_path, log=lambda m: None)
    assert calls[0][1] == [] and calls[2][1] == []
    assert calls[1][1] == [tmp_path / "art/beat-1-2.jpg"] and "the tank looks exactly as in image 0" in calls[1][0]
    assert (beats[0][0].camera, beats[3][0].camera, beats[3][0].effect) == ("rise", "pull_out", "fog")
    assert beats[0][0].aspect == round(9 / 16, 4)


def test_a_painted_video_paints_story_scenes_from_their_first_sentence():
    s = _script()
    s.scenes[3] = s.scenes[3].model_copy(update={"type": "story"})
    assert (3, 0) not in [(i, k) for i, k, _ in storyboard.wanted(s)]
    assert (3, 0) in [(i, k) for i, k, _ in storyboard.wanted(s, painted=True)]
