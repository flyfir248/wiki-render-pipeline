import json

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
