"""Groq provider (default). Client is built per API key at call time."""
import asyncio
import logging
import time
from typing import Dict, List

from groq import AsyncGroq

from .base import LLMMessage, LLMResult, LLMUnavailable, env

logger = logging.getLogger(__name__)

# llama-3.1-8b-instant was retired by Groq (404 model_not_found, verified 2026-10-11 with the project key).
DEFAULT_MODEL = "qwen/qwen3.8-27b"
_clients: Dict[str, AsyncGroq] = {}


def _client(api_key: str) -> AsyncGroq:
    if api_key not in _clients:
        _clients[api_key] = AsyncGroq(api_key=api_key)
    return _clients[api_key]


class GroqProvider:
    name = "groq"

    async def complete(
        self,
        messages: List[LLMMessage],
        *,
        json_mode: bool,
        temperature: float,
        max_tokens: int,
        timeout_s: float,
    ) -> LLMResult:
        api_key = env("GROQ_API_KEY")
        if not api_key:
            raise LLMUnavailable("GROQ_API_KEY is not configured")
        model = env("GROQ_MODEL", DEFAULT_MODEL)
        client = _client(api_key)
        payload = [m.model_dump() for m in messages]

        async def call(use_json_mode: bool):
            kwargs = {}
            if use_json_mode:
                kwargs["response_format"] = {"type": "json_object"}
            return await asyncio.wait_for(
                client.chat.completions.create(
                    model=model, messages=payload,
                    temperature=temperature, max_tokens=max_tokens, **kwargs,
                ),
                timeout=timeout_s,
            )

        started = time.monotonic()
        try:
            response = await call(json_mode)
        except asyncio.TimeoutError:
            raise
        except Exception as exc:
            if not json_mode:
                raise
            # Some models reject response_format; retry once without it and rely on the parser.
            logger.info("Groq rejected json_mode (%s); retrying without it", type(exc).__name__)
            response = await call(False)

        text = (response.choices[0].message.content or "").strip()
        return LLMResult(
            text=text, provider=self.name, model=model,
            latency_ms=int((time.monotonic() - started) * 1000),
        )
