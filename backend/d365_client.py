"""
Dynamics 365 Dataverse Web API client.
Direct REST calls using MS access token from microsoft_auth.get_access_token.

Required env vars: D365_ORG_URL (https://{org}.crm.dynamics.com)
"""
import os
import logging
from typing import Any, Dict, List, Optional

import httpx

logger = logging.getLogger(__name__)

D365_ORG_URL = os.environ.get("D365_ORG_URL", "")

_BASE_HEADERS = {
    "OData-MaxVersion": "4.0",
    "OData-Version": "4.0",
    "Accept": "application/json",
    "Content-Type": "application/json",
}


class D365Client:
    def __init__(self, access_token: str):
        self.access_token = access_token
        self._headers = {
            **_BASE_HEADERS,
            "Authorization": f"Bearer {access_token}",
        }

    @property
    def _api_base(self) -> str:
        org_url = D365_ORG_URL or os.environ.get("D365_ORG_URL", "")
        if not org_url:
            raise ValueError("D365_ORG_URL environment variable is not set")
        return f"{org_url.rstrip('/')}/api/data/v9.2"

    async def test_connection(self) -> Dict[str, Any]:
        """Read-only WhoAmI check — confirms auth and org access."""
        async with httpx.AsyncClient() as client:
            r = await client.get(
                f"{self._api_base}/WhoAmI",
                headers=self._headers,
                timeout=10,
            )
        self._raise_for_status(r)
        data = r.json()
        return {
            "connected": True,
            "user_id": data.get("UserId"),
            "org_id": data.get("OrganizationId"),
            "business_unit_id": data.get("BusinessUnitId"),
        }

    async def list_activities(
        self,
        entity_set: str = "phonecalls",
        top: int = 50,
        filter_query: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """Fetch activity records from Dataverse."""
        params: Dict[str, str] = {"$top": str(top)}
        if filter_query:
            params["$filter"] = filter_query

        async with httpx.AsyncClient() as client:
            r = await client.get(
                f"{self._api_base}/{entity_set}",
                headers=self._headers,
                params=params,
                timeout=15,
            )
        self._raise_for_status(r)
        return r.json().get("value", [])

    async def create_activity(
        self,
        entity_set: str,
        payload: Dict[str, Any],
    ) -> Dict[str, Any]:
        """Create a new activity record. Returns the created record or {id}."""
        headers = {**self._headers, "Prefer": "return=representation"}
        async with httpx.AsyncClient() as client:
            r = await client.post(
                f"{self._api_base}/{entity_set}",
                headers=headers,
                json=payload,
                timeout=15,
            )
        self._raise_for_status(r)

        if r.status_code == 204:
            # Server chose not to return body — extract ID from OData header
            odata_id = r.headers.get("OData-EntityId") or r.headers.get("Location", "")
            record_id = odata_id.split("(")[-1].rstrip(")") if "(" in odata_id else ""
            return {"activityid": record_id}

        return r.json()

    async def update_activity(
        self,
        entity_set: str,
        record_id: str,
        payload: Dict[str, Any],
    ) -> None:
        """PATCH an existing activity record."""
        async with httpx.AsyncClient() as client:
            r = await client.patch(
                f"{self._api_base}/{entity_set}({record_id})",
                headers=self._headers,
                json=payload,
                timeout=15,
            )
        self._raise_for_status(r)

    @staticmethod
    async def create_activity_via_webhook(webhook_url: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        """POST activity data to a Power Automate HTTP trigger webhook.

        The Power Automate flow (running inside the Lenovo tenant) receives this
        payload and creates the D365 record — bypassing OAuth consent.

        Expected response: {"activityid": "<guid>"} or 202 Accepted (no body).
        """
        async with httpx.AsyncClient() as client:
            r = await client.post(
                webhook_url,
                json=payload,
                headers={"Content-Type": "application/json"},
                timeout=30.0,
            )
        if r.status_code not in (200, 201, 202):
            raise ValueError(f"Webhook returned {r.status_code}: {r.text[:400]}")
        try:
            data = r.json()
            record_id = data.get("activityid") or data.get("activityId") or data.get("id") or ""
            return {
                "activityid": record_id,
                "_http_status": r.status_code,
                "_raw_response": data,          # full PA response for debug
            }
        except Exception:
            return {
                "activityid": "",
                "_http_status": r.status_code,
                "_raw_response": r.text[:400],  # non-JSON body (e.g. HTML error page)
            }

    # ── internal ──────────────────────────────────────────────────────────

    def _raise_for_status(self, r: httpx.Response) -> None:
        if r.status_code in (200, 201, 204):
            return
        if r.status_code == 401:
            raise ValueError("D365 token expired — re-auth required")
        if r.status_code == 403:
            raise ValueError("D365 access denied — check Dynamics CRM permission in Azure app registration")
        try:
            err_msg = r.json().get("error", {}).get("message", r.text)
        except Exception:
            err_msg = r.text
        raise ValueError(f"D365 API error {r.status_code}: {err_msg}")
