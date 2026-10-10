"""Provider adapters against stub SDK clients (no network)."""
import asyncio
from types import SimpleNamespace

import pytest

from llm import gemini_provider, groq_provider
from llm.base import LLMMessage, LLMUnavailable

from tests.backend.p3_support import clean_llm_env  # noqa: F401  (fixture)

MSGS = [
    LLMMessage(role="system", content="be brief"),
    LLMMessage(role="user", content="hello"),
    LLMMessage(role="assistant", content="hi"),
    LLMMessage(role="user", content="log it"),
]
KW = dict(temperature=0.1, max_tokens=50, timeout_s=2.0)


def groq_stub(behaviour):
    calls = []

    async def create(**kwargs):
        calls.append(kwargs)
        return behaviour(kwargs)

    stub = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))
    return stub, calls


def groq_reply(text):
    return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=text))])


@pytest.mark.asyncio
async def test_groq_json_mode_and_model_from_env(clean_llm_env, monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "k")
    monkeypatch.setenv("GROQ_MODEL", "my-model")
    stub, calls = groq_stub(lambda kw: groq_reply(' {"a": 1} '))
    monkeypatch.setattr(groq_provider, "_client", lambda key: stub)
    result = await groq_provider.GroqProvider().complete(MSGS, json_mode=True, **KW)
    assert result.text == '{"a": 1}' and result.provider == "groq" and result.model == "my-model"
    assert calls[0]["response_format"] == {"type": "json_object"}
    assert calls[0]["model"] == "my-model" and calls[0]["messages"][0] == {"role": "system", "content": "be brief"}


@pytest.mark.asyncio
async def test_groq_retries_without_response_format_when_rejected(clean_llm_env, monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "k")

    def behaviour(kw):
        if "response_format" in kw:
            raise RuntimeError("response_format unsupported")
        return groq_reply("{}")

    stub, calls = groq_stub(behaviour)
    monkeypatch.setattr(groq_provider, "_client", lambda key: stub)
    result = await groq_provider.GroqProvider().complete(MSGS, json_mode=True, **KW)
    assert result.text == "{}" and len(calls) == 2 and "response_format" not in calls[1]


@pytest.mark.asyncio
async def test_groq_timeout_is_not_retried(clean_llm_env, monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "k")

    async def slow(**kwargs):
        await asyncio.sleep(5)

    stub = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=slow)))
    monkeypatch.setattr(groq_provider, "_client", lambda key: stub)
    with pytest.raises(asyncio.TimeoutError):
        await groq_provider.GroqProvider().complete(MSGS, json_mode=True, temperature=0.1, max_tokens=5, timeout_s=0.05)


@pytest.mark.asyncio
async def test_groq_missing_key(clean_llm_env):
    with pytest.raises(LLMUnavailable):
        await groq_provider.GroqProvider().complete(MSGS, json_mode=False, **KW)


def gemini_stub(behaviour):
    calls = []

    async def generate_content(*, model, contents, config):
        calls.append({"model": model, "contents": contents, "config": config})
        return behaviour(config)

    return SimpleNamespace(aio=SimpleNamespace(models=SimpleNamespace(generate_content=generate_content))), calls


@pytest.mark.asyncio
async def test_gemini_maps_roles_system_and_json_mime(clean_llm_env, monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "k")
    monkeypatch.setenv("GEMINI_MODEL", "gem-x")
    stub, calls = gemini_stub(lambda cfg: SimpleNamespace(text=' {"b": 2} '))
    monkeypatch.setattr(gemini_provider, "_client", lambda key: stub)
    result = await gemini_provider.GeminiProvider().complete(MSGS, json_mode=True, **KW)
    assert result.text == '{"b": 2}' and result.provider == "gemini" and result.model == "gem-x"
    call = calls[0]
    assert [c.role for c in call["contents"]] == ["user", "model", "user"]
    assert call["config"].system_instruction == "be brief"
    assert call["config"].response_mime_type == "application/json"
    assert call["config"].max_output_tokens == 50 and call["config"].temperature == 0.1


@pytest.mark.asyncio
async def test_gemini_text_mode_and_retry_without_temperature(clean_llm_env, monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "k")

    def behaviour(cfg):
        if cfg.temperature is not None:
            raise RuntimeError("temperature is deprecated for this model")
        return SimpleNamespace(text="plain")

    stub, calls = gemini_stub(behaviour)
    monkeypatch.setattr(gemini_provider, "_client", lambda key: stub)
    result = await gemini_provider.GeminiProvider().complete(MSGS, json_mode=False, **KW)
    assert result.text == "plain" and len(calls) == 2
    assert calls[1]["config"].response_mime_type == "text/plain" and calls[1]["config"].temperature is None


@pytest.mark.asyncio
async def test_gemini_other_errors_propagate_and_missing_key(clean_llm_env, monkeypatch):
    with pytest.raises(LLMUnavailable):
        await gemini_provider.GeminiProvider().complete(MSGS, json_mode=False, **KW)
    monkeypatch.setenv("GEMINI_API_KEY", "k")

    def boom(cfg):
        raise RuntimeError("quota exceeded")

    stub, calls = gemini_stub(boom)
    monkeypatch.setattr(gemini_provider, "_client", lambda key: stub)
    with pytest.raises(RuntimeError):
        await gemini_provider.GeminiProvider().complete(MSGS, json_mode=False, **KW)
    assert len(calls) == 1


@pytest.mark.live
@pytest.mark.asyncio
async def test_live_groq_roundtrip(clean_llm_env):
    import os
    key = os.environ.get("REAL_GROQ_API_KEY")
    if not key:
        pytest.skip("set REAL_GROQ_API_KEY to run the live Groq test")
    os.environ["GROQ_API_KEY"] = key
    result = await groq_provider.GroqProvider().complete(
        [LLMMessage(role="user", content="Reply with the single word: pong")],
        json_mode=False, temperature=0, max_tokens=10, timeout_s=20,
    )
    assert result.text
