"""
N8N webhook client — Phase 2 (post-beta) only.
N8N is NOT available in the beta release. Direct Dataverse API is used instead.
This module is kept as a stub so server.py can import it cleanly.

When N8N is enabled (self-hosted on Oracle VM), fill in the implementation.
Required env vars (Phase 2): N8N_BASE_URL, N8N_API_KEY
"""
import logging
from typing import Any, Dict

logger = logging.getLogger(__name__)


async def trigger_workflow(workflow_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:  # noqa: ARG001
    """POST to the N8N webhook for workflow_id.

    In beta, all workflows are handled directly in server.py before reaching
    this function. If this is ever called, it means an unhandled workflow_id
    was routed here — return a clean coming-soon response.
    """
    logger.info("trigger_workflow called for %s (N8N not available in beta)", workflow_id)
    return {
        "status": "coming_soon",
        "workflow_id": workflow_id,
        "message": "This workflow is not yet available. Check back soon.",
    }
