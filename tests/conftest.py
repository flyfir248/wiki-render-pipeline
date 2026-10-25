import pytest

from fyt import factcheck


@pytest.fixture(autouse=True)
def facts_check_out(request, monkeypatch):
    """Pipeline tests fake the scriptwriter, not the fact checker: let their scripts pass the check.
    tests/test_factcheck.py tests the real one."""
    if request.module.__name__.endswith("test_factcheck"):
        return
    monkeypatch.setattr(factcheck, "verify", lambda cfg, script, notes, log=print: (script, []))


@pytest.fixture(autouse=True)
def plan_without_a_model(request, monkeypatch):
    """Pipeline tests plan visuals with the rule-based planner (no model call); test_visualplan tests both."""
    if request.module.__name__.endswith("test_visualplan"):
        return
    from fyt import visualplan

    def offline(*a, **k):
        raise RuntimeError("no model in tests")

    monkeypatch.setattr(visualplan, "_llm_plan", offline)


@pytest.fixture(autouse=True)
def only_commons_is_searched(request, monkeypatch):
    """Pipeline tests fake Commons search; the other free image sources stay offline (test_freeimages
    tests them)."""
    if request.module.__name__.endswith("test_freeimages"):
        return
    from fyt import freeimages

    for name in ("openverse", "loc", "nasa"):
        monkeypatch.setitem(freeimages.SOURCES, name, lambda q, n: [])
