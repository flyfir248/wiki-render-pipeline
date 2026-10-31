"""The scene director (fyt/director.py), the render inspection (fyt/inspect3d.py) and how they reach the
renderer: casting put right, acts and shots planned from the narration, one art profile per video, the
shots timed on their cue words, and two render scores kept apart."""
import re
from pathlib import Path

import numpy as np

from fyt import director, inspect3d, people, timeline, worldgen
from fyt.manifest import Entity, Manifest, Moment, Place
from fyt.models import Script, ScriptScene, Word

RENDERER = Path(__file__).resolve().parent.parent / "renderer" / "src" / "scenes" / "world" / "storyworld"

NARRATION = [
    "Behind the Lens: A space-suit figure looms behind a child in a 1964 marsh photo.",
    "The Photo: Jim Templeton snapped three pictures of his daughter, then saw a pale shape standing behind her when the film was developed.",
    "Story: In reality, his wife Annie walked into the shot, her blue dress overexposed as white, appearing as a vague silhouette.",
]
SOLWAY = Script(
    title="The Solway Firth Spaceman", description="D", tags=["a"], thumbnail_text="X", thumbnail_kicker="K", thumbnail_query="q", mood="curious",
    scenes=[ScriptScene(narration=t, type="statement", text="t") for t in NARRATION], sources=["https://example.com"],
)
STORY = Manifest(
    entities=[
        Entity(id="photographer", name="Jim Templeton", kind="person", search=["photographer"], look="middle-aged man, 1960s clothing", certain=True, scenes=[2]),
        Entity(id="daughter", name="Elizabeth Templeton", kind="person", search=["young girl"], look="five-year-old girl, short hair, 1960s dress", certain=True, scenes=[1, 2, 3]),
        Entity(id="wife", name="Annie Templeton", kind="person", search=["woman"], look="adult woman, blue dress appearing white", certain=True, scenes=[2, 3]),
        Entity(id="bluedress", name="blue dress", kind="object", search=["blue dress"], look="blue cotton dress", certain=True, scenes=[3]),
        Entity(id="camera", name="film camera", kind="object", search=["film camera"], look="1960s box camera, black metal body", certain=True, scenes=[2]),
    ],
    places=[Place(id="burghmarsh", name="Burgh Marsh", look="wetland marsh, reeds, flat horizon, overcast 1964 light", scenes=[1, 2, 3])],
    moments=[
        Moment(scene=2, entity="photographer", place="burghmarsh", action="snaps pictures of his daughter", motion="present", cue="snapped three pictures", documented=True),
        Moment(scene=3, entity="wife", place="burghmarsh", action="walks into the frame", motion="move", cue="walked into the shot", documented=True),
    ],
)


def _world():
    seed = worldgen._seed(SOLWAY.title)
    builds = {e.id: worldgen.rule_build(e, seed) for e in STORY.entities}
    settings = {p.id: worldgen.rule_setting(p) for p in STORY.places}
    builds, worn = director.fix_cast(builds, STORY)
    shots = {k: s for n, k in enumerate((1, 2, 3)) if (s := worldgen.rule_shot(SOLWAY, STORY, builds, k, n))}
    shots = director.drop_worn(shots, worn)
    return builds, settings, worn, shots


def test_a_person_is_always_built_as_a_person():
    # "Templeton" holds "temple": the photographer was built as a house
    assert worldgen.archetype_of(STORY.entities[0]) == "humanoid"


def test_the_marsh_is_a_marsh():
    assert worldgen.rule_setting(STORY.places[0]).kind == "marsh"


def test_a_garment_is_worn_by_the_person_it_belongs_to_in_its_colour():
    builds, _, worn, shots = _world()
    assert worn == {"bluedress": "wife"}
    assert builds["wife"].primary == worldgen.colours_in("blue")[0]
    assert builds["wife"].outfit.top == "dress"
    assert all(a.entity != "bluedress" for sh in shots.values() for a in sh.actors)


def test_a_child_is_drawn_as_a_child():
    builds, *_ = _world()
    assert builds["daughter"].body.age == "child" and builds["daughter"].size <= 1.2
    assert builds["wife"].body.age != "child"


def test_the_photographer_raises_the_camera_at_the_daughter_and_the_wife_is_revealed():
    builds, settings, worn, shots = _world()
    art = director.choose_art(SOLWAY, STORY)
    out, d = director.direct(SOLWAY, STORY, builds, settings, shots, art, worn)
    acts = d[2]["acts"]
    assert acts["photographer"]["gesture"] == "aim" and acts["photographer"]["prop"] == "camera" and acts["photographer"]["look"] == "daughter"
    jim = next(a for a in out[2].actors if a.entity == "photographer")
    assert jim.holding == "camera" and jim.verb not in ("walk", "run") and jim.face == "daughter"
    assert acts["wife"].get("revealed") and next(a for a in out[2].actors if a.entity == "wife").at == "back"
    assert acts["daughter"].get("child")
    # the wife wears her blue dress: her outfit is painted, the daughter's is not
    assert acts["wife"]["paint"] == builds["wife"].primary and "paint" not in acts["daughter"]
    moves = [s["move"] for s in d[2]["shots"]]
    assert "insert" in moves and moves.index("insert") > 0
    assert d[2]["recipe"]["wet"] > 0 and "reeds" in d[2]["recipe"]["fore"]
    assert d[2]["light"]["rig"] == "overcast"


def test_a_heading_is_not_an_action():
    assert director._gesture("The Photo: the rest of the story") is None or director._gesture("The Photo: the rest of the story")[0] != "aim"


def test_art_profile_is_one_per_video_and_the_setting_wins():
    assert director.choose_art(SOLWAY, STORY)["profile"] in ("cinematic", "noir")
    assert director.choose_art(SOLWAY, STORY, style="stencil")["profile"] == "stencil"
    for style in ("painterly", "cel", "clay", "noir"):
        assert director.choose_art(SOLWAY, STORY, style=style)["profile"] == style

    def told(title, *lines, mood="curious"):
        return Script(title=title, description="D", tags=["a"], thumbnail_text="X", thumbnail_kicker="K", thumbnail_query="q", mood=mood,
                      scenes=[ScriptScene(narration=t, type="statement", text="t") for t in lines], sources=["https://example.com"])

    # by itself: the cinematic 3D for most stories (a war story no longer goes to a stencil print),
    war = told("The Mother of All Bombs", "In 2017 a C-130 dropped the bomb on a tunnel complex during the war in Afghanistan.",
               "The regime's fighters were in the caves.", mood="tense")
    assert director.choose_art(war, None)["profile"] == "cinematic"
    # dark noir for crime and mysteries, painterly for a story long ago
    crime = told("The Unsolved Murder", "Police never found the murder weapon.", "The detective's suspect vanished before the trial.")
    assert director.choose_art(crime, None)["profile"] == "noir"
    assert director.choose_art(crime, None)["atmosphere"] == "dramatic"
    old = told("The Vasa", "In 1628 the warship Vasa sank in Stockholm harbour on her maiden voyage.")
    assert director.choose_art(old, None)["profile"] == "painterly"
    assert director.choose_art(SOLWAY, STORY, style="cinematic", strength=0.4)["strength"] == 0.4


def test_shots_and_acts_land_on_their_cue_words():
    words = [Word(word=w, start=i * 0.4, end=i * 0.4 + 0.3) for i, w in enumerate(NARRATION[1].split())]
    d = {"shots": [{"move": "push_in", "on": "photographer"}, {"move": "insert", "on": "photographer", "cue": "snapped"},
                   {"move": "reveal", "on": "wife", "cue": "saw"}, {"move": "reaction", "on": "daughter", "at": 0.97}],
         "acts": {"photographer": {"gesture": "aim", "cue": "snapped"}, "wife": {"revealed": True}}}
    out = timeline.timed_direction(d, words, 0.0, len(words) * 0.4)
    froms = [s["from"] for s in out["shots"]]
    assert froms[0] == 0 and froms == sorted(froms) and len(out["shots"]) == 3  # the last would hold under 1.6 seconds
    assert out["acts"]["photographer"]["from"] > 0 and out["acts"]["wife"]["from"] == 0


def test_every_move_and_profile_the_director_plans_is_drawn():
    index = (RENDERER / "index.tsx").read_text()
    for move in ("establish", "aerial", "track", "insert", "reveal", "reaction", "over_shoulder", "push_in"):
        assert f'"{move}"' in index, move
    art = (RENDERER / "artstyle.ts").read_text()
    for profile in director.PROFILES:
        assert re.search(rf"\b{profile}: {{ name", art), profile
    actions = (RENDERER / "actions.tsx").read_text()
    for gesture in ("aim", "point", "talk", "wave", "hold"):
        assert f'"{gesture}"' in actions, gesture


def test_library_people_face_where_they_walk(tmp_path, monkeypatch):
    # measured "auto", a person with arms out reads as facing sideways and walks crabwise
    outfits = people.outfits()
    if not outfits:
        return
    key = next(iter(outfits))
    monkeypatch.setattr(people, "outfit_for", lambda *a, **k: key)
    b = worldgen.rule_build(STORY.entities[0], 1)
    m = people.dress("a man", b, tmp_path)
    assert m and m["fit"]["forward"] == "+z"


def _texture(h=320, w=180, seed=1):
    r = np.random.default_rng(seed)
    base = r.random((-(-h // 8), -(-w // 8))) * 200
    return np.kron(base, np.ones((8, 8)))[:h, :w].astype(np.float32)


def test_richness_tells_a_bare_place_from_a_dressed_one():
    bare = np.full((320, 180), 120, np.float32)
    assert inspect3d.richness(bare)["score"] < 10
    assert inspect3d.richness(_texture())["score"] > 60


def test_animation_tells_a_camera_drift_from_something_acting():
    img = _texture(400, 260)
    drift = np.stack([img[40 + k: 360 + k, 40 + k: 220 + k] for k in range(16)])
    still = inspect3d.motion(np.stack([drift[0]] * 16))
    assert still["score"] < 10 and still["moving"] == 0
    cam = inspect3d.motion(drift)
    assert cam["camera"] > 0.5 and cam["moving"] < 0.3
    # a figure swaying back and forth a few pixels a step against the drifting place
    acting = drift.copy()
    figure = _texture(120, 60, seed=3)
    for k in range(len(acting)):
        x = 60 + int(round(5 * np.sin(k * 1.7)))
        acting[k, 80:200, x: x + 60] = figure
    act = inspect3d.motion(acting)
    assert act["moving"] > cam["moving"] and act["score"] > cam["score"]


def test_a_verdict_that_names_its_subject_does_not_drop_the_scene():
    from fyt.relevance import contradicts
    assert contradicts("The frame does not show a bear, it shows a 3D cartoon bear standing in a forest.", "a black bear")
    assert contradicts("The subject is not a Cessna, but a small plane", "a cessna, a light aircraft")
    assert not contradicts("it shows a dog, not a bear", "a bear")
    assert not contradicts("shows a house, not a person", "a photographer")


def test_a_retake_overrides_the_directors_shot_list():
    from fyt.relevance import retake
    scene = SOLWAY.scenes[1].model_copy(update={"type": "world", "subject_name": "photographer", "world": {
        "camera": "follow", "on": "photographer", "cast": [{"entity": "photographer"}],
        "direction": {"shots": [{"move": "follow", "on": "photographer"}, {"move": "reveal", "on": "wife"}]}}})
    again = retake(scene)
    assert again.world["direction"]["shots"] == [{"move": "push_in", "on": "photographer"}]
