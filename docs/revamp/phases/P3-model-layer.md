# P3 — Model Layer

**Goal:** one LLM interface. Groq stays the default. Gemini switches on by adding `GEMINI_API_KEY` (no code change), with automatic fallback to Groq. Model output is schema-validated so a bad response can never trigger a wrong CRM write.

**Recommended model:** Sonnet 5.5.
**Dependencies:** P0 DONE. **Parallel-safe with:** P1 and P2 (disjoint files). **Not** with P5.
**Branch:** `revamp/p3-model-layer`
**Closes:** D05, B19 (for the files it owns).

---

## Files (ownership)

| File | Action |
|---|---|
| `backend/llm/__init__.py`, `base.py`, `groq_provider.py`, `gemini_provider.py`, `router.py`, `schemas.py` | create |
| `backend/ai_chat.py` | rewrite internals to use `llm.router`; keep `process_message(...)` signature and return keys **exactly** |
| `backend/activity_sheet_processor.py` | `summarize_notes` only: use `llm.router`; keep the signature (the `groq_client` and `model` params become optional and ignored) |
| `backend/prompts/ai_chat_system.txt` | update output schema (below) |
| `backend/prompts/notes_summarizer.txt` | only if needed for JSON-free plain text output |
| `backend/requirements.txt` | add `google-genai` |
| `backend/.env.example` is not readable by agents — document env vars in STATE.md "Environment facts" instead |
| `tests/backend/test_p3_*.py` | create |

**Must not touch:** `server.py` (the chat route keeps calling `process_message`; `_run_activity_sheet_job` keeps calling `summarize_notes` with its current args).

## Dependencies (pre-approved)
`google-genai>=1.0` (official Google GenAI SDK).

---

## Tasks

### P3.T1 — `llm/base.py`
Models and Protocol from ARCHITECTURE §7, plus `class LLMUnavailable(Exception)`. Read env **at call time**, never at import (fixes B19 for these modules).

### P3.T2 — Providers
- `groq_provider.py`: `AsyncGroq`, model `GROQ_MODEL` (default `llama-3.1-8b-instant`); `json_mode=True` → `response_format={"type": "json_object"}` (if the model rejects it, retry once without and rely on the parser); timeout via `asyncio.wait_for`.
- `gemini_provider.py`: `from google import genai`; `client.aio.models.generate_content(model=GEMINI_MODEL, contents=..., config=types.GenerateContentConfig(system_instruction=<system msgs joined>, temperature=..., max_output_tokens=..., response_mime_type="application/json" if json_mode else "text/plain"))`. Map roles: user → `user`, assistant → `model`. Check the SDK's current API at build time (`pip show google-genai`, read its docs) — do not guess method names; if they differ, adapt and note it in HANDOFF.
- Both return `LLMResult` with latency; never log prompt contents at INFO (DEBUG only, truncated).

### P3.T3 — `llm/router.py`
- `get_primary()`: `LLM_PROVIDER` = `groq` | `gemini` | `auto` (default). `auto` → gemini iff `GEMINI_API_KEY` set, else groq.
- `get_fallback()`: `LLM_FALLBACK` default `groq`; `none` disables; never the same as primary.
- `async complete_text(messages, **kw)` and `async complete_json(messages, schema, **kw)`:
  1. primary call → parse (strip ```` ``` ```` fences) → `schema.model_validate`.
  2. on JSON/validation error: one repair call to the same provider appending the error text and "Return only valid JSON matching the schema."
  3. on provider exception/timeout or second validation failure: same sequence on the fallback.
  4. all failed → `LLMUnavailable`.
- Returns `(model_instance, LLMResult)`; log `provider`, `model`, `latency_ms`, `fallback_used` at INFO.

### P3.T4 — `llm/schemas.py`
```python
class ChatDecision(BaseModel):
    action: Literal["trigger_workflow", "answer", "guide"]
    workflow_type: Optional[Literal["appointment", "phonecall", "task", "activity_sheet"]] = None
    payload: dict = {}
    clarification_needed: bool = False
    user_message: str = Field(min_length=1, max_length=2000)

    @model_validator(mode="after")
    def check(self): # trigger_workflow requires workflow_type; activity payloads require subject+account;
        ...           # activity_sheet requires payload.rows list; otherwise force action="answer", clarification_needed=True
```
Payload keys for activity types: `subject`, `account`, `duration_minutes` (int 1–1440), `start_time` (ISO, may be naive local), `notes`, `location`, `mdm_id` (optional).

### P3.T5 — `ai_chat.py`
- `process_message` builds the same system prompt (live state injection unchanged), calls `complete_json(..., ChatDecision)`, returns the **same dict keys** as today (`action`, `workflow_type`, `payload`, `clarification_needed`, `user_message`, `workflow`, `params`). For `workflow_type` in {phonecall, task}: return `workflow_type="appointment"`-compatible legacy keys? **No** — return `workflow_type` as-is and set `payload.activity_type = workflow_type`; the server (P2) reads `activity_type` from the payload. Before P2 lands, server.py forces appointment anyway, so this is safe in either order.
- `LLMUnavailable` → existing `_fallback(...)` message.
### P3.T6 — Prompt
Update `ai_chat_system.txt`: allowed `workflow_type` values `appointment | phonecall | task | activity_sheet`; mapping rules ("call/phone call" → phonecall, "task/follow-up/to-do" → task, "meeting/appointment/visit" → appointment); activity type must be one the live state lists as enabled — add a `__ENABLED_TYPES__` placeholder filled by `build_system_prompt` from `context.get("enabled_activity_types", ["appointment"])`; keep all existing rules about relative dates, duplicates, no emojis, JSON only.

### P3.T7 — `summarize_notes`
Uses `llm.router.complete_text` (temperature 0.2, max 300 tokens); on `LLMUnavailable` return the raw notes. Signature unchanged.

### P3.T8 — Tests (no network: monkeypatch providers)
Router: auto picks groq without key, gemini with key; explicit override; repair retry succeeds; primary timeout → fallback used; both fail → `LLMUnavailable`; `LLM_FALLBACK=none`. ChatDecision: invalid trigger without subject is downgraded to clarification. `process_message` returns identical keys to the baseline for a sample appointment decision. Optional live test marked `@pytest.mark.live` (skipped by default) hitting Groq when `GROQ_API_KEY` is real.

---

## Click paths (G4)
1. Chat: "log a meeting with <account> tomorrow 3pm for 45 minutes" → decision triggers appointment (with fake flow).
2. Chat: "log a call with <account> today" → `workflow_type` phonecall in the response (server may still force appointment if P2 not merged — note which).
3. Chat with `GROQ_API_KEY` set to an invalid value and `LLM_FALLBACK=none` → graceful message, no 500.
4. Activity sheet with notes → summaries produced (or raw notes on LLM failure), job completes.
5. With a real `GEMINI_API_KEY` locally (only if the user provides one): `LLM_PROVIDER=auto` → logs show provider gemini.

## User action after deploy
Add `GEMINI_API_KEY` (and optionally `GEMINI_MODEL`) in Railway → `sales-copilot-api` → Variables when ready. Nothing else. Until then Groq is used.

## Definition of done
- [ ] Tasks ticked; G1–G7 green; prod smoke: chat answers a question
- [ ] STATE.md "Environment facts" lists the LLM env vars; HANDOFF.md updated; P3 DONE
