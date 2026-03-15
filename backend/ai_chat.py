"""
Groq + Llama 3.1 8B chat intent router.
Parses natural language → identifies workflow + extracts params.
Free tier: 14,400 req/day.

Required env vars: GROQ_API_KEY
Optional:         GROQ_MODEL (default: llama-3.1-8b-instant)
"""
import os
import json
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List

from groq import AsyncGroq

logger = logging.getLogger(__name__)

GROQ_MODEL = os.environ.get("GROQ_MODEL", "llama-3.1-8b-instant")

_SYSTEM_PROMPT = """You are a Dynamics 365 sales assistant for a Cisco sales team.
Today's date: {today}

Your job is to extract the user's intent and map it to one of these workflows:

1. log-d365-activity — Log a phone call, task, email, or meeting in Dynamics 365
   Required params: activity_type (phonecall|task|email|appointment), account (string), duration_minutes (integer)
   Optional params: notes (string)

2-6. (coming_soon) sync-emails, search-leads, update-calendar, process-files, alert-notifications

Rules:
- Resolve relative dates ("yesterday", "last Monday") to ISO 8601 using today's date above
- "call" or "phone call" → activity_type = "phonecall"
- "meeting" or "appointment" → activity_type = "appointment"
- "task" or "follow-up" → activity_type = "task"
- "email" → activity_type = "email"
- Default activity_type = "phonecall" when ambiguous
- If the requested workflow is coming soon → workflow = null, clarification_needed = true, explain politely
- If required params are missing → clarification_needed = true, ask specifically for what's missing
- duration_minutes must be an integer (15, 30, 45, 60, 90, 120 are common)
- Keep user_message concise and professional — no emojis

Respond ONLY with valid JSON. No markdown. No explanation outside the JSON.
{
  "workflow": "workflow-id or null",
  "params": {},
  "clarification_needed": false,
  "user_message": "Human-readable response to show the user"
}"""


async def process_message(
    text: str,
    user_id: str,  # reserved for per-user rate limiting in future
    chat_history: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """Route user message to the correct workflow via Groq LLM.

    Returns:
        {workflow, params, clarification_needed, user_message}
    """
    api_key = os.environ.get("GROQ_API_KEY", "")
    if not api_key:
        raise ValueError("GROQ_API_KEY is not set")

    client = AsyncGroq(api_key=api_key)
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    system_content = _SYSTEM_PROMPT.format(today=today)

    messages: List[Dict[str, str]] = [{"role": "system", "content": system_content}]

    # Last 6 messages for context (3 user + 3 assistant turns)
    for msg in chat_history[-6:]:
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
            temperature=0.1,
            max_tokens=512,
        )
        raw = response.choices[0].message.content.strip()

        # Strip markdown code fences if Groq wraps in ```json
        if raw.startswith("```"):
            parts = raw.split("```")
            raw = parts[1] if len(parts) > 1 else raw
            if raw.startswith("json"):
                raw = raw[4:].strip()

        result = json.loads(raw)
        return {
            "workflow": result.get("workflow"),
            "params": result.get("params", {}),
            "clarification_needed": bool(result.get("clarification_needed", False)),
            "user_message": result.get("user_message", "I can help with that."),
        }

    except json.JSONDecodeError:
        logger.warning("Groq returned non-JSON response: %.200s", raw)
        return {
            "workflow": None,
            "params": {},
            "clarification_needed": True,
            "user_message": "I didn't quite understand that. Could you rephrase your request?",
        }
    except Exception as e:
        logger.error("Groq API error: %s", e)
        return {
            "workflow": None,
            "params": {},
            "clarification_needed": True,
            "user_message": "I'm having trouble processing that right now. Please try again in a moment.",
        }
