from fastapi import FastAPI, APIRouter, HTTPException, Request, Response  # noqa: F401
from fastapi.responses import RedirectResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import secrets
from pathlib import Path
from pydantic import BaseModel, ConfigDict
from typing import Optional, Dict, Any
import uuid
from datetime import datetime, timezone, timedelta

# Sales Copilot modules
from microsoft_auth import get_auth_url, handle_callback, get_access_token
from n8n_client import trigger_workflow
from ai_chat import process_message
from d365_client import D365Client

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB
mongo_url = os.environ['MONGO_URL']
_mongo_client = AsyncIOMotorClient(mongo_url)
db = _mongo_client[os.environ.get('DB_NAME', 'sales_copilot')]

app = FastAPI(title="Sales Copilot API")
api_router = APIRouter(prefix="/api")

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

SESSION_EXPIRY_DAYS = 7
INTERNAL_KEY = os.environ.get('INTERNAL_KEY', '')
FRONTEND_URL = os.environ.get('FRONTEND_URL', '')


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


# ============== Auth Helpers ==============

async def get_current_user(request: Request) -> Optional[User]:
    session_token = request.cookies.get("session_token")
    if not session_token:
        auth_header = request.headers.get("Authorization")
        if auth_header and auth_header.startswith("Bearer "):
            session_token = auth_header.split(" ")[1]
    if not session_token:
        return None

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


# ============== Auth Routes ==============

@api_router.get("/auth/microsoft")
async def microsoft_login():
    """Redirect to Microsoft Entra ID login"""
    auth_url, state = await get_auth_url()
    response = RedirectResponse(url=auth_url)
    response.set_cookie(
        "oauth_state", state,
        httponly=True, secure=True, samesite="none", max_age=600
    )
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
        httponly=True, secure=True, samesite="none",
        path="/", max_age=SESSION_EXPIRY_DAYS * 24 * 60 * 60
    )
    redirect.delete_cookie("oauth_state")
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
    response.delete_cookie("session_token", path="/", secure=True, samesite="none")
    return {"ok": True}


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
        result = await trigger_workflow(
            workflow_id=body.workflow_id,
            payload={**body.params, "user_id": user.user_id, "execution_id": execution_id}
        )
        await db.workflow_executions.update_one(
            {"id": execution_id},
            {"$set": {
                "status": result.get("status", "success"),
                "result": result,
                "d365_record_id": result.get("d365_record_id"),
                "duration_ms": result.get("duration_ms"),
                "completed_at": datetime.now(timezone.utc)
            }}
        )
        return {
            "execution_id": execution_id,
            "status": result.get("status", "success"),
            "result": result,
            "d365_record_url": result.get("record_url")
        }
    except Exception as e:
        logger.error(f"Workflow execution error: {e}")
        await db.workflow_executions.update_one(
            {"id": execution_id},
            {"$set": {"status": "failed", "error_message": str(e)}}
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

    try:
        ai_response = await process_message(body.message, user.user_id, history_docs)
    except Exception as e:
        logger.error(f"AI processing error: {e}")
        raise HTTPException(status_code=500, detail="AI processing failed")

    workflow_result = None
    if ai_response.get("workflow") and not ai_response.get("clarification_needed"):
        try:
            workflow_result = await trigger_workflow(
                workflow_id=ai_response["workflow"],
                payload={**ai_response.get("params", {}), "user_id": user.user_id}
            )
        except Exception as e:
            logger.warning(f"Chat workflow trigger failed: {e}")

    await db.chat_history.insert_one({
        "id": str(uuid.uuid4()),
        "user_id": user.user_id,
        "role": "assistant",
        "content": ai_response.get("user_message", ""),
        "workflow_triggered": ai_response.get("workflow"),
        "workflow_result": workflow_result,
        "created_at": datetime.now(timezone.utc)
    })

    return {
        "user_message_id": msg_id,
        "workflow_triggered": ai_response.get("workflow"),
        "workflow_result": workflow_result,
        "clarification_needed": ai_response.get("clarification_needed"),
        "message": ai_response.get("user_message")
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


# ============== D365 Routes ==============

@api_router.get("/d365/test")
async def test_d365_connection(request: Request):
    user = await require_auth(request)
    try:
        access_token = await get_access_token(user.user_id, db)
        d365 = D365Client(access_token)
        return await d365.test_connection()
    except Exception as e:
        return {"connected": False, "error_message": str(e)}


@api_router.get("/d365/activities")
async def get_d365_activities(
    request: Request,
    entity_set: str = "phonecalls",
    top: int = 50
):
    user = await require_auth(request)
    try:
        access_token = await get_access_token(user.user_id, db)
        d365 = D365Client(access_token)
        return await d365.list_activities(entity_set=entity_set, top=top)
    except Exception as e:
        logger.error(f"D365 activities fetch error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


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


# ============== App Registration ==============

app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup_event():
    logger.info("Sales Copilot API starting up...")
    # Create MongoDB indexes for performance
    await db.user_sessions.create_index("session_token")
    await db.user_sessions.create_index("expires_at")
    await db.workflow_executions.create_index("user_id")
    await db.workflow_executions.create_index("created_at")
    await db.chat_history.create_index([("user_id", 1), ("created_at", -1)])
    logger.info("MongoDB indexes ensured.")


@app.on_event("shutdown")
async def shutdown_event():
    _mongo_client.close()
    logger.info("Sales Copilot API shut down.")
