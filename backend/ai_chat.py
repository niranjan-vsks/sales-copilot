"""
Context-aware chat layer.

Every request receives a live snapshot of the application state (webhook
status, uploaded files, recent activities, …) which is injected into the
system prompt so the AI can answer questions about the app AND trigger
workflows with real data.

The model call goes through `llm.router` (Groq by default, Gemini when
GEMINI_API_KEY is set, automatic fallback) and the reply is validated against
`llm.schemas.ChatDecision` before anything acts on it. Provider env vars are
documented in docs/revamp/STATE.md "Environment facts".

Prompts are loaded from the prompts/ directory so they can be edited without
touching Python code.
"""
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from llm import router
from llm.base import LLMUnavailable
from llm.schemas import ACTIVITY_TYPES, ChatDecision

logger = logging.getLogger(__name__)

_PROMPTS_DIR = Path(__file__).parent / "prompts"


def _load_prompt(filename: str) -> str:
    """Read a prompt template from the prompts/ directory."""
    path = _PROMPTS_DIR / filename
    try:
        return path.read_text(encoding="utf-8")
    except FileNotFoundError:
        logger.error("Prompt file not found: %s", path)
        return ""


# ─── Dynamic system prompt ────────────────────────────────────────────────────

def _build_live_state(context: Dict[str, Any]) -> str:
    """Build the LIVE APPLICATION STATE block injected into the system prompt."""

    # Webhook line
    if context.get("webhook_connected"):
        webhook_line = f"Connected ({context['webhook_url']})"
    else:
        webhook_line = "Not connected — user needs to add a Power Automate URL in Admin > Connections"

    # Default file line
    df = context.get("default_file")
    if df:
        ts = df.get("uploaded_at", "")[:10]
        file_line = f"{df['name']} — {df['row_count']} accounts (uploaded {ts})"
    else:
        file_line = "No file uploaded — user needs to upload via Admin > File Management"

    # Cookie session
    cookie_line = "Active" if context.get("cookie_session_active") else "Not configured"

    # Last activity
    la = context.get("last_activity_created")
    if la and la.get("subject"):
        last_act_line = (
            f"{la['type'].capitalize()} — \"{la['subject']}\" with {la['account']}"
            f" [{la['status']}] on {la.get('timestamp', '')[:10]}"
        )
    else:
        last_act_line = "None yet"

    # Recent workflows
    recent = context.get("recent_workflows", [])
    if recent:
        recent_lines = "\n".join(
            f"  - {w['type'].capitalize()}: \"{w['subject']}\" with {w['account']}"
            f" [{w['status']}] on {w.get('timestamp', '')[:10]}"
            for w in recent
            if w.get("subject")
        ) or "  None"
    else:
        recent_lines = "  None"

    total_acc = context.get("total_accounts_cached", 0)

    return (
        f"- Webhook: {webhook_line}\n"
        f"- Default Account File: {file_line}\n"
        f"- Total Accounts Cached: {total_acc}\n"
        f"- Cookie Session: {cookie_line}\n"
        f"- Last Activity Created: {last_act_line}\n"
        f"- Recent Workflows:\n{recent_lines}"
    )


def build_system_prompt(context: Dict[str, Any], today: str) -> str:
    """Construct the system prompt from the template file with live state injected."""
    template = _load_prompt("ai_chat_system.txt")
    live_state = _build_live_state(context)
    enabled = context.get("enabled_activity_types") or ["appointment"]
    return (
        template
        .replace("__TODAY__", today)
        .replace("__LIVE_STATE__", live_state)
        .replace("__ENABLED_TYPES__", ", ".join(enabled))
    )


# ─── Main entry point ─────────────────────────────────────────────────────────

async def process_message(
    text: str,
    user_id: str,
    chat_history: List[Dict[str, Any]],
    context_snapshot: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Send the user message to the LLM layer with live app context.

    Returns:
        {
          action:               "trigger_workflow" | "answer" | "guide"
          workflow_type:        str | None
          payload:              dict
          clarification_needed: bool
          user_message:         str
          workflow / params:    legacy keys kept for existing callers
        }
    Never raises: provider failures come back as a clarification message.
    """
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    system_content = build_system_prompt(context_snapshot or {}, today)

    messages: List[Dict[str, str]] = [{"role": "system", "content": system_content}]

    # Last 10 messages for conversational memory
    for msg in chat_history[-10:]:
        role = msg.get("role", "user")
        content = msg.get("content", "")
        if role in ("user", "assistant") and content:
            messages.append({"role": role, "content": content})

    messages.append({"role": "user", "content": text})

    try:
        decision, _ = await router.complete_json(
            messages, ChatDecision, temperature=0.15, max_tokens=1024,
        )
    except LLMUnavailable as exc:
        logger.error("LLM unavailable for chat: %s", exc)
        return _fallback("I'm having trouble processing that right now. Please try again in a moment.")
    except Exception as exc:
        logger.error("Unexpected chat LLM error: %s", type(exc).__name__)
        return _fallback("I'm having trouble processing that right now. Please try again in a moment.")

    action = decision.action
    workflow_type = decision.workflow_type
    payload = dict(decision.payload)
    if action == "trigger_workflow" and workflow_type in ACTIVITY_TYPES:
        payload["activity_type"] = workflow_type

    return {
        "action": action,
        "workflow_type": workflow_type,
        "payload": payload,
        "clarification_needed": decision.clarification_needed,
        "user_message": decision.user_message,
        # Legacy compat
        "workflow": "log-d365-activity" if action == "trigger_workflow" and workflow_type in ACTIVITY_TYPES else (
            "activity-sheet" if action == "trigger_workflow" and workflow_type == "activity_sheet" else None
        ),
        "params": payload,
    }


def _fallback(msg: str) -> Dict[str, Any]:
    return {
        "action": "answer",
        "workflow_type": None,
        "payload": {},
        "clarification_needed": True,
        "user_message": msg,
        "workflow": None,
        "params": {},
    }
