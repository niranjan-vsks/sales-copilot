import asyncio

import pytest
from pydantic import BaseModel

from llm import router
from llm.base import LLMUnavailable

from tests.backend.p3_support import clean_llm_env, providers  # noqa: F401  (fixtures)


class Answer(BaseModel):
    value: int


MSGS = [{"role": "system", "content": "s"}, {"role": "user", "content": "u"}]


# ── selection ────────────────────────────────────────────────────────────────

def test_auto_picks_groq_without_gemini_key(clean_llm_env):
    assert router.primary_name() == "groq"
    assert router.fallback_name() is None  # fallback groq == primary groq -> disabled


def test_auto_picks_gemini_with_key_and_groq_fallback(clean_llm_env, monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "k")
    assert router.primary_name() == "gemini"
    assert router.fallback_name() == "groq"


def test_explicit_override_wins_over_key(clean_llm_env, monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "k")
    monkeypatch.setenv("LLM_PROVIDER", "groq")
    assert router.primary_name() == "groq"
    assert router.fallback_name() is None
    monkeypatch.setenv("LLM_PROVIDER", "gemini")
    monkeypatch.delenv("GEMINI_API_KEY")
    assert router.primary_name() == "gemini"


def test_fallback_none_and_never_same_as_primary(clean_llm_env, monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "k")
    monkeypatch.setenv("LLM_FALLBACK", "none")
    assert router.fallback_name() is None
    monkeypatch.setenv("LLM_FALLBACK", "gemini")
    assert router.fallback_name() is None  # same as primary (gemini)
    monkeypatch.setenv("LLM_FALLBACK", "bogus")
    assert router.fallback_name() is None


def test_env_is_read_at_call_time(clean_llm_env, monkeypatch):
    assert router.primary_name() == "groq"
    monkeypatch.setenv("GEMINI_API_KEY", "k")
    assert router.primary_name() == "gemini"


# ── complete_json ────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_json_happy_path_and_fence_stripping(providers):
    reg = providers(groq=['```json\n{"value": 3}\n```'])
    obj, result = await router.complete_json(MSGS, Answer)
    assert obj.value == 3 and result.provider == "groq"
    assert reg["groq"].calls[0]["json_mode"] is True


@pytest.mark.asyncio
async def test_repair_retry_succeeds_on_same_provider(providers):
    reg = providers(groq=["not json at all", '{"value": 7}'])
    obj, _ = await router.complete_json(MSGS, Answer)
    assert obj.value == 7
    first, second = reg["groq"].calls
    assert len(second["messages"]) == len(first["messages"]) + 2
    assert "Return only valid JSON matching the schema." in second["messages"][-1].content


@pytest.mark.asyncio
async def test_repair_retry_after_schema_violation(providers):
    providers(groq=['{"value": "abc"}', '{"value": 1}'])
    obj, _ = await router.complete_json(MSGS, Answer)
    assert obj.value == 1


@pytest.mark.asyncio
async def test_primary_timeout_uses_fallback(providers, monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "k")
    reg = providers(gemini=[asyncio.TimeoutError()], groq=['{"value": 2}'])
    obj, result = await router.complete_json(MSGS, Answer)
    assert obj.value == 2 and result.provider == "groq"
    assert len(reg["gemini"].calls) == 1  # provider exception: no repair retry


@pytest.mark.asyncio
async def test_two_validation_failures_fall_back(providers, monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "k")
    reg = providers(gemini=["garbage", "still garbage"], groq=['{"value": 9}'])
    obj, result = await router.complete_json(MSGS, Answer)
    assert obj.value == 9 and result.provider == "groq"
    assert len(reg["gemini"].calls) == 2


@pytest.mark.asyncio
async def test_all_failed_raises_unavailable(providers, monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "k")
    providers(gemini=[RuntimeError("boom")], groq=["bad", "worse"])
    with pytest.raises(LLMUnavailable):
        await router.complete_json(MSGS, Answer)


@pytest.mark.asyncio
async def test_fallback_none_disables_fallback(providers, monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "k")
    monkeypatch.setenv("LLM_FALLBACK", "none")
    reg = providers(gemini=[RuntimeError("boom")], groq=['{"value": 1}'])
    with pytest.raises(LLMUnavailable):
        await router.complete_json(MSGS, Answer)
    assert reg["groq"].calls == []


@pytest.mark.asyncio
async def test_unavailable_message_has_no_secrets_or_prompt(providers):
    providers(groq=[RuntimeError("sk-secret-key and prompt text")])
    with pytest.raises(LLMUnavailable) as exc:
        await router.complete_json(MSGS, Answer)
    assert "sk-secret" not in str(exc.value)


@pytest.mark.asyncio
async def test_timeout_param_comes_from_env(providers, monkeypatch):
    monkeypatch.setenv("LLM_TIMEOUT_S", "7")
    reg = providers(groq=['{"value": 1}'])
    await router.complete_json(MSGS, Answer)
    assert reg["groq"].calls[0]["timeout_s"] == 7.0


# ── complete_text ────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_text_primary_then_fallback_on_empty(providers, monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "k")
    reg = providers(gemini=["   "], groq=["a summary"])
    result = await router.complete_text(MSGS)
    assert result.text == "a summary" and result.provider == "groq"
    assert reg["gemini"].calls[0]["json_mode"] is False


@pytest.mark.asyncio
async def test_text_all_failed(providers):
    providers(groq=[RuntimeError("x")])
    with pytest.raises(LLMUnavailable):
        await router.complete_text(MSGS)
