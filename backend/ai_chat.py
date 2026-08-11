"""
Context-aware Groq + Llama chat layer.

Every request receives a live snapshot of the application state (webhook
status, uploaded files, recent activities, …) which is injected into the
system prompt so the AI can answer questions about the app AND trigger
workflows with real data.

Required env var:  GROQ_API_KEY
Optional env var:  GROQ_MODEL  (default: llama-3.1-8b-instant)

Prompts are loaded from the prompts/ directory at startup so they can be
edited without touching Python code.
"""
import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from groq import AsyncGroq

logger = logging.getLogger(__name__)

GROQ_MODEL = os.environ.get("GROQ_MODEL", "llama-3.1-8b-instant")
_PROMPTS_DIR = Path(__file__).parent / "prompts"

_groq_client: Optional[AsyncGroq] = None


def _get_groq_client() -> AsyncGroq:
    global _groq_client
    if _groq_client is None:
        api_key = os.environ.get("GROQ_API_KEY", "")
        if not api_key:
            raise RuntimeError("GROQ_API_KEY is not configured")
        _groq_client = AsyncGroq(api_key=api_key)
    return _groq_client


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
    return (
        template
        .replace("__TODAY__", today)
        .replace("__LIVE_STATE__", live_state)
    )


# ─── Main entry point ─────────────────────────────────────────────────────────

async def process_message(
    text: str,
    user_id: str,
    chat_history: List[Dict[str, Any]],
    context_snapshot: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Send the user message to Groq with live app context.

    Returns:
        {
          action:               "trigger_workflow" | "answer" | "guide"
          workflow_type:        str | None
          payload:              dict
          clarification_needed: bool
          user_message:         str
        }
    """
    client = _get_groq_client()
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

    raw = ""
    try:
        response = await client.chat.completions.create(
            model=GROQ_MODEL,
            messages=messages,
            temperature=0.15,
            max_tokens=1024,
        )
        raw = response.choices[0].message.content.strip()

        # Strip markdown fences if Groq wraps the JSON
        if raw.startswith("```"):
            parts = raw.split("```")
            raw = parts[1] if len(parts) > 1 else raw
            if raw.lower().startswith("json"):
                raw = raw[4:].strip()

        result = json.loads(raw)

        action = result.get("action", "answer")
        workflow_type = result.get("workflow_type")
        if workflow_type in (None, "null", ""):
            workflow_type = None

        return {
            "action": action,
            "workflow_type": workflow_type,
            "payload": result.get("payload", {}),
            "clarification_needed": bool(result.get("clarification_needed", False)),
            "user_message": result.get("user_message", "I can help with that."),
            # Legacy compat
            "workflow": "log-d365-activity" if action == "trigger_workflow" and workflow_type == "appointment" else (
                "activity-sheet" if action == "trigger_workflow" and workflow_type == "activity_sheet" else None
            ),
            "params": result.get("payload", {}),
        }

    except json.JSONDecodeError:
        logger.warning("Groq returned non-JSON: %.300s", raw)
        return _fallback("I didn't quite understand that. Could you rephrase your request?")
    except Exception as exc:
        logger.error("Groq API error: %s", exc)
        return _fallback("I'm having trouble processing that right now. Please try again in a moment.")


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
