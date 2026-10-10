"""Gemini provider. Activated by setting GEMINI_API_KEY (LLM_PROVIDER=auto) or LLM_PROVIDER=gemini."""
import asyncio
import logging
import time
from typing import Dict, List

from .base import LLMMessage, LLMResult, LLMUnavailable, env

logger = logging.getLogger(__name__)

DEFAULT_MODEL = "gemini-3.6-flash"
_clients: Dict[str, object] = {}


def _client(api_key: str):
    if api_key not in _clients:
        from google import genai  # imported lazily so Groq-only deployments never load the SDK
        _clients[api_key] = genai.Client(api_key=api_key)
    return _clients[api_key]


class GeminiProvider:
    name = "gemini"

    async def complete(
        self,
        messages: List[LLMMessage],
        *,
        json_mode: bool,
        temperature: float,
        max_tokens: int,
        timeout_s: float,
    ) -> LLMResult:
        api_key = env("GEMINI_API_KEY")
        if not api_key:
            raise LLMUnavailable("GEMINI_API_KEY is not configured")
        from google.genai import types

        model = env("GEMINI_MODEL", DEFAULT_MODEL)
        system_text = "\n\n".join(m.content for m in messages if m.role == "system")
        contents = [
            types.Content(
                role="model" if m.role == "assistant" else "user",
                parts=[types.Part(text=m.content)],
            )
            for m in messages if m.role != "system"
        ]
        if not contents:
            contents = [types.Content(role="user", parts=[types.Part(text="Proceed.")])]
        client = _client(api_key)

        async def call(with_temperature: bool):
            config = types.GenerateContentConfig(
                system_instruction=system_text or None,
                max_output_tokens=max_tokens,
                response_mime_type="application/json" if json_mode else "text/plain",
                **({"temperature": temperature} if with_temperature else {}),
            )
            return await asyncio.wait_for(
                client.aio.models.generate_content(model=model, contents=contents, config=config),
                timeout=timeout_s,
            )

        started = time.monotonic()
        try:
            response = await call(True)
        except asyncio.TimeoutError:
            raise
        except Exception as exc:
            # Newer Gemini models deprecate sampling params; retry once without temperature.
            if "temperature" not in str(exc).lower():
                raise
            logger.info("Gemini rejected temperature; retrying without it")
            response = await call(False)

        return LLMResult(
            text=(response.text or "").strip(), provider=self.name, model=model,
            latency_ms=int((time.monotonic() - started) * 1000),
        )
