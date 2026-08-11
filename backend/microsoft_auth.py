"""
Microsoft Entra ID (Azure AD) authentication via MSAL.
ONE app registration covers: login + D365 Dataverse + Outlook Graph API.

Required env vars:
  AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, AZURE_TENANT_ID, AZURE_REDIRECT_URI
  TOKEN_ENCRYPTION_KEY, SECRET_KEY
"""
import os
import time
import hmac
import hashlib
import json
import logging
from typing import Tuple
from datetime import datetime, timezone

import msal
from cryptography.fernet import Fernet

logger = logging.getLogger(__name__)

# offline_access / openid / profile are RESERVED by MSAL — never pass them manually.
# MSAL adds offline_access automatically to get refresh tokens.
#
# IMPORTANT: Microsoft blocks mixing scopes from different resources (Graph vs D365)
# in a single auth request. We use Graph scopes for login; D365 token is acquired
# separately via get_d365_token() using the cached account + MSAL token cache.
LOGIN_SCOPES = [
    "User.Read",
    "Mail.ReadWrite",
    "Mail.Send",
    "Calendars.ReadWrite",
]

D365_SCOPES = [
    "https://dynamics.microsoft.com/user_impersonation",
]

# Alias kept for any code that imports SCOPES directly
SCOPES = LOGIN_SCOPES


def _fernet() -> Fernet:
    key = os.environ.get("TOKEN_ENCRYPTION_KEY", "")
    if not key:
        raise ValueError("TOKEN_ENCRYPTION_KEY is not set")
    return Fernet(key.encode() if isinstance(key, str) else key)


def _msal_app() -> msal.ConfidentialClientApplication:
    client_id = os.environ.get("AZURE_CLIENT_ID", "")
    client_secret = os.environ.get("AZURE_CLIENT_SECRET", "")
    tenant_id = os.environ.get("AZURE_TENANT_ID", "")
    if not all([client_id, client_secret, tenant_id]):
        raise ValueError("AZURE_CLIENT_ID / AZURE_CLIENT_SECRET / AZURE_TENANT_ID not set")
    # 'common' allows both personal Microsoft accounts (dev/testing) and any Azure AD
    # org account (Lenovo, Cisco, etc.) — required for multi-tenant support.
    # Do NOT lock to tenant_id: that restricts logins to one tenant only.
    return msal.ConfidentialClientApplication(
        client_id=client_id,
        client_credential=client_secret,
        authority="https://login.microsoftonline.com/common",
    )


async def get_auth_url() -> Tuple[str, str]:
    """Return (auth_url, state) for Microsoft OAuth login redirect."""
    secret_key = os.environ.get("SECRET_KEY", "")
    state = hmac.new(
        secret_key.encode(),
        f"{time.time()}".encode(),
        hashlib.sha256,
    ).hexdigest()

    redirect_uri = os.environ.get("AZURE_REDIRECT_URI", "")
    auth_url = _msal_app().get_authorization_request_url(
        scopes=LOGIN_SCOPES,
        state=state,
        redirect_uri=redirect_uri,
    )
    return auth_url, state


async def handle_callback(code: str, db) -> dict:
    """
    Exchange auth code for MS tokens.
    Encrypts tokens with Fernet and stores in ms_tokens collection.
    Returns {email, name, ms_user_id}.
    """
    redirect_uri = os.environ.get("AZURE_REDIRECT_URI", "")
    result = _msal_app().acquire_token_by_authorization_code(
        code=code,
        scopes=LOGIN_SCOPES,
        redirect_uri=redirect_uri,
    )

    if "error" in result:
        detail = result.get("error_description") or result.get("error", "unknown")
        raise ValueError(f"MSAL token exchange failed: {detail}")

    claims = result.get("id_token_claims") or {}
    email = (
        claims.get("preferred_username")
        or claims.get("upn")
        or claims.get("email")
        or ""
    )
    name = claims.get("name") or email.split("@")[0]
    ms_user_id = claims.get("oid") or claims.get("sub") or ""

    token_payload = json.dumps({
        "access_token": result.get("access_token"),
        "refresh_token": result.get("refresh_token"),
        "expires_on": int(time.time()) + result.get("expires_in", 3600),
        "scopes": result.get("scope", "").split(),
    })
    encrypted = _fernet().encrypt(token_payload.encode()).decode()

    await db.ms_tokens.update_one(
        {"ms_user_id": ms_user_id},
        {
            "$set": {
                "ms_user_id": ms_user_id,
                "email": email,
                "encrypted_token": encrypted,
                "scopes": LOGIN_SCOPES,
                "updated_at": datetime.now(timezone.utc),
            }
        },
        upsert=True,
    )

    logger.info("MS tokens stored for %s", email)
    return {"email": email, "name": name, "ms_user_id": ms_user_id}


async def get_access_token(user_id: str, db) -> str:
    """
    Return a valid MS access token for user_id.
    Decrypts cached token; silently refreshes via MSAL if within 5-min expiry window.
    """
    user_doc = await db.users.find_one({"user_id": user_id}, {"_id": 0, "email": 1})
    if not user_doc:
        raise ValueError(f"User {user_id} not found")

    token_doc = await db.ms_tokens.find_one(
        {"email": user_doc["email"]}, {"_id": 0}
    )
    if not token_doc:
        raise ValueError(
            f"No MS token for user {user_id} — user must re-authenticate"
        )

    fernet = _fernet()
    token_data = json.loads(fernet.decrypt(token_doc["encrypted_token"].encode()))

    # Return cached token if still valid (5-min buffer)
    if token_data.get("expires_on", 0) > time.time() + 300:
        return token_data["access_token"]

    # Silent refresh via refresh token
    refresh_token = token_data.get("refresh_token")
    if not refresh_token:
        raise ValueError(
            f"No refresh token for user {user_id} — user must re-authenticate"
        )

    refreshed = _msal_app().acquire_token_by_refresh_token(
        refresh_token=refresh_token,
        scopes=LOGIN_SCOPES,
    )

    if "error" in refreshed:
        detail = refreshed.get("error_description") or refreshed.get("error", "unknown")
        raise ValueError(f"Token refresh failed for {user_id}: {detail}")

    new_payload = json.dumps({
        "access_token": refreshed.get("access_token"),
        "refresh_token": refreshed.get("refresh_token") or refresh_token,
        "expires_on": int(time.time()) + refreshed.get("expires_in", 3600),
        "scopes": refreshed.get("scope", "").split(),
    })
    new_encrypted = fernet.encrypt(new_payload.encode()).decode()

    await db.ms_tokens.update_one(
        {"ms_user_id": token_doc["ms_user_id"]},
        {
            "$set": {
                "encrypted_token": new_encrypted,
                "updated_at": datetime.now(timezone.utc),
            }
        },
    )

    logger.info("MS token silently refreshed for user %s", user_id)
    return refreshed["access_token"]


async def get_d365_token(user_id: str, db) -> str:
    """
    Return a valid D365 Dataverse access token.
    Uses the stored refresh token to acquire a D365-scoped token via MSAL.

    Requires that 'Dynamics CRM > user_impersonation' delegated permission is
    added and admin-consented in the Azure App Registration.
    Raises ValueError with a clear message if consent is missing.
    """
    user_doc = await db.users.find_one({"user_id": user_id}, {"_id": 0, "email": 1})
    if not user_doc:
        raise ValueError(f"User {user_id} not found")

    token_doc = await db.ms_tokens.find_one(
        {"email": user_doc["email"]}, {"_id": 0}
    )
    if not token_doc:
        raise ValueError(
            f"No MS token for user {user_id} — user must re-authenticate"
        )

    fernet = _fernet()
    token_data = json.loads(fernet.decrypt(token_doc["encrypted_token"].encode()))

    refresh_token = token_data.get("refresh_token")
    if not refresh_token:
        raise ValueError(
            f"No refresh token for user {user_id} — user must re-authenticate"
        )

    result = _msal_app().acquire_token_by_refresh_token(
        refresh_token=refresh_token,
        scopes=D365_SCOPES,
    )

    if "error" in result:
        detail = result.get("error_description") or result.get("error", "unknown")
        if "AADSTS500011" in detail or "resource" in detail.lower():
            raise ValueError(
                "D365 permission not configured. In Azure portal → App Registration → "
                "API permissions → Add 'Dynamics CRM > user_impersonation' (Delegated) "
                "and grant admin consent."
            )
        raise ValueError(f"D365 token acquisition failed: {detail}")

    logger.info("D365 token acquired for user %s", user_id)
    return result["access_token"]
