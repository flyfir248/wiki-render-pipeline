import pytest

from fyt import factcheck, pipeline
from fyt.config import Config
from fyt.factcheck import Claim, FactCheck, SceneFacts
from fyt.models import DataPoint, Script, ScriptScene

NOTES = """# Krakatoa
Source: https://en.wikipedia.org/wiki/1883_eruption_of_Krakatoa

The 1883 eruption of Krakatoa in the Sunda Strait was one of the deadliest volcanic events in recorded history.

The eruption destroyed over 70% of the island of Krakatoa and its surrounding archipelago.

At least 36,417 deaths are attributed to the eruption and the tsunamis it created.

The sound was heard on Rodrigues, near Mauritius, about 4,800 km away.

Unrelated paragraph about the island's ferns and birds returning years later."""


def script() -> Script:
    return Script(
        title="The Volcano Heard 4,800 km Away",
        description="D",
        tags=["a"],
        thumbnail_text="Heard across an ocean",
        thumbnail_kicker="K",
        thumbnail_query="q",
        scenes=[
            ScriptScene(narration="It was heard four thousand eight hundred kilometres away.", type="title", heading="Heard"),
            ScriptScene(
                narration="About two thirds of the island collapsed into the sea.",
                type="proportion", heading="Krakatoa island", value=67, text="of the island collapsed",
            ),
            ScriptScene(
                narration="The tsunamis killed at least thirty six thousand people.",
                type="stat", heading="Lives lost", value=36417,
            ),
        ],
        sources=["https://example.com"],
    )


def test_evidence_picks_passages_that_share_figures_and_words():
    chunks = factcheck.passages(NOTES)
    picked = factcheck.evidence("Lives lost 36417 tsunamis killed", chunks, budget=400)
    assert "36,417" in picked
    assert "ferns" not in picked


def test_evidence_stays_within_budget():
    chunks = factcheck.passages(NOTES)
    assert len(factcheck.evidence("Krakatoa island eruption 36417 Rodrigues 70", chunks, budget=200)) <= 200 + 4


def test_long_paragraphs_are_split():
    parts = factcheck.passages("A sentence here. " * 100, size=300)
    assert len(parts) > 3 and all(len(p) <= 300 for p in parts)


def test_scene_facts_leaves_out_unset_and_layout_fields():
    sc = ScriptScene(narration="n", type="bars", data=[DataPoint(label="a", value=1)], camera="push_in")
    assert factcheck.scene_facts(sc) == {"narration": "n", "data": [{"label": "a", "value": 1.0}]}


def test_verify_fixes_wrong_scene_and_rechecks(monkeypatch):
    checks = []

    def fake(cfg, system, user, schema, max_tokens=3000):
        assert cfg.llm.temperature <= 0.2
        if schema is FactCheck:
            checks.append(user)
            if len(checks) == 1:
                return FactCheck(claims=[
                    Claim(scene=2, claim="two thirds of the island collapsed", verdict="wrong", correction="over 70%"),
                    Claim(scene=3, claim="thirty six thousand", verdict="supported"),
                ])
            assert "Scene 3" not in user and "Scene 2" in user  # only the fixed scene is re-checked
            return FactCheck(claims=[])
        assert schema is SceneFacts
        return SceneFacts(narration="More than seventy percent of the island collapsed into the sea.",
                          heading="Krakatoa island", value=70, text="of the island collapsed", camera="x")

    monkeypatch.setattr(factcheck.llm, "structured", fake)
    fixed, problems = factcheck.verify(Config(), script(), NOTES, log=lambda m: None)
    assert problems == []
    assert fixed.scenes[1].value == 70 and "seventy" in fixed.scenes[1].narration
    assert fixed.scenes[2] == script().scenes[2]
    assert "over 70%" in checks[0]  # the passage that settles it was sent


def test_verify_reports_claims_that_stay_wrong(monkeypatch):
    def fake(cfg, system, user, schema, max_tokens=3000):
        if schema is FactCheck:
            return FactCheck(claims=[Claim(scene=2, claim="two thirds", verdict="wrong", correction="over 70%")])
        return SceneFacts(narration="Still two thirds.", heading="Krakatoa island", value=67, text="t")

    monkeypatch.setattr(factcheck.llm, "structured", fake)
    _, problems = factcheck.verify(Config(), script(), NOTES, log=lambda m: None)
    assert problems and "two thirds" in problems[0]


def test_a_fix_that_fails_leaves_the_scene_flagged_rather_than_stopping_the_check(monkeypatch):
    def fake(cfg, system, user, schema, max_tokens=3000):
        if schema is FactCheck:
            return FactCheck(claims=[Claim(scene=2, claim="two thirds", verdict="wrong", correction="over 70%")])
        return SceneFacts(narration=" ", heading="Krakatoa island", value=67, text="t")  # nothing left to say

    monkeypatch.setattr(factcheck.llm, "structured", fake)
    fixed, problems = factcheck.verify(Config(), script(), NOTES, log=lambda m: None)
    assert problems == ['scene 2: wrong claim "two thirds" (source says: over 70%)']
    assert fixed.scenes[1] == script().scenes[1]


def test_title_claims_are_fixed(monkeypatch):
    def fake(cfg, system, user, schema, max_tokens=3000):
        if schema is FactCheck:
            if "Scene 0" in user and "9,000" in user:
                return FactCheck(claims=[Claim(scene=0, claim="9,000 km", verdict="wrong", correction="4,800 km")])
            return FactCheck(claims=[])
        return factcheck.TitleFacts(title="The Volcano Heard 4,800 km Away", thumbnail_text="Heard across an ocean")

    monkeypatch.setattr(factcheck.llm, "structured", fake)
    s = script().model_copy(update={"title": "The Volcano Heard 9,000 km Away"})
    fixed, problems = factcheck.verify(Config(), s, NOTES, log=lambda m: None)
    assert problems == [] and "4,800" in fixed.title


class FakeJob:
    def __init__(self, tmp_path):
        self.dir, self.state, self.id = tmp_path, {}, "job"

    def file(self, name):
        return self.dir / name

    def update(self, **kw):
        self.state.update(kw)


def test_pipeline_stops_a_script_that_fails(monkeypatch, tmp_path):
    monkeypatch.setattr(pipeline, "log", lambda job, msg: None)
    monkeypatch.setattr(factcheck, "verify", lambda cfg, s, notes, log: (s, ["scene 2: wrong claim"]))
    job = FakeJob(tmp_path)
    with pytest.raises(RuntimeError, match="fact check"):
        pipeline.check_facts(Config(), job, script(), NOTES)
    assert job.state["status"] == "qa_failed"


def test_pipeline_stops_when_the_check_cannot_run(monkeypatch, tmp_path):
    monkeypatch.setattr(pipeline, "log", lambda job, msg: None)

    def down(*a, **k):
        raise ConnectionError("provider down")

    monkeypatch.setattr(factcheck, "verify", down)
    with pytest.raises(RuntimeError, match="could not run"):
        pipeline.check_facts(Config(), FakeJob(tmp_path), script(), NOTES)


def test_pipeline_skips_without_notes_or_when_off(monkeypatch, tmp_path):
    monkeypatch.setattr(factcheck, "verify", lambda *a, **k: pytest.fail("should not check"))
    s = script()
    assert pipeline.check_facts(Config(), FakeJob(tmp_path), s, "") is s
    assert pipeline.check_facts(Config(fact_check=False), FakeJob(tmp_path), s, NOTES) is s


def test_a_scene_the_source_does_not_back_is_cut_rather_than_losing_the_video(monkeypatch, tmp_path):
    # Mary Celeste: one unsupported line in scene 9 of 10 stopped the whole video.
    monkeypatch.setattr(pipeline, "log", lambda job, msg: None)
    long = script().model_copy(update={"scenes": [ScriptScene(narration=f"Line {i}.", type="statement", text="t") for i in range(1, 11)]})
    monkeypatch.setattr(factcheck, "verify", lambda cfg, s, notes, log: (s, ['scene 9: unsupported claim "x"']))
    out = pipeline.check_facts(Config(), FakeJob(tmp_path), long, NOTES)
    assert [s.narration for s in out.scenes] == [f"Line {i}." for i in range(1, 11) if i != 9]
    for problems in (['scene 1: wrong claim'], ['the title: wrong'], ['scene 2: x', 'scene 3: x', 'scene 4: x']):
        monkeypatch.setattr(factcheck, "verify", lambda cfg, s, notes, log, p=problems: (s, p))
        with pytest.raises(RuntimeError, match="fact check"):
            pipeline.check_facts(Config(), FakeJob(tmp_path), long, NOTES)
