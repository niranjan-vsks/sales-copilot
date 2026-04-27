"""
D365 browser cookie session manager.

Workflow:
  1. Colleague logs into D365 in Chrome normally (no external app consent needed).
  2. They export cookies via the Cookie-Editor extension → copies JSON to clipboard.
  3. Admin pastes JSON into Admin → Connections → Browser Session card.
  4. We encrypt + store in MongoDB bot_config.
  5. When OAuth is unavailable, this module launches a headless Chromium,
     injects those cookies, loads D365, and extracts the Bearer token from
     MSAL's localStorage cache — then hands it to D365Client for direct API calls.

Requirements (install once on the server):
  pip install playwright
  playwright install chromium
"""
import json
import logging
import os
from datetime import datetime, timezone
from typing import Optional

from cryptography.fernet import Fernet

logger = logging.getLogger(__name__)

_TOKEN_ENCRYPTION_KEY = os.environ.get("TOKEN_ENCRYPTION_KEY", "")
_D365_ORG_URL = os.environ.get("D365_ORG_URL", "")


def _fernet() -> Fernet:
    key = _TOKEN_ENCRYPTION_KEY
    if isinstance(key, str):
        key = key.encode()
    return Fernet(key)


async def save_cookies(cookies_json: str, db) -> None:
    """Validate, encrypt, and persist browser cookies in bot_config."""
    try:
        parsed = json.loads(cookies_json)
        if not isinstance(parsed, list):
            raise ValueError("Cookies must be a JSON array")
        if len(parsed) == 0:
            raise ValueError("Cookies array is empty")
    except (json.JSONDecodeError, ValueError) as exc:
        raise ValueError(f"Invalid cookies JSON: {exc}") from exc

    encrypted = _fernet().encrypt(cookies_json.encode()).decode()
    await db.bot_config.update_one(
        {"_id": "config"},
        {
            "$set": {
                "d365_browser_cookies_enc": encrypted,
                "d365_browser_cookies_saved_at": datetime.now(timezone.utc).isoformat(),
            }
        },
        upsert=True,
    )
    logger.info("D365 browser cookies saved (encrypted, %d cookies)", len(parsed))


async def get_status(db) -> dict:
    """Return whether cookies are stored and when they were last saved."""
    config = await db.bot_config.find_one({"_id": "config"})
    cfg = config or {}
    return {
        "configured": bool(cfg.get("d365_browser_cookies_enc")),
        "last_saved": cfg.get("d365_browser_cookies_saved_at"),
    }


async def get_d365_token_from_cookies(db) -> Optional[str]:
    """
    Inject stored cookies into a headless Chromium, load D365, and extract
    the MSAL Bearer token from localStorage.

    Returns the access token string, or None if extraction fails.
    Raises ImportError if Playwright is not installed.
    """
    from playwright.async_api import async_playwright  # noqa: PLC0415 (lazy import)

    config = await db.bot_config.find_one({"_id": "config"})
    if not config or not config.get("d365_browser_cookies_enc"):
        logger.warning("Browser cookie path: no cookies stored")
        return None

    org_url = _D365_ORG_URL or os.environ.get("D365_ORG_URL", "")
    if not org_url:
        raise ValueError("D365_ORG_URL not configured — cannot use browser cookie path")

    # Decrypt stored cookies
    raw_json = _fernet().decrypt(config["d365_browser_cookies_enc"].encode()).decode()
    raw_cookies = json.loads(raw_json)

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        try:
            context = await browser.new_context()

            # Convert Cookie-Editor format → Playwright format
            playwright_cookies = []
            for c in raw_cookies:
                cookie: dict = {
                    "name": c.get("name", ""),
                    "value": c.get("value", ""),
                    "domain": c.get("domain", ""),
                    "path": c.get("path", "/"),
                    "httpOnly": c.get("httpOnly", False),
                    "secure": c.get("secure", True),
                }
                if c.get("expirationDate"):
                    cookie["expires"] = float(c["expirationDate"])
                playwright_cookies.append(cookie)

            await context.add_cookies(playwright_cookies)
            page = await context.new_page()

            await page.goto(org_url.rstrip("/"), wait_until="domcontentloaded", timeout=25000)
            # Give MSAL time to hydrate the token cache from localStorage
            await page.wait_for_timeout(4000)

            # MSAL stores access tokens in localStorage with keys like:
            # "<clientId>.<tenantId>-login.windows.net-accesstoken-<clientId>-<tenantId>-<scope>--"
            # We look for any entry that covers the Dynamics / Dataverse scope.
            token: Optional[str] = await page.evaluate(
                """() => {
                    const keys = Object.keys(localStorage);
                    const tokenKey = keys.find(k =>
                        k.includes('accesstoken') &&
                        (k.includes('dynamics') || k.includes('crm') || k.includes('dataverse'))
                    );
                    if (!tokenKey) return null;
                    try {
                        const entry = JSON.parse(localStorage.getItem(tokenKey));
                        return entry.secret || null;
                    } catch (e) {
                        return null;
                    }
                }"""
            )

            if token:
                logger.info("D365 Bearer token extracted from browser cookie session")
            else:
                logger.warning(
                    "Browser session loaded but no D365-scoped token found in localStorage"
                )
            return token
        finally:
            await browser.close()
