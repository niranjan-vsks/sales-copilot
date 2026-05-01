from fastapi import FastAPI, APIRouter, HTTPException, Request, Response, UploadFile, File  # noqa: F401
from fastapi.responses import RedirectResponse, FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo.errors import ServerSelectionTimeoutError, PyMongoError
import os
import re
import logging
import secrets
from pathlib import Path
from pydantic import BaseModel, ConfigDict
from typing import Optional, Dict, Any, List
import uuid
import asyncio
from datetime import datetime, timezone, timedelta

# Logging configured first — before any module-level loggers fire
from log_config import setup_logging
setup_logging()

# Sales Copilot modules
from microsoft_auth import get_auth_url, handle_callback, get_access_token, get_d365_token
from n8n_client import trigger_workflow
from ai_chat import process_message
from d365_client import D365Client
from excel_processor import parse_file, detect_account_columns
from knowledge_base import KnowledgeBaseService

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR.parent / '.env')

# MongoDB
import certifi as _certifi
mongo_url = os.environ['MONGO_URL']
_mongo_client = AsyncIOMotorClient(mongo_url, tlsCAFile=_certifi.where())
db = _mongo_client[os.environ.get('DB_NAME', 'sales_copilot')]
kb = KnowledgeBaseService(db)

app = FastAPI(title="Sales Copilot API")
api_router = APIRouter(prefix="/api")

logger = logging.getLogger(__name__)

SESSION_EXPIRY_DAYS = 7
INTERNAL_KEY = os.environ.get('INTERNAL_KEY', '')
FRONTEND_URL = os.environ.get('FRONTEND_URL', '')
D365_ORG_URL = os.environ.get('D365_ORG_URL', '')
APP_ENV = os.environ.get('APP_ENVIRONMENT', 'prod')  # 'dev' | 'prod'

# In dev mode the React build is served from the backend itself (one port, no CORS).
# In prod the React app is deployed as a separate Render static site.
FRONTEND_BUILD_DIR = ROOT_DIR.parent / "frontend" / "build"

_D365_ENTITY_MAP = {
    "phonecall":   "phonecalls",
    "task":        "tasks",
    "email":       "emails",
    "appointment": "appointments",
}
_D365_SUBJECT_PREFIX = {
    "phonecall":   "Call",
    "task":        "Task",
    "email":       "Email",
    "appointment": "Meeting",
}
# statecode/statuscode for "Completed" per activity type.
# These values are fixed by D365 — do not change them.
# Emails are created as Draft (default) — no status override.
_D365_COMPLETED_STATUS = {
    "phonecall":   {"statecode": 1, "statuscode": 4},
    "task":        {"statecode": 1, "statuscode": 5},
    "appointment": {"statecode": 3, "statuscode": 4},
}


# ============== Pydantic Models ==============

class User(BaseModel):
    model_config = ConfigDict(extra="ignore")
    user_id: str
    email: str
    name: str
    picture: Optional[str] = None
    role: str = "rep"
    created_at: Optional[datetime] = None


class WorkflowExecuteRequest(BaseModel):
    workflow_id: str
    params: Dict[str, Any] = {}


class ChatRequest(BaseModel):
    message: str


class TeamMemberRequest(BaseModel):
    email: str
    display_name: str
    role: str = "rep"


class SettingsUpdateRequest(BaseModel):
    d365_org_url: Optional[str] = None
    groq_model: Optional[str] = None
    n8n_base_url: Optional[str] = None
    dry_run_mode: Optional[bool] = None


class WebhookUrlRequest(BaseModel):
    url: str


class BrowserCookiesRequest(BaseModel):
    cookies_json: str


# ============== Auth Helpers ==============

async def get_current_user(request: Request) -> Optional[User]:
    session_token = request.cookies.get("session_token")
    if not session_token:
        auth_header = request.headers.get("Authorization")
        if auth_header and auth_header.startswith("Bearer "):
            session_token = auth_header.split(" ")[1]
    if not session_token:
        return None

    try:
        session_doc = await db.user_sessions.find_one(
            {"session_token": session_token}, {"_id": 0}
        )
        if not session_doc:
            return None

        expires_at = session_doc.get("expires_at")
        if isinstance(expires_at, str):
            expires_at = datetime.fromisoformat(expires_at)
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if expires_at < datetime.now(timezone.utc):
            return None

        user_doc = await db.users.find_one(
            {"user_id": session_doc["user_id"]}, {"_id": 0}
        )
        if not user_doc:
            return None
        return User(**user_doc)
    except (ServerSelectionTimeoutError, PyMongoError) as e:
        logger.error(f"MongoDB unavailable in get_current_user: {e}")
        raise HTTPException(status_code=503, detail="Database unavailable. Check MongoDB Atlas IP whitelist.")


async def require_auth(request: Request) -> User:
    user = await get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user


async def require_admin(request: Request) -> User:
    user = await require_auth(request)
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


# ============== Cookie helpers ==============

def _cookie_sec() -> dict:
    """
    Return cookie security kwargs.
    dev  (HTTP localhost): secure=False, samesite=lax — browsers refuse Secure cookies on HTTP
    prod (HTTPS Render):   secure=True,  samesite=none — required for cross-origin cookie delivery
    """
    if APP_ENV == 'dev':
        return {"httponly": True, "secure": False, "samesite": "lax"}
    return {"httponly": True, "secure": True, "samesite": "none"}


# ============== Auth Routes ==============

@api_router.get("/auth/microsoft")
async def microsoft_login():
    """Redirect to Microsoft Entra ID login"""
    auth_url, state = await get_auth_url()
    response = RedirectResponse(url=auth_url)
    response.set_cookie("oauth_state", state, max_age=600, **_cookie_sec())
    return response


@api_router.get("/auth/microsoft/callback")
async def microsoft_callback(request: Request):
    """Exchange auth code for tokens, create session, redirect to frontend"""
    code = request.query_params.get("code")
    state = request.query_params.get("state")
    stored_state = request.cookies.get("oauth_state")

    if not code:
        raise HTTPException(status_code=400, detail="Missing authorization code")
    if not state or state != stored_state:
        raise HTTPException(status_code=400, detail="Invalid OAuth state — possible CSRF")

    try:
        user_info = await handle_callback(code, db)
    except Exception as e:
        logger.error(f"Microsoft callback error: {e}")
        raise HTTPException(status_code=401, detail="Authentication failed")

    email = user_info["email"]
    name = user_info.get("name", email.split("@")[0])

    # First admin auto-provisioning: if no admins exist, first login becomes admin
    admin_count = await db.authorized_users.count_documents({"role": "admin"})
    auth_user = await db.authorized_users.find_one({"email": email})

    if not auth_user:
        if admin_count == 0:
            role = "admin"
            await db.authorized_users.insert_one({
                "email": email,
                "display_name": name,
                "role": "admin",
                "added_by": "system",
                "added_at": datetime.now(timezone.utc)
            })
        else:
            raise HTTPException(
                status_code=403,
                detail="Access denied. Ask your admin to add you to the team."
            )
    else:
        role = auth_user.get("role", "rep")

    # Upsert user document
    existing = await db.users.find_one({"email": email}, {"_id": 0})
    if existing:
        user_id = existing["user_id"]
        await db.users.update_one(
            {"user_id": user_id},
            {"$set": {"name": name, "role": role}}
        )
    else:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        await db.users.insert_one({
            "user_id": user_id,
            "email": email,
            "name": name,
            "role": role,
            "picture": user_info.get("picture"),
            "created_at": datetime.now(timezone.utc)
        })

    # Create session
    session_token = secrets.token_hex(32)
    expires_at = datetime.now(timezone.utc) + timedelta(days=SESSION_EXPIRY_DAYS)
    await db.user_sessions.insert_one({
        "user_id": user_id,
        "session_token": session_token,
        "expires_at": expires_at,
        "created_at": datetime.now(timezone.utc)
    })

    redirect_url = f"{FRONTEND_URL}/#/dashboard" if FRONTEND_URL else "/#/dashboard"
    redirect = RedirectResponse(url=redirect_url)
    redirect.set_cookie(
        "session_token", session_token,
        path="/", max_age=SESSION_EXPIRY_DAYS * 24 * 60 * 60,
        **_cookie_sec()
    )
    redirect.delete_cookie("oauth_state", **_cookie_sec())
    return redirect


@api_router.get("/auth/me")
async def get_me(request: Request):
    user = await get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user.model_dump(exclude={"created_at"})


@api_router.post("/auth/logout")
async def logout(request: Request, response: Response):
    session_token = request.cookies.get("session_token")
    if session_token:
        await db.user_sessions.delete_one({"session_token": session_token})
    response.delete_cookie("session_token", path="/", **_cookie_sec())
    return {"ok": True}


# ── Dev / Demo Login ─────────────────────────────────────────────
@api_router.get("/auth/dev-login/check")
async def dev_login_check():
    enabled = os.getenv("DEV_LOGIN_ENABLED", "false").lower() == "true"
    return {"success": True, "data": {"enabled": enabled}, "error": None}


class DevLoginRequest(BaseModel):
    username: str
    password: str


@api_router.post("/auth/dev-login")
async def dev_login(body: DevLoginRequest):
    if os.getenv("DEV_LOGIN_ENABLED", "false").lower() != "true":
        raise HTTPException(status_code=404, detail="Not found")

    expected_user = os.getenv("DEV_LOGIN_USER", "")
    expected_pass = os.getenv("DEV_LOGIN_PASS", "")

    if not expected_user or not expected_pass:
        raise HTTPException(status_code=503, detail="Dev login not configured")

    if body.username != expected_user or body.password != expected_pass:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    session_token = secrets.token_hex(32)
    await db.users.update_one(
        {"user_id": "dev-user"},
        {"$set": {
            "user_id": "dev-user",
            "email": "demo@moltbot.dev",
            "name": "Demo User",
            "role": "admin",
            "created_at": datetime.now(timezone.utc),
        }},
        upsert=True,
    )
    await db.user_sessions.update_one(
        {"user_id": "dev-user"},
        {"$set": {
            "user_id": "dev-user",
            "session_token": session_token,
            "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
            "created_at": datetime.now(timezone.utc),
        }},
        upsert=True,
    )

    resp = JSONResponse({"success": True, "data": {"name": "Demo User"}, "error": None})
    cookie_opts = _cookie_sec()
    resp.set_cookie("session_token", session_token, path="/", max_age=604800, **cookie_opts)
    return resp


@api_router.post("/auth/token-for-n8n")
async def token_for_n8n(request: Request):
    """Called by N8N to get a fresh MS access token on behalf of a user"""
    key = request.headers.get("X-Internal-Key")
    if not INTERNAL_KEY or key != INTERNAL_KEY:
        raise HTTPException(status_code=403, detail="Invalid internal key")
    body = await request.json()
    user_id = body.get("user_id")
    if not user_id:
        raise HTTPException(status_code=400, detail="user_id required")
    try:
        access_token = await get_access_token(user_id, db)
        return {"access_token": access_token}
    except Exception as e:
        logger.error(f"Token retrieval error for {user_id}: {e}")
        raise HTTPException(status_code=401, detail="Could not retrieve access token")


# ============== D365 Activity Helper ==============

def _build_record_url(entity_set: str, record_id: str) -> Optional[str]:
    if not record_id or not D365_ORG_URL:
        return None
    entity_name = entity_set.rstrip("s")  # phonecalls → phonecall
    return f"{D365_ORG_URL}/main.aspx?etn={entity_name}&id={record_id}&pagetype=entityrecord"


async def _execute_d365_activity(user: User, params: Dict[str, Any]) -> Dict[str, Any]:
    """Create a D365 activity using the first available connection path.

    Priority:
      1. OAuth token   — normal path for consented users
      2. Power Automate webhook — bypasses tenant OAuth consent
      3. Browser cookie session — Playwright headless token extraction
    """
    activity_type = params.get("activity_type", "phonecall")
    entity_set = _D365_ENTITY_MAP.get(activity_type, "phonecalls")
    account = params.get("account", "")
    duration = int(params.get("duration_minutes", 30))
    notes = params.get("notes", "")

    # Use explicit subject if provided; fall back to auto-generated
    subject = params.get("subject") or (
        f"{_D365_SUBJECT_PREFIX.get(activity_type, 'Activity')} with {account}"
        if account else _D365_SUBJECT_PREFIX.get(activity_type, "Activity")
    )

    payload: Dict[str, Any] = {
        "subject": subject,
        "actualdurationminutes": duration,
        "description": notes,
    }
    if params.get("start_time"):
        # Ensure ISO 8601 with seconds and Z suffix (D365 Dataverse requires UTC format)
        st = params["start_time"]
        if len(st) == 16:   # "2026-04-09T12:00" → add :00Z
            st = st + ":00Z"
        elif not st.endswith("Z") and "+" not in st:
            st = st + "Z"
        payload["scheduledstart"] = st
    if params.get("location"):
        payload["location"] = params["location"]
    if params.get("teams_meeting"):
        payload["isonlinemeeting"] = True

    if activity_type in _D365_COMPLETED_STATUS:
        payload.update(_D365_COMPLETED_STATUS[activity_type])

    # ── Path 1: OAuth token (standard path) ──────────────────────────────
    try:
        access_token = await get_d365_token(user.user_id, db)
        d365 = D365Client(access_token)
        record = await d365.create_activity(entity_set, payload)
        record_id = record.get("activityid") or record.get("id", "")
        logger.info("D365 activity created via OAuth for %s", user.email)
        return {
            "status": "success",
            "d365_record_id": record_id,
            "record_url": _build_record_url(entity_set, record_id),
            "entity_set": entity_set,
            "method": "oauth",
        }
    except Exception as oauth_err:
        logger.warning("OAuth D365 path failed for %s: %s — trying fallbacks", user.email, oauth_err)

    # ── Path 2: Power Automate webhook ────────────────────────────────────
    config = await db.bot_config.find_one({"_id": "config"})
    webhook_url = (config or {}).get("power_automate_webhook_url", "")
    if webhook_url:
        try:
            webhook_payload = {
                **payload,
                "activity_type": activity_type,
                "account": account,
                "activity_sub_type": params.get("activity_sub_type", ""),
                "primary_attendee": params.get("primary_attendee", ""),
                "other_attendees": params.get("other_attendees", ""),
                "business_partner": params.get("business_partner", ""),
                "customer_attendee": params.get("customer_attendee", ""),
                "action_owners": params.get("action_owners", ""),
                "partner_attendee": params.get("partner_attendee", ""),
                "teams_meeting": bool(params.get("teams_meeting", False)),
                "start_time": params.get("start_time", ""),
                "mdm_id": params.get("mdm_id", ""),
            }
            record = await D365Client.create_activity_via_webhook(webhook_url, webhook_payload)
            record_id = record.get("activityid", "")
            # "success" only when D365 confirms the record with an ID.
            # "pending" = webhook accepted but no record ID returned.
            status = "success" if record_id else "pending"
            logger.info("D365 activity via webhook for %s — status: %s", user.email, status)
            if not record_id:
                logger.warning(
                    "Webhook accepted (HTTP %s) but returned no activityid. PA response: %s",
                    record.get("_http_status"), record.get("_raw_response"),
                )
            return {
                "status": status,
                "d365_record_id": record_id,
                "record_url": _build_record_url(entity_set, record_id),
                "entity_set": entity_set,
                "method": "webhook",
                "webhook_http_status": record.get("_http_status"),
                "webhook_raw_response": record.get("_raw_response"),
                "pending_reason": (
                    None if record_id
                    else 'Webhook accepted. Update your Power Automate HTTP Response action to return {"activityid": "<guid>"} for D365 confirmation.'
                ),
            }
        except Exception as webhook_err:
            logger.warning("Webhook path failed: %s — trying browser session", webhook_err)

    # ── Path 3: Browser cookie session ────────────────────────────────────
    try:
        from d365_browser import get_d365_token_from_cookies  # noqa: PLC0415
        browser_token = await get_d365_token_from_cookies(db)
        if browser_token:
            d365 = D365Client(browser_token)
            record = await d365.create_activity(entity_set, payload)
            record_id = record.get("activityid") or record.get("id", "")
            logger.info("D365 activity created via browser cookie session for %s", user.email)
            return {
                "status": "success",
                "d365_record_id": record_id,
                "record_url": _build_record_url(entity_set, record_id),
                "entity_set": entity_set,
                "method": "browser",
            }
    except ImportError:
        logger.warning("Playwright not installed — browser cookie path unavailable")
    except Exception as browser_err:
        logger.warning("Browser cookie path failed: %s", browser_err)

    # ── All paths failed ──────────────────────────────────────────────────
    raise HTTPException(
        status_code=503,
        detail=(
            "D365 connection unavailable. "
            "Configure Power Automate webhook or browser cookies in Admin → Connections."
        ),
    )


# ============== Workflow Routes ==============

DEFAULT_WORKFLOWS = [
    {"id": "log-d365-activity",    "name": "Log D365 Activity",    "description": "Auto-create phone calls, tasks and interactions directly in Dynamics 365.", "status": "live",        "icon_name": "ClipboardList"},
    {"id": "sync-emails",          "name": "Sync Emails",          "description": "Sync Outlook emails with D365 contact records automatically.",               "status": "coming_soon", "icon_name": "Mail"},
    {"id": "search-leads",         "name": "Search Leads",         "description": "Find qualified leads using AI-powered prospecting.",                         "status": "coming_soon", "icon_name": "Search"},
    {"id": "update-calendar",      "name": "Update Calendar",      "description": "Sync meetings between Outlook Calendar and D365.",                           "status": "coming_soon", "icon_name": "Calendar"},
    {"id": "process-files",        "name": "Process Files",        "description": "Extract and log data from uploaded documents.",                              "status": "coming_soon", "icon_name": "FileText"},
    {"id": "alert-notifications",  "name": "Alert Notifications",  "description": "Get notified of key CRM events and opportunities.",                          "status": "coming_soon", "icon_name": "Bell"},
]


@api_router.get("/workflows/list")
async def list_workflows(request: Request):
    await require_auth(request)
    config = await db.bot_config.find_one({"_id": "config"})
    if config and config.get("workflows"):
        return config["workflows"]
    return DEFAULT_WORKFLOWS


@api_router.post("/workflows/execute")
async def execute_workflow(body: WorkflowExecuteRequest, request: Request):
    user = await require_auth(request)
    execution_id = str(uuid.uuid4())

    await db.workflow_executions.insert_one({
        "id": execution_id,
        "user_id": user.user_id,
        "workflow_id": body.workflow_id,
        "params": body.params,
        "status": "pending",
        "created_at": datetime.now(timezone.utc)
    })

    try:
        if body.workflow_id == "log-d365-activity":
            result = await _execute_d365_activity(user, body.params)
        else:
            result = await trigger_workflow(
                workflow_id=body.workflow_id,
                payload={**body.params, "user_id": user.user_id, "execution_id": execution_id},
            )

        await db.workflow_executions.update_one(
            {"id": execution_id},
            {"$set": {
                "status": result.get("status", "success"),
                "result": result,
                "d365_record_id": result.get("d365_record_id"),
                "duration_ms": result.get("duration_ms"),
                "completed_at": datetime.now(timezone.utc),
            }},
        )
        # Write to knowledge base (fire-and-forget)
        if body.workflow_id == "log-d365-activity":
            act_type = body.params.get("activity_type", "activity")
            account = body.params.get("account", "")
            subject = body.params.get("subject", "")
            kb.fire(
                user_id=user.user_id,
                event_type="d365_activity_created",
                event_summary=(
                    f"{act_type.capitalize()} logged for {account}: \"{subject}\" "
                    f"[{result.get('status', 'unknown')}] on {datetime.now(timezone.utc).strftime('%B %d')}"
                ),
                metadata={
                    "activity_type": act_type,
                    "account": account,
                    "subject": subject,
                    "status": result.get("status"),
                    "record_id": result.get("d365_record_id", ""),
                    "record_url": result.get("record_url", ""),
                },
            )

        return {
            "execution_id": execution_id,
            "status": result.get("status", "success"),
            "result": result,
            "d365_record_url": result.get("record_url"),
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Workflow execution error: {e}")
        await db.workflow_executions.update_one(
            {"id": execution_id},
            {"$set": {"status": "failed", "error_message": str(e)}},
        )
        raise HTTPException(status_code=500, detail=str(e))


@api_router.get("/workflows/executions")
async def get_executions(
    request: Request,
    page: int = 1,
    limit: int = 20,
    workflow_id: Optional[str] = None,
    status: Optional[str] = None
):
    user = await require_auth(request)
    query: Dict[str, Any] = {}
    if user.role != "admin":
        query["user_id"] = user.user_id
    if workflow_id:
        query["workflow_id"] = workflow_id
    if status:
        query["status"] = status

    total = await db.workflow_executions.count_documents(query)
    items = await db.workflow_executions.find(query, {"_id": 0}) \
        .sort("created_at", -1) \
        .skip((page - 1) * limit) \
        .limit(limit) \
        .to_list(limit)

    for item in items:
        for key in ("created_at", "completed_at"):
            if isinstance(item.get(key), datetime):
                item[key] = item[key].isoformat()

    return {"items": items, "total": total, "page": page, "pages": max(1, -(-total // limit))}


# ============== Chat Routes ==============

@api_router.post("/chat")
async def chat(body: ChatRequest, request: Request):
    user = await require_auth(request)

    # Fetch last 10 messages for conversational memory
    history_docs = await db.chat_history.find(
        {"user_id": user.user_id},
        {"_id": 0, "role": 1, "content": 1}
    ).sort("created_at", -1).limit(10).to_list(10)
    history_docs.reverse()

    msg_id = str(uuid.uuid4())
    await db.chat_history.insert_one({
        "id": msg_id,
        "user_id": user.user_id,
        "role": "user",
        "content": body.message,
        "created_at": datetime.now(timezone.utc)
    })

    # Build live app context for the AI
    try:
        context_snapshot = await kb.get_app_context_snapshot(user.user_id)
    except Exception as ctx_err:
        logger.warning("Failed to build context snapshot: %s", ctx_err)
        context_snapshot = {}

    try:
        ai_response = await process_message(
            body.message, user.user_id, history_docs,
            context_snapshot=context_snapshot,
        )
    except Exception as e:
        logger.error(f"AI processing error: {e}")
        raise HTTPException(status_code=500, detail="AI processing failed")

    # Execute workflow if the AI decided to trigger one
    workflow_result = None
    action = ai_response.get("action", "answer")
    workflow_type = ai_response.get("workflow_type")

    if action == "trigger_workflow" and workflow_type and not ai_response.get("clarification_needed"):
        params = {**ai_response.get("payload", {}), "activity_type": workflow_type}

        # Look up MDM ID for the account so the PA webhook can link Regarding correctly
        account_name = params.get("account", "")
        if account_name and not params.get("mdm_id"):
            default_file = await db.uploaded_files.find_one(
                {"user_id": user.user_id, "is_default": True}, {"file_id": 1}
            )
            if default_file:
                escaped = re.escape(account_name)
                acc_doc = await db.user_account_data.find_one(
                    {
                        "user_id": user.user_id,
                        "file_id": default_file["file_id"],
                        "account_name": {"$regex": f"^{escaped}$", "$options": "i"},
                    },
                    {"l2_mdm_id_idg": 1, "_id": 0},
                )
                if not acc_doc:
                    acc_doc = await db.user_account_data.find_one(
                        {
                            "user_id": user.user_id,
                            "file_id": default_file["file_id"],
                            "account_name": {"$regex": escaped, "$options": "i"},
                        },
                        {"l2_mdm_id_idg": 1, "_id": 0},
                    )
                if acc_doc and acc_doc.get("l2_mdm_id_idg"):
                    params["mdm_id"] = acc_doc["l2_mdm_id_idg"]

        try:
            workflow_result = await _execute_d365_activity(user, params)
            # Log to knowledge base
            account = params.get("account", "")
            subject = params.get("subject", "")
            kb.fire(
                user_id=user.user_id,
                event_type="d365_activity_created",
                event_summary=(
                    f"{workflow_type.capitalize()} logged for {account}: \"{subject}\" "
                    f"[{workflow_result.get('status', 'unknown')}] via AI chat on "
                    f"{datetime.now(timezone.utc).strftime('%B %d')}"
                ),
                metadata={
                    "activity_type": workflow_type,
                    "account": account,
                    "subject": subject,
                    "status": workflow_result.get("status"),
                    "record_id": workflow_result.get("d365_record_id", ""),
                    "record_url": workflow_result.get("record_url", ""),
                    "source": "chat",
                },
            )
        except Exception as e:
            logger.warning(f"Chat workflow trigger failed: {e}")
            workflow_result = {"status": "failed", "error": str(e)}

    # Store assistant message
    await db.chat_history.insert_one({
        "id": str(uuid.uuid4()),
        "user_id": user.user_id,
        "role": "assistant",
        "content": ai_response.get("user_message", ""),
        "workflow_triggered": workflow_type if action == "trigger_workflow" else None,
        "workflow_result": workflow_result,
        "created_at": datetime.now(timezone.utc)
    })

    return {
        "user_message_id": msg_id,
        "action": action,
        "workflow_triggered": workflow_type if action == "trigger_workflow" else None,
        "workflow_result": workflow_result,
        "clarification_needed": ai_response.get("clarification_needed"),
        "message": ai_response.get("user_message"),
        "app_context_loaded": bool(context_snapshot),
    }


@api_router.get("/chat/history")
async def chat_history(request: Request):
    user = await require_auth(request)
    items = await db.chat_history.find(
        {"user_id": user.user_id}, {"_id": 0}
    ).sort("created_at", -1).limit(50).to_list(50)
    items.reverse()
    for item in items:
        if isinstance(item.get("created_at"), datetime):
            item["created_at"] = item["created_at"].isoformat()
    return items


# ============== Public Config Route (non-sensitive, auth required) ==============

@api_router.get("/config")
async def get_public_config(request: Request):
    """Return non-sensitive public config for authenticated users (e.g. D365 org URL)."""
    await require_auth(request)
    db_config = await db.bot_config.find_one({"_id": "config"}, {"_id": 0, "d365_org_url": 1})
    return {
        "d365_org_url": (db_config or {}).get("d365_org_url") or D365_ORG_URL or "",
    }


# ============== D365 Routes ==============

@api_router.get("/d365/test")
async def test_d365_connection(request: Request):
    user = await require_auth(request)
    try:
        access_token = await get_d365_token(user.user_id, db)
        d365 = D365Client(access_token)
        return await d365.test_connection()
    except Exception as e:
        return {"connected": False, "error_message": str(e)}


_ENTITY_TO_TYPE = {
    "phonecalls": "phonecall",
    "tasks": "task",
    "emails": "email",
    "appointments": "appointment",
}


@api_router.get("/d365/activities")
async def get_d365_activities(
    request: Request,
    entity_set: str = "phonecalls",
    top: int = 50
):
    user = await require_auth(request)
    try:
        access_token = await get_d365_token(user.user_id, db)
        d365 = D365Client(access_token)
        return await d365.list_activities(entity_set=entity_set, top=top)
    except Exception as e:
        logger.warning(
            "D365 direct fetch unavailable for %s (%s) — falling back to local log",
            user.email, e,
        )

    # Fallback: read from local workflow_executions so the Activities page
    # still shows data when OAuth / D365 token is not available.
    activity_type = _ENTITY_TO_TYPE.get(entity_set, entity_set.rstrip("s"))
    query = {
        "user_id": user.user_id,
        "workflow_id": "log-d365-activity",
        "params.activity_type": activity_type,
    }
    docs = (
        await db.workflow_executions.find(query, {"_id": 0})
        .sort("created_at", -1)
        .limit(top)
        .to_list(top)
    )
    records = []
    for doc in docs:
        p = doc.get("params", {})
        r = doc.get("result", {})
        created = doc.get("created_at")
        records.append({
            "activityid": r.get("d365_record_id", ""),
            "subject": p.get("subject", ""),
            "actualdurationminutes": p.get("duration_minutes"),
            "createdon": created.isoformat() if hasattr(created, "isoformat") else (str(created) if created else ""),
            "description": p.get("notes", ""),
            "_local": True,
        })
    return records


# ── Power Automate webhook management (admin only) ────────────────────────────

@api_router.get("/d365/webhook/status")
async def d365_webhook_status(request: Request):
    await require_admin(request)
    config = await db.bot_config.find_one({"_id": "config"})
    url = (config or {}).get("power_automate_webhook_url", "")
    return {
        "configured": bool(url),
        "url_preview": (url[:45] + "…") if len(url) > 45 else url,
    }


@api_router.put("/d365/webhook/url")
async def save_webhook_url(body: WebhookUrlRequest, request: Request):
    admin = await require_admin(request)
    if body.url and not body.url.startswith("https://"):
        raise HTTPException(status_code=400, detail="Webhook URL must start with https://")
    await db.bot_config.update_one(
        {"_id": "config"},
        {"$set": {"power_automate_webhook_url": body.url, "updated_at": datetime.now(timezone.utc)}},
        upsert=True,
    )
    kb.fire(
        user_id=admin.user_id,
        event_type="webhook_configured",
        event_summary=f"Power Automate webhook URL {'updated' if body.url else 'cleared'} on {datetime.now(timezone.utc).strftime('%B %d')}",
        metadata={"url_preview": (body.url[:50] + "…") if body.url and len(body.url) > 50 else body.url},
    )
    return {"ok": True}


# ── Browser cookie session management (admin only) ────────────────────────────

@api_router.get("/d365/browser/status")
async def d365_browser_status(request: Request):
    await require_admin(request)
    from d365_browser import get_status  # noqa: PLC0415
    return await get_status(db)


@api_router.post("/d365/browser/save-cookies")
async def save_browser_cookies(body: BrowserCookiesRequest, request: Request):
    admin = await require_admin(request)
    from d365_browser import save_cookies  # noqa: PLC0415
    try:
        await save_cookies(body.cookies_json, db)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    kb.fire(
        user_id=admin.user_id,
        event_type="cookie_session_saved",
        event_summary=f"Browser cookie session saved on {datetime.now(timezone.utc).strftime('%B %d')} — fallback auth path active",
        metadata={"method": "browser_cookies"},
    )
    return {"ok": True}


# ============== Team Admin Routes ==============

@api_router.get("/team")
async def get_team(request: Request):
    await require_admin(request)
    members = await db.authorized_users.find({}, {"_id": 0}).to_list(200)
    for m in members:
        if isinstance(m.get("added_at"), datetime):
            m["added_at"] = m["added_at"].isoformat()
    return members


@api_router.post("/team")
async def add_team_member(body: TeamMemberRequest, request: Request):
    admin = await require_admin(request)
    if await db.authorized_users.find_one({"email": body.email}):
        raise HTTPException(status_code=400, detail="User already exists in team")
    await db.authorized_users.insert_one({
        "email": body.email,
        "display_name": body.display_name,
        "role": body.role,
        "added_by": admin.email,
        "added_at": datetime.now(timezone.utc)
    })
    return {"ok": True}


@api_router.delete("/team/{identifier}")
async def remove_team_member(identifier: str, request: Request):
    await require_admin(request)
    result = await db.authorized_users.delete_one(
        {"$or": [{"user_id": identifier}, {"email": identifier}]}
    )
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Team member not found")
    return {"ok": True}


# ============== Settings Admin Routes ==============

@api_router.get("/settings")
async def get_settings(request: Request):
    await require_admin(request)
    config = await db.bot_config.find_one({"_id": "config"}, {"_id": 0})
    if not config:
        return {}
    # Never expose raw secrets
    for key in ("groq_api_key", "n8n_api_key", "token_encryption_key"):
        config.pop(key, None)
    if isinstance(config.get("updated_at"), datetime):
        config["updated_at"] = config["updated_at"].isoformat()
    return config


@api_router.put("/settings")
async def update_settings(body: SettingsUpdateRequest, request: Request):
    await require_admin(request)
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    updates["updated_at"] = datetime.now(timezone.utc)
    await db.bot_config.update_one({"_id": "config"}, {"$set": updates}, upsert=True)
    return {"ok": True}


# ============== Monitoring Admin Routes ==============

@api_router.get("/monitoring/summary")
async def monitoring_summary(request: Request):
    await require_admin(request)
    now = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)

    workflows_today = await db.workflow_executions.count_documents(
        {"created_at": {"$gte": today_start}}
    )
    success_today = await db.workflow_executions.count_documents(
        {"created_at": {"$gte": today_start}, "status": "success"}
    )
    success_rate = round(success_today / workflows_today * 100, 1) if workflows_today else 0.0

    recent = await db.workflow_executions.find({}, {"_id": 0}) \
        .sort("created_at", -1).limit(10).to_list(10)
    for r in recent:
        if isinstance(r.get("created_at"), datetime):
            r["created_at"] = r["created_at"].isoformat()
        if isinstance(r.get("completed_at"), datetime):
            r["completed_at"] = r["completed_at"].isoformat()

    return {
        "workflows_today": workflows_today,
        "success_rate": success_rate,
        "recent_executions": recent,
    }


# ============== Internal Routes (N8N callbacks) ==============

@api_router.post("/internal/log-execution")
async def log_execution(request: Request):
    """N8N calls this after a workflow completes to update the execution record"""
    key = request.headers.get("X-Internal-Key")
    if not INTERNAL_KEY or key != INTERNAL_KEY:
        raise HTTPException(status_code=403, detail="Invalid internal key")

    body = await request.json()
    execution_id = body.get("execution_id")
    if not execution_id:
        raise HTTPException(status_code=400, detail="execution_id required")

    await db.workflow_executions.update_one(
        {"id": execution_id},
        {"$set": {
            "status": body.get("status", "success"),
            "result": body.get("result"),
            "d365_record_id": body.get("d365_record_id"),
            "duration_ms": body.get("duration_ms"),
            "error_message": body.get("error_message"),
            "completed_at": datetime.now(timezone.utc)
        }}
    )
    return {"ok": True}


# ============== Excel / Account Import Routes ==============

class AccountImportRequest(BaseModel):
    rows: List[Dict[str, Any]]
    mapping: Dict[str, str]  # {id_col: "...", name_col: "..."}


class RuleCreateRequest(BaseModel):
    name: str
    activity_type: str = "phonecall"
    subject_template: str
    duration_minutes: int = 30
    notes_template: Optional[str] = ""
    account_filter: str = "all"  # "all" or comma-separated account_ids


class BatchExecuteRequest(BaseModel):
    account_ids: Optional[List[str]] = None  # None = use rule's filter; list = run only these


@api_router.post("/excel/upload")
async def excel_upload(request: Request, file: UploadFile = File(...)):
    await get_current_user(request)
    fname = file.filename or ""
    if not fname.lower().endswith((".xlsx", ".xls", ".csv")):
        raise HTTPException(status_code=400, detail="Only .xlsx or .csv files are supported")
    contents = await file.read()
    try:
        rows, columns = parse_file(contents, fname)
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Could not parse file: {e}")
    if not rows:
        raise HTTPException(status_code=422, detail="File is empty or has no data rows")
    preview = rows[:5]
    safe_preview = [
        {k: (str(v) if v is not None else "") for k, v in row.items()}
        for row in preview
    ]
    detected = detect_account_columns(columns)
    return {"success": True, "data": {
        "columns": columns,
        "preview": safe_preview,
        "total_rows": len(rows),
        "detected_columns": detected,
        "all_rows": [
            {k: (str(v) if v is not None else "") for k, v in row.items()} for row in rows
        ],
    }, "error": None}


@api_router.post("/excel/accounts/import")
async def excel_accounts_import(body: AccountImportRequest, request: Request):
    await get_current_user(request)
    id_col = body.mapping.get("id_col", "")
    name_col = body.mapping.get("name_col", "")
    if not name_col:
        raise HTTPException(status_code=400, detail="name_col mapping is required")

    imported = 0
    skipped = 0
    for row in body.rows:
        name_val = str(row.get(name_col, "") or "").strip()
        if not name_val:
            skipped += 1
            continue
        account_id = str(row.get(id_col, "") or "").strip() if id_col else ""
        raw = {k: str(v) if v is not None else "" for k, v in row.items()}
        await db.accounts.update_one(
            {"account_id": account_id} if account_id else {"name": name_val},
            {"$set": {
                "account_id": account_id,
                "name": name_val,
                "raw": raw,
                "imported_at": datetime.now(timezone.utc),
            }},
            upsert=True,
        )
        imported += 1

    return {"success": True, "data": {"imported": imported, "skipped": skipped}, "error": None}


@api_router.get("/excel/accounts")
async def excel_accounts_list(request: Request, search: str = "", limit: int = 50):
    await get_current_user(request)
    query = {}
    if search:
        query = {"$or": [
            {"name": {"$regex": search, "$options": "i"}},
            {"account_id": {"$regex": search, "$options": "i"}},
        ]}
    docs = await db.accounts.find(query, {"_id": 0}).limit(limit).to_list(limit)
    return {"success": True, "data": {"accounts": docs}, "error": None}


# ── Rules ──────────────────────────────────────────────────────────────────────

@api_router.get("/excel/rules")
async def get_rules(request: Request):
    user = await require_auth(request)
    rules = await db.activity_rules.find({"user_id": user.user_id}, {"_id": 0}).sort("created_at", -1).to_list(100)
    for r in rules:
        if isinstance(r.get("created_at"), datetime):
            r["created_at"] = r["created_at"].isoformat()
    return {"success": True, "data": {"rules": rules}, "error": None}


@api_router.post("/excel/rules")
async def create_rule(body: RuleCreateRequest, request: Request):
    user = await require_auth(request)
    rule = {
        "id": str(uuid.uuid4()),
        "user_id": user.user_id,
        "name": body.name,
        "activity_type": body.activity_type,
        "subject_template": body.subject_template,
        "duration_minutes": body.duration_minutes,
        "notes_template": body.notes_template or "",
        "account_filter": body.account_filter,
        "created_at": datetime.now(timezone.utc),
    }
    await db.activity_rules.insert_one({**rule})
    rule["created_at"] = rule["created_at"].isoformat()
    return {"success": True, "data": {"rule": rule}, "error": None}


@api_router.delete("/excel/rules/{rule_id}")
async def delete_rule(rule_id: str, request: Request):
    user = await require_auth(request)
    result = await db.activity_rules.delete_one({"id": rule_id, "user_id": user.user_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Rule not found")
    return {"success": True, "data": {}, "error": None}


async def _resolve_rule_accounts(rule: Dict[str, Any], user_id: str) -> List[Dict[str, Any]]:
    """Return account dicts this rule targets, from the user's default file."""
    account_filter = rule.get("account_filter", "all")

    default_file = await db.uploaded_files.find_one(
        {"user_id": user_id, "is_default": True}, {"file_id": 1}
    )
    if default_file:
        file_id = default_file["file_id"]
        base_q: Dict[str, Any] = {"user_id": user_id, "file_id": file_id}
        if account_filter != "all":
            ids = [a.strip() for a in account_filter.split(",") if a.strip()]
            base_q["$or"] = [
                {"l2_mdm_id_idg": {"$in": ids}},
                {"account_name": {"$in": ids}},
            ]
        docs = await db.user_account_data.find(
            base_q, {"_id": 0, "account_name": 1, "l2_mdm_id_idg": 1}
        ).to_list(2000)
        return [
            {"account_id": d.get("l2_mdm_id_idg", ""), "name": d.get("account_name", ""), "mdm_id": d.get("l2_mdm_id_idg", "")}
            for d in docs
        ]

    # Fall back to legacy accounts collection
    if account_filter == "all":
        docs = await db.accounts.find({}, {"_id": 0, "name": 1, "account_id": 1}).to_list(1000)
    else:
        ids = [a.strip() for a in account_filter.split(",") if a.strip()]
        docs = await db.accounts.find({"account_id": {"$in": ids}}, {"_id": 0, "name": 1, "account_id": 1}).to_list(len(ids))
    return [{"account_id": d.get("account_id", ""), "name": d.get("name", ""), "mdm_id": d.get("account_id", "")} for d in docs]


@api_router.post("/excel/rules/{rule_id}/preview")
async def preview_rule(rule_id: str, request: Request):
    user = await require_auth(request)
    rule = await db.activity_rules.find_one({"id": rule_id, "user_id": user.user_id}, {"_id": 0})
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    accounts = await _resolve_rule_accounts(rule, user.user_id)
    template = rule.get("subject_template", "Activity")
    rows = [
        {
            "account_id": a.get("account_id", ""),
            "mdm_id": a.get("mdm_id", ""),
            "name": a.get("name", ""),
            "subject": template.replace("{name}", a.get("name", "")),
            "activity_type": rule.get("activity_type", "appointment"),
            "duration_minutes": rule.get("duration_minutes", 30),
        }
        for a in accounts
    ]
    return {"success": True, "data": {"rows": rows, "total": len(rows)}, "error": None}


async def _run_batch_job(job_id: str, user: "User", rule: Dict[str, Any], accounts: List[Dict[str, Any]]) -> None:
    """Background task: execute _execute_d365_activity for each account and update job progress."""
    template = rule.get("subject_template", "Activity")
    for idx, account in enumerate(accounts):
        name   = account.get("name", "")
        mdm_id = account.get("mdm_id", account.get("account_id", ""))
        params = {
            "activity_type": rule.get("activity_type", "appointment"),
            "subject": template.replace("{name}", name),
            "account": name,
            "mdm_id": mdm_id,
            "duration_minutes": rule.get("duration_minutes", 30),
            "notes": rule.get("notes_template", "").replace("{name}", name),
        }
        try:
            result = await _execute_d365_activity(user, params)
            row_update = {
                "status": result.get("status", "success"),
                "record_id": result.get("d365_record_id", ""),
                "record_url": result.get("record_url", ""),
                "method": result.get("method", ""),
            }
        except Exception as e:
            row_update = {"status": "failed", "error": str(e)}

        status_field = "success" if row_update["status"] == "success" else (
            "failed" if row_update["status"] == "failed" else "pending"
        )
        inc_done = 1 if status_field in ("success", "pending") else 0
        inc_failed = 1 if status_field == "failed" else 0

        await db.batch_jobs.update_one(
            {"id": job_id},
            {
                "$set": {f"rows.{idx}": {**{"account_id": account.get("account_id", ""), "name": name}, **row_update}},
                "$inc": {"done": inc_done, "failed": inc_failed},
            },
        )

    await db.batch_jobs.update_one({"id": job_id}, {"$set": {"status": "complete"}})


@api_router.post("/excel/rules/{rule_id}/execute")
async def execute_rule(rule_id: str, body: BatchExecuteRequest, request: Request):
    user = await require_auth(request)
    rule = await db.activity_rules.find_one({"id": rule_id, "user_id": user.user_id}, {"_id": 0})
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")

    all_accounts = await _resolve_rule_accounts(rule, user.user_id)
    if body.account_ids is not None:
        id_set = set(body.account_ids)
        accounts = [a for a in all_accounts if a.get("account_id", "") in id_set or a.get("name", "") in id_set]
    else:
        accounts = all_accounts

    if not accounts:
        raise HTTPException(status_code=400, detail="No accounts match this rule")

    job_id = str(uuid.uuid4())
    initial_rows = [{"account_id": a.get("account_id", ""), "name": a.get("name", ""), "status": "pending"} for a in accounts]
    await db.batch_jobs.insert_one({
        "id": job_id,
        "rule_id": rule_id,
        "user_id": user.user_id,
        "total": len(accounts),
        "done": 0,
        "failed": 0,
        "status": "running",
        "rows": initial_rows,
        "created_at": datetime.now(timezone.utc),
    })

    asyncio.create_task(_run_batch_job(job_id, user, rule, accounts))
    return {"success": True, "data": {"job_id": job_id, "total": len(accounts)}, "error": None}


@api_router.get("/excel/jobs/{job_id}")
async def get_job(job_id: str, request: Request):
    await get_current_user(request)
    job = await db.batch_jobs.find_one({"id": job_id}, {"_id": 0})
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if isinstance(job.get("created_at"), datetime):
        job["created_at"] = job["created_at"].isoformat()
    return {"success": True, "data": job, "error": None}


# ============== File Management Routes ==============


@api_router.post("/files/upload-accounts")
async def upload_accounts_file(request: Request, file: UploadFile = File(...)):
    """Upload an Excel/CSV file of accounts. Parses it, auto-detects columns,
    stores metadata in uploaded_files and rows in user_account_data."""
    user = await require_auth(request)
    fname = file.filename or ""
    logger.info("upload_accounts: user=%s file=%s", user.user_id, fname)
    if not fname.lower().endswith((".xlsx", ".xls", ".csv")):
        raise HTTPException(status_code=400, detail="Only .xlsx or .csv files are supported")

    contents = await file.read()
    try:
        rows, columns = parse_file(contents, fname)
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Could not parse file: {e}")
    if not rows:
        raise HTTPException(status_code=422, detail="File is empty or has no data rows")

    detected = detect_account_columns(columns)
    file_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)

    # Persist file metadata
    await db.uploaded_files.insert_one({
        "file_id": file_id,
        "user_id": user.user_id,
        "filename": fname,
        "row_count": len(rows),
        "columns": columns,
        "detected_columns": detected,
        "is_default": False,
        "uploaded_at": now,
    })

    # Persist parsed rows mapped to canonical schema
    id_idg_col = detected.get("l2_mdm_id_idg")
    id_isg_col = detected.get("l2_mdm_id_isg")
    name_col = detected.get("account_name")
    pc_col = detected.get("parent_child")
    pn_col = detected.get("parent_name")

    docs = []
    for row in rows:
        name_val = str(row.get(name_col, "") or "").strip() if name_col else ""
        if not name_val:
            continue
        docs.append({
            "file_id": file_id,
            "user_id": user.user_id,
            "l2_mdm_id_idg": str(row.get(id_idg_col, "") or "").strip() if id_idg_col else "",
            "l2_mdm_id_isg": str(row.get(id_isg_col, "") or "").strip() if id_isg_col else "",
            "account_name": name_val,
            "parent_child": str(row.get(pc_col, "") or "").strip() if pc_col else "",
            "parent_name": str(row.get(pn_col, "") or "").strip() if pn_col else "",
            "uploaded_at": now,
        })

    if docs:
        await db.user_account_data.insert_many(docs)

    kb.fire(
        user_id=user.user_id,
        event_type="file_upload",
        event_summary=f"User uploaded {fname} with {len(docs)} accounts on {datetime.now(timezone.utc).strftime('%B %d')}",
        metadata={"file_id": file_id, "filename": fname, "row_count": len(rows), "imported_accounts": len(docs)},
    )

    logger.info("upload_accounts: success rows=%d imported=%d", len(rows), len(docs))
    return {"success": True, "data": {
        "file_id": file_id,
        "filename": fname,
        "row_count": len(rows),
        "imported_accounts": len(docs),
        "detected_columns": detected,
    }, "error": None}


@api_router.get("/files/")
async def list_uploaded_files(request: Request):
    user = await require_auth(request)
    files = await db.uploaded_files.find(
        {"user_id": user.user_id}, {"_id": 0}
    ).sort("uploaded_at", -1).to_list(100)
    for f in files:
        if isinstance(f.get("uploaded_at"), datetime):
            f["uploaded_at"] = f["uploaded_at"].isoformat()
    return {"success": True, "data": {"files": files}, "error": None}


@api_router.post("/files/{file_id}/set-default")
async def set_default_file(file_id: str, request: Request):
    user = await require_auth(request)
    doc = await db.uploaded_files.find_one({"file_id": file_id, "user_id": user.user_id})
    if not doc:
        raise HTTPException(status_code=404, detail="File not found")
    # Clear existing default for this user, then set new one
    await db.uploaded_files.update_many(
        {"user_id": user.user_id}, {"$set": {"is_default": False}}
    )
    await db.uploaded_files.update_one(
        {"file_id": file_id}, {"$set": {"is_default": True}}
    )
    kb.fire(
        user_id=user.user_id,
        event_type="file_default_set",
        event_summary=f"User set file {doc.get('filename', file_id)} as the default account list",
        metadata={"file_id": file_id, "filename": doc.get("filename", "")},
    )
    return {"success": True, "data": {"file_id": file_id}, "error": None}


@api_router.delete("/files/{file_id}")
async def delete_uploaded_file(file_id: str, request: Request):
    user = await require_auth(request)
    result = await db.uploaded_files.delete_one({"file_id": file_id, "user_id": user.user_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="File not found")
    # Remove the associated account data rows
    await db.user_account_data.delete_many({"file_id": file_id, "user_id": user.user_id})
    return {"success": True, "data": {}, "error": None}


@api_router.get("/files/{file_id}/accounts")
async def get_file_accounts(file_id: str, request: Request, q: str = "", limit: int = 100):
    """Return accounts stored for a specific uploaded file, with optional search."""
    user = await require_auth(request)
    doc = await db.uploaded_files.find_one({"file_id": file_id, "user_id": user.user_id})
    if not doc:
        raise HTTPException(status_code=404, detail="File not found")
    query: Dict[str, Any] = {"user_id": user.user_id, "file_id": file_id}
    if q:
        query["$or"] = [
            {"account_name": {"$regex": q, "$options": "i"}},
            {"l2_mdm_id_idg": {"$regex": q, "$options": "i"}},
        ]
    docs = await db.user_account_data.find(
        query,
        {"_id": 0, "account_name": 1, "l2_mdm_id_idg": 1, "l2_mdm_id_isg": 1},
    ).limit(limit).to_list(limit)
    return {"success": True, "data": {"accounts": docs, "total": doc.get("row_count", 0)}, "error": None}


# ============== Account Search Routes ==============

@api_router.get("/accounts/search")
async def search_accounts(request: Request, q: str = "", limit: int = 10):
    """Search accounts by name OR MDM ID. Searches user_account_data (new flow) first,
    falls back to legacy accounts collection (ExcelPage import flow)."""
    user = await require_auth(request)

    # Try user_account_data (new /api/files/upload-accounts flow)
    default_file = await db.uploaded_files.find_one(
        {"user_id": user.user_id, "is_default": True}, {"file_id": 1}
    )
    if default_file:
        query: Dict[str, Any] = {"user_id": user.user_id, "file_id": default_file["file_id"]}
        if q:
            query["$or"] = [
                {"account_name": {"$regex": q, "$options": "i"}},
                {"l2_mdm_id_idg": {"$regex": q, "$options": "i"}},
            ]
        docs = await db.user_account_data.find(
            query,
            {"_id": 0, "account_name": 1, "l2_mdm_id_idg": 1, "l2_mdm_id_isg": 1, "parent_child": 1, "parent_name": 1},
        ).limit(limit).to_list(limit)
        if docs:
            return {"success": True, "data": {"results": docs}, "error": None}

    # Fall back to legacy accounts collection (/api/excel/accounts/import flow)
    legacy_query: Dict[str, Any] = {}
    if q:
        legacy_query = {"$or": [
            {"name": {"$regex": q, "$options": "i"}},
            {"account_id": {"$regex": q, "$options": "i"}},
        ]}
    legacy = await db.accounts.find(legacy_query, {"_id": 0, "name": 1, "account_id": 1}).limit(limit).to_list(limit)
    results = [
        {"account_name": d["name"], "l2_mdm_id_idg": d.get("account_id", ""), "l2_mdm_id_isg": "", "parent_child": "", "parent_name": ""}
        for d in legacy if d.get("name")
    ]
    return {"success": True, "data": {"results": results}, "error": None}


# ============== App Registration ==============

app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Static frontend (dev mode only) ──────────────────────────────────────────
# In dev: `yarn build` once, then uvicorn serves everything on http://localhost:8000
# In prod: frontend is a separate Render static site — this block is skipped
if APP_ENV == 'dev' and FRONTEND_BUILD_DIR.exists():
    app.mount(
        "/static",
        StaticFiles(directory=str(FRONTEND_BUILD_DIR / "static")),
        name="static",
    )
    logger.info("Dev mode: serving React build from %s", FRONTEND_BUILD_DIR)

    @app.get("/{full_path:path}", include_in_schema=False)
    async def serve_spa(full_path: str = ""):  # noqa: ARG001
        """Catch-all: serve index.html for all non-API routes (HashRouter SPA)."""
        index = FRONTEND_BUILD_DIR / "index.html"
        if index.exists():
            return FileResponse(str(index))
        return {"error": "Frontend build not found — run `yarn build` in frontend/"}


@app.on_event("startup")
async def startup_event():
    logger.info("Sales Copilot API starting up...")
    # Create MongoDB indexes for performance
    await db.user_sessions.create_index("session_token")
    await db.user_sessions.create_index("expires_at")
    await db.workflow_executions.create_index("user_id")
    await db.workflow_executions.create_index("created_at")
    await db.chat_history.create_index([("user_id", 1), ("created_at", -1)])
    await db.user_account_data.create_index([("user_id", 1), ("account_name", 1)])
    await db.uploaded_files.create_index([("user_id", 1), ("uploaded_at", -1)])
    await db.app_knowledge_base.create_index([("user_id", 1), ("timestamp", -1)])
    await db.app_knowledge_base.create_index([("user_id", 1), ("event_type", 1)])
    logger.info("MongoDB indexes ensured.")


@app.on_event("shutdown")
async def shutdown_event():
    _mongo_client.close()
    logger.info("Sales Copilot API shut down.")
