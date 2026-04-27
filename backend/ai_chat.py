"""
Context-aware Groq + Llama chat layer.

Every request receives a live snapshot of the application state (webhook
status, uploaded files, recent activities, …) which is injected into the
system prompt so the AI can answer questions about the app AND trigger
workflows with real data.

Required env var:  GROQ_API_KEY
Optional env var:  GROQ_MODEL  (default: llama-3.1-8b-instant)
"""
import json
import logging
import os
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from groq import AsyncGroq

logger = logging.getLogger(__name__)

GROQ_MODEL = os.environ.get("GROQ_MODEL", "llama-3.1-8b-instant")


# ─── Dynamic system prompt ────────────────────────────────────────────────────

def build_system_prompt(context: Dict[str, Any], today: str) -> str:
    """Construct the system prompt with live app state embedded."""

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

    return f"""You are a context-aware AI assistant for a Sales Workflow Automation platform used by Cisco sales reps.
Today's date: {today}

LIVE APPLICATION STATE (use this to answer questions — do not guess):
- Webhook: {webhook_line}
- Default Account File: {file_line}
- Total Accounts Cached: {total_acc}
- Cookie Session: {cookie_line}
- Last Activity Created: {last_act_line}
- Recent Workflows:
{recent_lines}

WHAT YOU CAN DO:
1. Answer questions about the application state using the live data above
2. Trigger D365 activity workflows (phone calls, tasks, meetings/appointments)
3. Guide the user to configure connections step by step
4. Report on recent activities, files, and account data

TRIGGERABLE WORKFLOWS:
- phonecall  : requires subject, account, duration_minutes (default 30)
- task       : requires subject, account (start_time optional)
- appointment: requires subject, account, duration_minutes (default 30)

RULES:
- Resolve relative dates ("yesterday", "last Monday") to ISO 8601 using today's date above
- "call" or "phone call" → workflow_type = "phonecall"
- "meeting" or "appointment" → workflow_type = "appointment"
- "task" or "follow-up" → workflow_type = "task"
- duration_minutes must be an integer (15, 30, 45, 60, 90, 120 are common)
- If any required param is missing → action = "answer", clarification_needed = true, ask specifically
- For app-state questions → answer using the LIVE APPLICATION STATE above
- For configuration help → action = "guide", give concise step-by-step instructions
- Be concise, professional, and direct. No emojis. No markdown inside user_message.

ALWAYS respond with valid JSON only. No text outside the JSON block.
{{
  "action": "trigger_workflow | answer | guide",
  "workflow_type": "phonecall | task | appointment | null",
  "payload": {{}},
  "clarification_needed": false,
  "user_message": "Concise human-readable response to show the user"
}}"""


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
    api_key = os.environ.get("GROQ_API_KEY", "")
    if not api_key:
        raise ValueError("GROQ_API_KEY is not set")

    client = AsyncGroq(api_key=api_key)
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
            max_tokens=768,
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
        # Normalise nullish strings
        if workflow_type in (None, "null", ""):
            workflow_type = None

        return {
            "action": action,
            "workflow_type": workflow_type,
            "payload": result.get("payload", {}),
            "clarification_needed": bool(result.get("clarification_needed", False)),
            "user_message": result.get("user_message", "I can help with that."),
            # Legacy compat: keep "workflow" key so existing callers don't break
            "workflow": "log-d365-activity" if action == "trigger_workflow" and workflow_type else None,
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
