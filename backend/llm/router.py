"""Provider selection, schema validation, repair retry and fallback.

primary -> parse/validate -> one repair retry -> fallback provider -> LLMUnavailable.
Env (LLM_PROVIDER, LLM_FALLBACK, LLM_TIMEOUT_S, *_API_KEY, *_MODEL) is read on every call.
"""
import json
import logging
from typing import Any, List, Optional, Tuple, Type, TypeVar

from pydantic import BaseModel, ValidationError

from .base import LLMMessage, LLMProvider, LLMResult, LLMUnavailable, default_timeout_s, env

logger = logging.getLogger(__name__)

T = TypeVar("T", bound=BaseModel)
PROVIDER_NAMES = ("groq", "gemini")


def _build(name: str) -> LLMProvider:
    if name == "gemini":
        from .gemini_provider import GeminiProvider
        return GeminiProvider()
    from .groq_provider import GroqProvider
    return GroqProvider()


def primary_name() -> str:
    choice = env("LLM_PROVIDER", "auto").lower()
    if choice in PROVIDER_NAMES:
        return choice
    return "gemini" if env("GEMINI_API_KEY") else "groq"


def fallback_name() -> Optional[str]:
    choice = env("LLM_FALLBACK", "groq").lower()
    if choice not in PROVIDER_NAMES or choice == primary_name():
        return None
    return choice


def get_primary() -> LLMProvider:
    return _build(primary_name())


def get_fallback() -> Optional[LLMProvider]:
    name = fallback_name()
    return _build(name) if name else None


def _coerce(messages: List[Any]) -> List[LLMMessage]:
    return [m if isinstance(m, LLMMessage) else LLMMessage(**m) for m in messages]


def _parse(text: str, schema: Type[T]) -> T:
    """Strip markdown fences, then validate against the schema."""
    raw = text.strip()
    if raw.startswith("```"):
        parts = raw.split("```")
        raw = parts[1] if len(parts) > 1 else raw
        if raw.lower().startswith("json"):
            raw = raw[4:]
        raw = raw.strip()
    return schema.model_validate(json.loads(raw))


def _repair_messages(messages: List[LLMMessage], bad: str, error: Exception, schema: Type[BaseModel]) -> List[LLMMessage]:
    detail = str(error)[:500]
    return messages + [
        LLMMessage(role="assistant", content=bad[:4000]),
        LLMMessage(
            role="user",
            content=(
                f"That reply was not valid: {detail}\n"
                "Return only valid JSON matching the schema.\n"
                f"Schema: {json.dumps(schema.model_json_schema(), separators=(',', ':'))}"
            ),
        ),
    ]


async def _json_on(provider: LLMProvider, messages: List[LLMMessage], schema: Type[T], params: dict) -> Tuple[T, LLMResult]:
    result = await provider.complete(messages, json_mode=True, **params)
    try:
        return _parse(result.text, schema), result
    except (ValueError, ValidationError) as exc:  # JSONDecodeError is a ValueError
        logger.info("%s returned invalid JSON (%s); one repair attempt", provider.name, type(exc).__name__)
        repaired = await provider.complete(
            _repair_messages(messages, result.text, exc, schema), json_mode=True, **params
        )
        return _parse(repaired.text, schema), repaired


async def _text_on(provider: LLMProvider, messages: List[LLMMessage], params: dict) -> LLMResult:
    result = await provider.complete(messages, json_mode=False, **params)
    if not result.text.strip():
        raise LLMUnavailable(f"{provider.name} returned an empty reply")
    return result


def _params(temperature: float, max_tokens: int, timeout_s: Optional[float]) -> dict:
    return {
        "temperature": temperature,
        "max_tokens": max_tokens,
        "timeout_s": timeout_s if timeout_s else default_timeout_s(),
    }


async def _run(attempt, *, what: str):
    """Run `attempt(provider)` on the primary, then on the fallback; raise LLMUnavailable if both fail."""
    providers: List[Tuple[LLMProvider, bool]] = []
    errors: List[str] = []
    for getter, is_fallback in ((get_primary, False), (get_fallback, True)):
        try:
            provider = getter()
        except Exception as exc:  # e.g. SDK import failure
            errors.append(f"setup: {type(exc).__name__}")
            continue
        if provider:
            providers.append((provider, is_fallback))

    for provider, is_fallback in providers:
        try:
            value, result = await attempt(provider)
        except Exception as exc:
            errors.append(f"{provider.name}: {type(exc).__name__}")
            logger.warning("LLM %s failed on %s (%s)", what, provider.name, type(exc).__name__)
            continue
        logger.info(
            "LLM %s ok provider=%s model=%s latency_ms=%d fallback_used=%s",
            what, result.provider, result.model, result.latency_ms, is_fallback,
        )
        return value, result
    raise LLMUnavailable("; ".join(errors) or "no provider available")


async def complete_json(
    messages: List[Any], schema: Type[T], *,
    temperature: float = 0.15, max_tokens: int = 1024, timeout_s: Optional[float] = None,
) -> Tuple[T, LLMResult]:
    msgs, params = _coerce(messages), _params(temperature, max_tokens, timeout_s)

    async def attempt(provider):
        return await _json_on(provider, msgs, schema, params)

    return await _run(attempt, what="json")


async def complete_text(
    messages: List[Any], *,
    temperature: float = 0.2, max_tokens: int = 512, timeout_s: Optional[float] = None,
) -> LLMResult:
    msgs, params = _coerce(messages), _params(temperature, max_tokens, timeout_s)

    async def attempt(provider):
        result = await _text_on(provider, msgs, params)
        return result, result

    result, _ = await _run(attempt, what="text")
    return result
