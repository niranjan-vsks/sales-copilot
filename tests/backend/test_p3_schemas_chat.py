import pytest

import ai_chat
import activity_sheet_processor as asp
from llm.schemas import ChatDecision

from tests.backend.p3_support import clean_llm_env, decision_json, providers  # noqa: F401  (fixtures)

LEGACY_KEYS = {"action", "workflow_type", "payload", "clarification_needed", "user_message", "workflow", "params"}


def decision(**kw):
    base = {"action": "trigger_workflow", "workflow_type": "appointment",
            "payload": {"subject": "S", "account": "Acme"}, "user_message": "ok"}
    base.update(kw)
    return ChatDecision.model_validate(base)


# ── ChatDecision ─────────────────────────────────────────────────────────────

def test_valid_trigger_is_kept():
    d = decision(payload={"subject": "S", "account": "Acme", "duration_minutes": "45"})
    assert d.action == "trigger_workflow" and not d.clarification_needed
    assert d.payload["duration_minutes"] == 45


@pytest.mark.parametrize("payload", [{}, {"account": "Acme"}, {"subject": "S"}, {"subject": " ", "account": "A"}])
def test_trigger_without_subject_or_account_is_downgraded(payload):
    d = decision(payload=payload)
    assert d.action == "answer" and d.clarification_needed is True
    assert "?" in d.user_message


def test_downgrade_keeps_model_question():
    d = decision(payload={}, user_message="Which account is this for?")
    assert d.user_message == "Which account is this for?"


@pytest.mark.parametrize("minutes", [0, 1441, "soon", -5])
def test_bad_duration_is_downgraded(minutes):
    assert decision(payload={"subject": "S", "account": "A", "duration_minutes": minutes}).action == "answer"


def test_trigger_without_workflow_type_is_downgraded():
    assert decision(workflow_type=None).action == "answer"
    assert decision(workflow_type="null").workflow_type is None


def test_activity_sheet_requires_rows():
    assert decision(workflow_type="activity_sheet", payload={}).action == "answer"
    assert decision(workflow_type="activity_sheet", payload={"rows": []}).action == "answer"
    ok = decision(workflow_type="activity_sheet", payload={"rows": [{"serial_no": "1"}]})
    assert ok.action == "trigger_workflow"


def test_non_trigger_actions_untouched():
    d = ChatDecision.model_validate({"action": "guide", "payload": None, "user_message": "Do X then Y."})
    assert d.action == "guide" and d.payload == {} and not d.clarification_needed


def test_unknown_action_or_empty_message_rejected():
    with pytest.raises(ValueError):
        ChatDecision.model_validate({"action": "delete_everything", "user_message": "x"})
    with pytest.raises(ValueError):
        ChatDecision.model_validate({"action": "answer", "user_message": ""})


# ── process_message ──────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_process_message_keeps_legacy_keys_for_appointment(providers):
    reg = providers(groq=[decision_json()])
    out = await ai_chat.process_message("log a meeting with Acme", "u1", [{"role": "user", "content": "hi"}])
    assert set(out) == LEGACY_KEYS
    assert out["action"] == "trigger_workflow" and out["workflow_type"] == "appointment"
    assert out["workflow"] == "log-d365-activity"
    assert out["payload"]["account"] == "Acme" and out["payload"]["activity_type"] == "appointment"
    assert out["params"] == out["payload"]
    sent = reg["groq"].calls[0]["messages"]
    assert sent[0].role == "system" and sent[-1].content == "log a meeting with Acme"


@pytest.mark.asyncio
async def test_process_message_phonecall_when_enabled(providers):
    providers(groq=[decision_json(workflow_type="phonecall", user_message="Logging the call.")])
    ctx = {"enabled_activity_types": ["appointment", "phonecall"]}
    out = await ai_chat.process_message("log a call with Acme", "u1", [], context_snapshot=ctx)
    assert out["workflow_type"] == "phonecall" and out["payload"]["activity_type"] == "phonecall"
    assert out["user_message"] == "Logging the call."


@pytest.mark.asyncio
async def test_process_message_disabled_type_is_coerced_and_disclosed(providers):
    providers(groq=[decision_json(workflow_type="phonecall", user_message="Logged the phone call.")])
    out = await ai_chat.process_message("log a call with Acme", "u1", [])  # default: appointment only
    assert out["workflow_type"] == "appointment" and out["payload"]["activity_type"] == "appointment"
    assert out["user_message"].startswith("Logging this as an appointment")


@pytest.mark.asyncio
async def test_process_message_incomplete_trigger_asks_instead_of_firing(providers):
    providers(groq=[decision_json(payload={"account": "Acme"}, user_message="Logging it.")])
    out = await ai_chat.process_message("log a meeting", "u1", [])
    assert out["action"] == "answer" and out["clarification_needed"] is True


@pytest.mark.asyncio
async def test_process_message_never_raises_when_llm_unavailable(providers):
    providers(groq=[RuntimeError("down")])
    out = await ai_chat.process_message("hello", "u1", [])
    assert set(out) == LEGACY_KEYS
    assert out["action"] == "answer" and out["clarification_needed"] is True
    assert out["workflow_type"] is None and out["workflow"] is None


@pytest.mark.asyncio
async def test_process_message_without_any_key_is_graceful(clean_llm_env):
    out = await ai_chat.process_message("hello", "u1", [])
    assert out["action"] == "answer" and out["clarification_needed"] is True


def test_system_prompt_lists_enabled_types_and_fills_all_placeholders():
    prompt = ai_chat.build_system_prompt({"enabled_activity_types": ["appointment", "phonecall"]}, "2026-10-11")
    assert "appointment, phonecall" in prompt and "2026-10-11" in prompt
    assert "__" not in prompt
    default = ai_chat.build_system_prompt({}, "2026-10-11")
    assert "ENABLED ACTIVITY TYPES (only these can be logged): appointment" in default


# ── summarize_notes ──────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_summarize_notes_uses_router(providers):
    reg = providers(groq=["The meeting covered pricing."])
    out = await asp.summarize_notes("talked pricing", "Acme", "2026-10-01", None, "ignored-model")
    assert out == "The meeting covered pricing."
    assert reg["groq"].calls[0]["json_mode"] is False
    assert reg["groq"].calls[0]["max_tokens"] == 300 and reg["groq"].calls[0]["temperature"] == 0.2
    assert "talked pricing" in reg["groq"].calls[0]["messages"][0].content


@pytest.mark.asyncio
async def test_summarize_notes_returns_raw_notes_on_llm_failure(providers):
    providers(groq=[RuntimeError("down")])
    assert await asp.summarize_notes("raw notes", "Acme", "2026-10-01", object()) == "raw notes"


@pytest.mark.asyncio
async def test_summarize_notes_empty(providers):
    providers(groq=[])
    assert await asp.summarize_notes("  ", "Acme", "2026-10-01") == ""


# ── POST /api/chat (route stays 200 and truthful) ────────────────────────────

@pytest.mark.asyncio
async def test_chat_route_graceful_when_llm_unavailable(auth_client, clean_llm_env):
    r = await auth_client.post("/api/chat", json={"message": "hello"})
    assert r.status_code == 200
    body = r.json()
    assert body["action"] == "answer" and body["clarification_needed"] is True
    assert body["workflow_result"] is None and body["message"]


@pytest.mark.asyncio
@pytest.mark.parametrize("enabled, triggered", [(["appointment", "phonecall"], "phonecall"), (None, "appointment")])
async def test_chat_route_trigger_reaches_executor(auth_client, providers, monkeypatch, enabled, triggered):
    import server
    seen = {}

    async def fake_exec(user, params):
        seen.update(params)
        return {"status": "success", "d365_record_id": "rec-1"}

    async def snapshot(user_id):
        return {"enabled_activity_types": enabled} if enabled else {}

    monkeypatch.setattr(server, "_execute_d365_activity", fake_exec)
    monkeypatch.setattr(server.kb, "get_app_context_snapshot", snapshot)
    providers(groq=[decision_json(workflow_type="phonecall")])
    r = await auth_client.post("/api/chat", json={"message": "log a call with Acme"})
    assert r.status_code == 200
    body = r.json()
    assert body["workflow_triggered"] == triggered
    assert body["workflow_result"]["status"] == "success"
    # Until P2 lands the server still logs every activity as an appointment.
    assert seen["account"] == "Acme" and seen["activity_type"] == "appointment"
