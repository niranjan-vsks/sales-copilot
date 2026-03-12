"""
Groq + Llama 3.1 8B chat intent router.
Parses natural language → identifies workflow + extracts params.
Free tier: 14,400 req/day.

Required env vars: GROQ_API_KEY, GROQ_MODEL (default: llama-3.1-8b-instant)

TODO: Implement in Phase 4 — after GROQ_API_KEY is available.
"""
from typing import Any, Dict, List


async def process_message(
    text: str,
    user_id: str,
    chat_history: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """Route user message to the correct workflow via Groq LLM.

    Returns:
        {workflow, params, clarification_needed, user_message}
    """
    raise NotImplementedError("Implement in Phase 4 — needs GROQ_API_KEY")
