"""Shared helpers for the P3 tests (imported, not collected). No network: providers are fakes."""
import json
from typing import List, Union

import pytest

from llm import router
from llm.base import LLMResult

LLM_ENV = ("LLM_PROVIDER", "LLM_FALLBACK", "LLM_TIMEOUT_S", "GEMINI_API_KEY", "GEMINI_MODEL",
           "GROQ_API_KEY", "GROQ_MODEL")

Reply = Union[str, Exception]


class FakeProvider:
    """Replays `replies` in order; an Exception reply is raised. Records every call."""

    def __init__(self, name: str, replies: List[Reply]):
        self.name = name
        self.replies = list(replies)
        self.calls: List[dict] = []

    async def complete(self, messages, *, json_mode, temperature, max_tokens, timeout_s):
        self.calls.append({"messages": messages, "json_mode": json_mode, "temperature": temperature,
                           "max_tokens": max_tokens, "timeout_s": timeout_s})
        reply = self.replies.pop(0)
        if isinstance(reply, Exception):
            raise reply
        return LLMResult(text=reply, provider=self.name, model=f"{self.name}-model", latency_ms=1)


@pytest.fixture
def clean_llm_env(monkeypatch):
    for key in LLM_ENV:
        monkeypatch.delenv(key, raising=False)


@pytest.fixture
def providers(monkeypatch, clean_llm_env):
    """Register fake providers: providers(groq=[...], gemini=[...]) -> {name: FakeProvider}."""
    registry = {}

    def register(**replies):
        for name, items in replies.items():
            registry[name] = FakeProvider(name, items)
        monkeypatch.setattr(router, "_build", lambda name: registry[name])
        return registry

    return register


def decision_json(**overrides) -> str:
    base = {
        "action": "trigger_workflow",
        "workflow_type": "appointment",
        "payload": {"subject": "Customer Meeting - Acme", "account": "Acme", "duration_minutes": 45,
                    "start_time": "2026-10-12T15:00"},
        "clarification_needed": False,
        "user_message": "Logging the appointment with Acme.",
    }
    base.update(overrides)
    return json.dumps(base)
