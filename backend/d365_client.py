"""
Dynamics 365 Dataverse Web API client.
Requires a valid MS access token (from microsoft_auth.get_access_token).

Required env vars: D365_ORG_URL (https://{org}.crm.dynamics.com)

TODO: Implement in Phase 4 — after Azure auth is working.
"""
from typing import Any, Dict, List, Optional


class D365Client:
    def __init__(self, access_token: str):
        self.access_token = access_token

    async def test_connection(self) -> Dict[str, Any]:
        """Read-only WhoAmI check — confirms auth works before enabling writes."""
        raise NotImplementedError("Implement in Phase 4")

    async def list_activities(
        self,
        entity_set: str = "phonecalls",
        top: int = 50,
        filter_query: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """Fetch activity records from Dataverse."""
        raise NotImplementedError("Implement in Phase 4")

    async def create_activity(
        self,
        entity_set: str,
        payload: Dict[str, Any],
    ) -> Dict[str, Any]:
        """Create a new activity record. Returns the created record."""
        raise NotImplementedError("Implement in Phase 4")

    async def update_activity(
        self,
        entity_set: str,
        record_id: str,
        payload: Dict[str, Any],
    ) -> None:
        """PATCH an existing activity record."""
        raise NotImplementedError("Implement in Phase 4")
