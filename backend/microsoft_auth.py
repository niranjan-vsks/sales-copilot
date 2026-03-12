"""
Microsoft Entra ID (Azure AD) authentication via MSAL.
ONE app registration covers: login + D365 Dataverse + Outlook Graph API.

Required env vars:
  AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, AZURE_TENANT_ID, AZURE_REDIRECT_URI
  TOKEN_ENCRYPTION_KEY, SECRET_KEY

TODO: Implement after Azure App Registration is created.
"""
from typing import Tuple


async def get_auth_url() -> Tuple[str, str]:
    """Return (auth_url, state) for Microsoft OAuth login."""
    raise NotImplementedError("Implement in Phase 2 — needs AZURE_* env vars")


async def handle_callback(code: str, db) -> dict:
    """Exchange auth code for tokens, store encrypted, return user info."""
    raise NotImplementedError("Implement in Phase 2 — needs AZURE_* env vars")


async def get_access_token(user_id: str, db) -> str:
    """Return a valid MS access token for the given user_id. Refresh if expired."""
    raise NotImplementedError("Implement in Phase 2 — needs AZURE_* env vars")
