"""Shared types for the LLM layer. Env is read at call time, never at import (B19)."""
import os
from typing import List, Literal, Protocol

from pydantic import BaseModel


class LLMMessage(BaseModel):
    role: Literal["system", "user", "assistant"]
    content: str


class LLMResult(BaseModel):
    text: str
    provider: str
    model: str
    latency_ms: int


class LLMUnavailable(Exception):
    """No provider produced a usable answer (missing key, timeout, API error, invalid output)."""


class LLMProvider(Protocol):
    name: str

    async def complete(
        self,
        messages: List[LLMMessage],
        *,
        json_mode: bool,
        temperature: float,
        max_tokens: int,
        timeout_s: float,
    ) -> LLMResult: ...


def env(name: str, default: str = "") -> str:
    return (os.environ.get(name) or default).strip()


def default_timeout_s() -> float:
    try:
        value = float(env("LLM_TIMEOUT_S", "20"))
    except ValueError:
        return 20.0
    return value if value > 0 else 20.0
