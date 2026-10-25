from fyt import llm, localize, youtube
from fyt.config import Config
from fyt.models import Script


def _script(description="Story.\n\nChapters:\n0:00 Start\n1:10 End"):
    return Script(title="T", description=description, tags=[], thumbnail_text="", thumbnail_kicker="",
                  thumbnail_query="", scenes=[], sources=["https://en.wikipedia.org/wiki/X"])  # fmt: skip


def test_translate_keeps_chapters_only_when_every_time_survives(monkeypatch):
    answers = {
        "Spanish": localize.Translation(title="El <título>", description="Historia.\n\nCapítulos:\n0:00 Inicio\n1:10 Fin"),
        "Hindi": localize.Translation(title="शीर्षक", description="कहानी\n0:00 शुरू\n1:15 अंत"),
    }
    monkeypatch.setattr(llm, "structured", lambda cfg, guide, user, schema, max_tokens, quick: answers[user.split()[2].rstrip(".")])
    out = localize.translate(Config(), _script(), ["es", "hi", "en"], log=lambda m: None)
    assert out["es"] == {"title": "El título", "description": "Historia.\n\nCapítulos:\n0:00 Inicio\n1:10 Fin"}
    assert out["hi"]["description"] == "कहानी"  # a changed time would make wrong chapters
    assert "en" not in out


def test_translate_skips_a_language_that_fails(monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("rate limited")

    monkeypatch.setattr(llm, "structured", boom)
    assert localize.translate(Config(), _script(), ["es"], log=lambda m: None) == {}


def test_localizations_get_the_same_footer():
    cfg = Config(format="short")
    out = youtube.localized(cfg, _script(), {"es": {"title": "Título", "description": "Historia."}})
    assert out["es"]["description"].startswith("Historia.\n\nSources:\n- https://en.wikipedia.org/wiki/X")
    assert out["es"]["description"].endswith("#Shorts")


def test_credit_lines_are_kept_as_they_are_and_not_sent(monkeypatch):
    sent = []

    def answer(cfg, guide, user, schema, max_tokens, quick):
        sent.append(user)
        assert quick  # an extra: never waits on a rate limit
        return localize.Translation(title="Título", description="Historia.")

    monkeypatch.setattr(llm, "structured", answer)
    credits = "3D models:\n- Ship by someone (CC BY 4.0) https://sketchfab.com/3d-models/ship"
    out = localize.translate(Config(), _script(f"Story.\n\n{credits}"), ["es"], log=lambda m: None)
    assert "sketchfab" not in sent[0]
    assert out["es"]["description"] == f"Historia.\n\n{credits}"
