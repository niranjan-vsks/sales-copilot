"""
N8N webhook client — triggers workflows on niranjan-vsks9.app.n8n.cloud.

Required env vars: N8N_BASE_URL, N8N_API_KEY

TODO: Implement in Phase 3 — after N8N workflows are built via MCP.
"""
from typing import Any, Dict


async def trigger_workflow(workflow_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    """POST to the N8N webhook for workflow_id. Returns N8N response JSON."""
    raise NotImplementedError("Implement in Phase 3 — needs N8N workflows built first")
