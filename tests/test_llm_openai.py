import json
import json as _json

import pytest

from fyt import llm
from fyt.config import Config, LLMConfig

SCRIPT = {
    "title": "The Queen Who Lost Three Kingdoms",
    "description": "Mary's story.",
    "tags": ["history"],
    "thumbnail_text": "Lost it all",
    "thumbnail_kicker": "Mary",
    "thumbnail_query": "castle",
    "scenes": [{"narration": "She was queen at six days old.", "type": "title", "heading": "Queen at 6 days"}],
    "sources": [],
}


class Resp:
    def __init__(self, status, body=None, headers=None):
        self.status_code, self.body, self.headers, self.text = status, body, headers or {}, json.dumps(body)

    def json(self):
        return self.body


def reply(content):
    return Resp(200, {"choices": [{"message": {"content": content}}]})


@pytest.fixture
def cfg(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "test")
    monkeypatch.setattr(llm.time, "sleep", lambda s: None)
    return Config(format="short", llm=LLMConfig(provider="openai"))


def test_openai_script_retries_on_bad_json_and_rate_limit(cfg, monkeypatch):
    calls = []
    answers = [Resp(429, {}, {"retry-after": "1"}), reply('{"title": "missing fields"}'), reply(json.dumps(SCRIPT))]

    def post(url, headers, json, timeout):
        assert url == "https://api.groq.com/openai/v1/chat/completions"
        assert headers["Authorization"] == "Bearer test"
        assert json["response_format"] == {"type": "json_object"}
        calls.append(json["messages"])
        return answers.pop(0)

    monkeypatch.setattr(llm.requests, "post", post)
    script = llm.write_script(cfg, "Mary, Queen of Scots", "x" * 50000, from_wikipedia=True)
    assert script.title == SCRIPT["title"]
    assert "never copy" in calls[0][0]["content"].lower()  # Wikipedia rules in the system prompt
    assert len(calls[0][1]["content"]) < 7000  # notes trimmed for free-tier limits
    assert "did not match the schema" in calls[-1][-1]["content"]
    assert len(calls[-1]) == 2  # retries don't resend the rejected reply


def test_openai_retries_when_groq_rejects_invalid_json(cfg, monkeypatch):
    bodies = []
    rejected = Resp(400, {"error": {"code": "json_validate_failed", "failed_generation": "max completion tokens reached"}})
    answers = [rejected, reply(json.dumps(SCRIPT))]

    def post(url, headers, json, timeout):
        bodies.append(json)
        return answers.pop(0)

    monkeypatch.setattr(llm.requests, "post", post)
    script = llm.write_script(cfg, "Darth Vader in Ukrainian politics", "x" * 5000, from_wikipedia=True)
    assert script.title == SCRIPT["title"]
    assert bodies[0]["reasoning_effort"] == "low"  # leaves gpt-oss room to finish the JSON
    assert len(bodies) == 2


def test_openai_needs_key(cfg, monkeypatch):
    monkeypatch.delenv("GROQ_API_KEY")
    with pytest.raises(llm.ClaudeError, match="GROQ_API_KEY"):
        llm.write_script(cfg, "t", "notes")


def test_openai_script_shrinks_notes_when_request_too_large(cfg, monkeypatch):
    sizes = []
    answers = [Resp(413, {"error": {"message": "Request too large"}}), reply(json.dumps(SCRIPT))]

    def post(url, headers, json, timeout):
        assert json["max_tokens"] <= 3000
        sizes.append(len(json["messages"][1]["content"]))
        return answers.pop(0)

    monkeypatch.setattr(llm.requests, "post", post)
    script = llm.write_script(cfg, "Mount Rushmore", "x" * 50000, from_wikipedia=True)
    assert script.title == SCRIPT["title"]
    assert sizes[1] < sizes[0] - 2000  # second try sent half the notes


def test_openai_script_tries_a_fallback_model_when_still_too_large(cfg, monkeypatch):
    # The scheduled run of 17 October failed this way: gpt-oss-120b's 8,000 tokens a minute couldn't
    # hold the prompt even with the shortest notes, and the fallback models were never tried.
    models = []
    cfg = cfg.model_copy(update={"llm": cfg.llm.model_copy(update={"fallback_models": ["llama-3.3-70b-versatile"]})})

    def post(url, headers, json, timeout):
        models.append(json["model"])
        if json["model"] == cfg.llm.model:
            return Resp(413, {"error": {"message": "Request too large"}})
        return reply(_json.dumps(SCRIPT))

    monkeypatch.setattr(llm.requests, "post", post)
    script = llm.write_script(cfg, "Mount Rushmore", "x" * 50000, from_wikipedia=True)
    assert script.title == SCRIPT["title"]
    assert models.count(cfg.llm.model) == 4 and models[-1] == cfg.llm.fallback_models[0]


def test_the_schema_sent_carries_no_field_titles():
    from fyt.models import Script

    schema = llm._compact(Script.model_json_schema())
    assert "title" in schema["properties"]  # the script's own title field stays
    assert '"title":"Narration"' not in _json.dumps(schema, separators=(",", ":"))


def test_split_notes_covers_the_article_in_order():
    notes = "\n".join(f"paragraph {i} " + "x" * 90 for i in range(100))
    chunks = llm.split_notes(notes, 4, 6000)
    assert len(chunks) == 4
    assert chunks[0].startswith("paragraph 0") and "paragraph 99" in chunks[-1]
    assert all(len(c) <= 6000 for c in chunks)
    assert all(c.startswith("paragraph") for c in chunks)  # cut at line breaks


def test_long_script_is_written_chapter_by_chapter(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "test")
    cfg = Config(format="long", target_minutes=4, long_min_minutes=0, llm=LLMConfig(provider="openai"))
    n = llm.chapter_count(cfg)
    outline = {k: v for k, v in SCRIPT.items() if k != "scenes"}
    outline["cold_open"] = "The ice gave way under the sledge."
    outline["chapters"] = [{"heading": f"Part {i}", "angle": "why", "turn": f"twist {i}", "cliffhanger": f"question {i}?"} for i in range(1, n + 1)]
    answers = [reply(json.dumps(outline))] + [
        reply(json.dumps({"scenes": [{"narration": f"Chapter {i} line.", "type": "statement", "image": i}]}))
        for i in range(1, n + 1)
    ]
    prompts = []

    def post(url, headers, json, timeout):
        assert json["max_tokens"] <= 3000  # each request fits Groq's free per-minute limit
        if "words too short" in json["messages"][1]["content"]:
            return reply('{"scenes": []}')  # the one-line chapters get a request to lengthen them
        prompts.append(json["messages"][1]["content"])
        return answers.pop(0)

    monkeypatch.setattr(llm.requests, "post", post)
    notes = "\n".join(f"fact {i} " + "y" * 200 for i in range(200))
    script = llm.write_script(cfg, "Mary", notes, from_wikipedia=True, images="1. a\n2. b")
    assert len(prompts) == n + 1
    assert all(len(p) < 9000 for p in prompts)
    assert [s.narration for s in script.scenes] == [f"Chapter {i} line." for i in range(1, n + 1)]
    assert [(c.title, c.scene) for c in script.chapters] == [(f"Part {i}", i - 1) for i in range(1, n + 1)]
    assert "Chapter 1 line." in prompts[2]  # the next chapter continues from the last one
    # The outline's cold open, turns and cliffhangers reach every chapter, so the open loops line up.
    assert all("Cold open: The ice gave way" in p and "Ends on: question 1?" in p for p in prompts[1:])
    assert "end on the open question: question 1?" in prompts[1] and "twist 2" in prompts[2]
    assert "return to the cold open" in prompts[-1] and "end on the open question" not in prompts[-1]
    assert "Images already used (don't reuse): 1" in prompts[2]
    assert "fact 0 " in prompts[1] and "fact 0 " not in prompts[-1]  # each chapter gets its own part of the notes
    assert "fact 140" in prompts[-1] and "fact 140" not in prompts[1]


def test_falls_back_to_the_next_model_when_one_keeps_failing(cfg, monkeypatch):
    cfg.llm.fallback_models = ["llama-3.3-70b-versatile"]
    models = []
    cfg = cfg.model_copy(update={"llm": cfg.llm.model_copy(update={"fallback_models": ["llama-3.3-70b-versatile"]})})

    def post(url, headers, json, timeout):
        models.append(json["model"])
        if json["model"] == cfg.llm.model:
            return Resp(503, {"error": "over capacity"})
        return reply(__import__("json").dumps(SCRIPT))

    monkeypatch.setattr(llm.requests, "post", post)
    script = llm.write_script(cfg, "Mary", "notes")
    assert script.title == SCRIPT["title"]
    assert models[-1] == "llama-3.3-70b-versatile" and models.count(cfg.llm.model) == 8


def test_short_scripts_are_built_around_one_message(cfg, monkeypatch):
    seen = []

    def post(url, headers, json, timeout):
        seen.append(json["messages"][0]["content"])
        return reply(_json.dumps({**SCRIPT, "core_message": "A baby became queen and lost it all."}))

    monkeypatch.setattr(llm.requests, "post", post)
    script = llm.write_script(cfg, "Mary, Queen of Scots", "notes")
    assert script.core_message.startswith("A baby")
    system = seen[0]
    assert "core_message" in system and "Hook (scene 1, max 12 words)" in system
    assert "inviting viewers to subscribe" not in system  # a Short ends on its payoff and loops
    # The schema asks for the message before anything else, so the model commits to it first.
    assert list(llm.Script.model_json_schema()["properties"])[0] == "core_message"


def test_long_scripts_keep_the_subscribe_close():
    assert "inviting viewers to subscribe" in llm.LONG_STRUCTURE and "Short" not in llm.LONG_STRUCTURE
    assert "Cold open" in llm.LONG_STRUCTURE and "Midpoint turn" in llm.LONG_STRUCTURE


def test_long_videos_aim_past_the_mid_roll_minimum():
    assert llm.long_words(Config(format="long", target_minutes=6)) == int(8.5 * llm.LONG_WPM)
    assert llm.long_words(Config(format="long", target_minutes=10)) == 10 * llm.LONG_WPM
    assert llm.long_words(Config(format="long", target_minutes=6, long_min_minutes=0)) == 6 * llm.LONG_WPM


def test_a_short_chapter_is_lengthened(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "test")
    cfg = Config(format="long", target_minutes=3, long_min_minutes=0, llm=LLMConfig(provider="openai"))
    n = llm.chapter_count(cfg)
    words = int(llm.long_words(cfg) / n)
    outline = {k: v for k, v in SCRIPT.items() if k != "scenes"}
    outline["chapters"] = [{"heading": f"Part {i}", "angle": "why"} for i in range(1, n + 1)]
    full = " ".join(["word"] * words)
    first = [{"narration": "Too short.", "type": "statement"}, {"narration": "What happened next?", "type": "statement"}]
    answers = [reply(json.dumps(outline)), reply(json.dumps({"scenes": first}))]
    more = "More words here. " + " ".join(["more"] * words)  # enough that the chapter is long enough now
    answers += [reply(json.dumps({"scenes": [{"narration": more, "type": "statement"}]}))]
    answers += [reply(json.dumps({"scenes": [{"narration": full, "type": "statement"}]})) for _ in range(n - 1)]
    asks = []

    def post(url, headers, json, timeout):
        asks.append(json["messages"][1]["content"])
        return answers.pop(0)

    monkeypatch.setattr(llm.requests, "post", post)
    script = llm.write_script(cfg, "Mary", "notes", from_wikipedia=True)
    # the added scene goes before the chapter's ending (its cliffhanger), never after it
    assert [s.narration for s in script.scenes[:3]] == ["Too short.", more, "What happened next?"]
    assert "Too short." in asks[2] and 'next chapter, "Part 2"' in asks[2]
    assert script.chapters[1].scene == 3  # the next chapter starts after the chapter's ending
    assert len(asks) == n + 2


def test_the_short_script_prompt_fits_a_free_tier_minute():
    # Groq's free tier allows 8,000 tokens a minute, max_tokens (3,000) included. The guide plus the
    # schema must leave room for research notes: about 19,000 characters (~3,300 tokens) after the
    # 17 October trim; 25,000 was already too many.
    from fyt.models import Script

    # as a Short is sent: without the stock-footage template
    guide = (llm.SCRIPT_GUIDE + llm.WIKI_GUIDE).replace(llm.BROLL_TEMPLATE, "") + llm.SHORT_STRUCTURE
    schema = _json.dumps(llm._compact(Script.model_json_schema(), guide=guide), separators=(",", ":"))
    assert len(guide) + len(schema) < 21000


def test_a_rate_limited_model_hands_over_to_the_backup_provider(cfg, monkeypatch):
    from fyt.config import BackupLLM

    monkeypatch.setenv("HF_TOKEN", "hf-test")
    cfg = cfg.model_copy(update={"llm": cfg.llm.model_copy(update={
        "fallback_models": ["small"], "backup": BackupLLM(models=["big/open-model"])})})
    calls = []

    def post(url, headers, json, timeout):
        calls.append((url, headers["Authorization"], json["model"]))
        if "groq" in url:
            return Resp(429, {"error": "rate limit"}, {"retry-after": "30"})
        return reply(_json.dumps(SCRIPT))

    monkeypatch.setattr(llm.requests, "post", post)
    script = llm.write_script(cfg, "Mary", "notes")
    assert script.title == SCRIPT["title"]
    assert [c[2] for c in calls].count(cfg.llm.model) == 3  # gives up on the main model after a few waits
    assert calls[-1] == ("https://router.huggingface.co/v1/chat/completions", "Bearer hf-test", "big/open-model")


def test_no_backup_key_means_the_old_order(cfg, monkeypatch):
    from fyt.config import BackupLLM

    monkeypatch.delenv("HF_TOKEN", raising=False)
    cfg = cfg.model_copy(update={"llm": cfg.llm.model_copy(update={"fallback_models": ["small"], "backup": BackupLLM(models=["big/open-model"])})})
    assert [c.llm.model for c in llm._chain(cfg)] == [cfg.llm.model, "small"]


def test_a_backup_out_of_credit_is_not_asked_again(cfg, monkeypatch):
    from fyt.config import BackupLLM

    monkeypatch.setenv("HF_TOKEN", "hf-test")
    monkeypatch.setattr(llm, "_SPENT", set())
    cfg = cfg.model_copy(update={"llm": cfg.llm.model_copy(update={"backup": BackupLLM(models=["a/one", "b/two"])})})
    asked = []

    def post(url, headers, json, timeout):
        asked.append(json["model"])
        if "groq" in url and len(asked) < 4:
            return Resp(429, {"error": "rate limit"})
        if "huggingface" in url:
            return Resp(402, {"error": "You have no remaining credits."})
        return reply(_json.dumps(SCRIPT))

    monkeypatch.setattr(llm.requests, "post", post)
    llm.write_script(cfg, "Mary", "notes")
    assert asked.count("a/one") == 1 and "b/two" not in asked
    assert [c.llm.model for c in llm._chain(cfg)] == [cfg.llm.model]


def test_a_small_fallback_saying_too_large_is_not_blamed_on_the_main_model(cfg, monkeypatch):
    cfg = cfg.model_copy(update={"llm": cfg.llm.model_copy(update={"fallback_models": ["tiny"]})})

    def post(url, headers, json, timeout):
        if json["model"] == "tiny":
            return Resp(413, {"error": "Request too large"})
        return Resp(503, {"error": "over capacity"})

    monkeypatch.setattr(llm.requests, "post", post)
    with pytest.raises(llm.ClaudeError) as e:
        llm._openai_structured(cfg, "s", "u", llm.Script)
    assert not isinstance(e.value, llm.RequestTooLarge)


def test_a_model_out_of_tokens_for_the_day_is_skipped_at_once_and_for_the_rest_of_the_run(cfg, monkeypatch):
    monkeypatch.setattr(llm, "_EXHAUSTED", set())
    cfg = cfg.model_copy(update={"llm": cfg.llm.model_copy(update={"fallback_models": ["small"]})})
    asked = []

    def post(url, headers, json, timeout):
        asked.append(json["model"])
        if json["model"] == cfg.llm.model:
            return Resp(429, {"error": {"message": "Rate limit reached on tokens per day (TPD): Limit 200000"}})
        return reply(_json.dumps(SCRIPT))

    monkeypatch.setattr(llm.requests, "post", post)
    llm.write_script(cfg, "Mary", "notes")
    llm.write_script(cfg, "Mary", "notes")
    assert asked == [cfg.llm.model, "small", "small"]  # no minute-long waits, and not asked again


def test_a_quick_call_gives_up_on_a_rate_limit_instead_of_waiting(cfg, monkeypatch):
    monkeypatch.setattr(llm, "_EXHAUSTED", set())
    waits = []
    monkeypatch.setattr(llm.time, "sleep", waits.append)
    monkeypatch.setattr(llm.requests, "post", lambda url, headers, json, timeout: Resp(429, {"error": "tokens per minute"}, {"retry-after": "20"}))
    with pytest.raises(llm.ClaudeError):
        llm.structured(cfg, "s", "u", llm.Tightened, quick=True)
    assert waits == []


def test_cloudflare_is_a_last_resort_when_its_keys_are_set(cfg, monkeypatch):
    from fyt.config import BackupLLM

    monkeypatch.setattr(llm, "_EXHAUSTED", set())
    cf = BackupLLM(base_url="https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/ai/v1",
                   api_key_env="CLOUDFLARE_API_TOKEN", models=["@cf/meta/llama-3.3-70b-instruct-fp8-fast"])
    cfg = cfg.model_copy(update={"llm": cfg.llm.model_copy(update={"fallback_models": ["small"], "last_resort": [cf]})})
    monkeypatch.delenv("CLOUDFLARE_ACCOUNT_ID", raising=False)
    monkeypatch.setenv("CLOUDFLARE_API_TOKEN", "cf")
    assert [c.llm.model for c in llm._chain(cfg)] == [cfg.llm.model, "small"]  # no account id: not asked
    monkeypatch.setenv("CLOUDFLARE_ACCOUNT_ID", "acct")
    assert llm._chain(cfg)[-1].llm.model == "@cf/meta/llama-3.3-70b-instruct-fp8-fast"
    urls = []

    def post(url, headers, json, timeout):
        urls.append(url)
        if "groq" in url:
            return Resp(429, {"error": {"message": "on tokens per day (TPD)"}})
        if "response_format" in json:  # a provider without JSON mode
            return Resp(400, {"error": "response_format is not supported"})
        return reply(_json.dumps(SCRIPT))

    monkeypatch.setattr(llm.requests, "post", post)
    assert llm.write_script(cfg, "Mary", "notes").title == SCRIPT["title"]
    assert urls[-1] == "https://api.cloudflare.com/client/v4/accounts/acct/ai/v1/chat/completions"


def test_supporting_calls_ask_the_helper_models_first_and_the_main_model_last(cfg):
    cfg = cfg.model_copy(update={"llm": cfg.llm.model_copy(update={
        "model": "big", "fallback_models": ["small", "other"], "helper_models": ["small", "tiny"]})})
    helper = llm.helping(cfg)
    assert [c.llm.model for c in llm._chain(helper)] == ["small", "tiny", "other", "big"]
    assert [c.llm.model for c in llm._chain(cfg)] == ["big", "small", "other"]  # scripts: unchanged
    plain = cfg.model_copy(update={"llm": cfg.llm.model_copy(update={"helper_models": []})})
    assert llm.helping(plain) is plain


def test_a_short_is_not_offered_stock_footage_scenes():
    assert llm.BROLL_TEMPLATE in llm.SCRIPT_GUIDE
    assert "story, quote, map and timeline" in llm.SHORT_STRUCTURE
