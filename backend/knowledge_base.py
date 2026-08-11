"""
Central knowledge base for the context-aware AI.

Every significant event in the application writes a record here automatically.
The KnowledgeBaseService is also responsible for building the live context
snapshot injected into every AI system prompt.
"""
import asyncio
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


class KnowledgeBaseService:
    def __init__(self, db):
        self.db = db

    # ── Write ─────────────────────────────────────────────────────────────────

    async def write_event(
        self,
        user_id: str,
        event_type: str,
        event_summary: str,
        metadata: Optional[Dict[str, Any]] = None,
        is_active: bool = True,
    ) -> None:
        """Write an event to app_knowledge_base. Swallows exceptions so it
        never crashes the caller."""
        try:
            await self.db.app_knowledge_base.insert_one({
                "user_id": user_id,
                "event_type": event_type,
                "event_summary": event_summary,
                "metadata": metadata or {},
                "timestamp": datetime.now(timezone.utc),
                "is_active": is_active,
            })
        except Exception as exc:
            logger.warning("KnowledgeBase.write_event failed: %s", exc)

    def fire(
        self,
        user_id: str,
        event_type: str,
        event_summary: str,
        metadata: Optional[Dict[str, Any]] = None,
        is_active: bool = True,
    ) -> None:
        """Fire-and-forget write — schedules a background task and returns
        immediately. Never blocks the calling endpoint."""
        asyncio.create_task(
            self.write_event(user_id, event_type, event_summary, metadata, is_active)
        )

    # ── Read ──────────────────────────────────────────────────────────────────

    async def get_recent_events(
        self, user_id: str, limit: int = 50
    ) -> List[Dict[str, Any]]:
        docs = await self.db.app_knowledge_base.find(
            {"user_id": user_id}, {"_id": 0}
        ).sort("timestamp", -1).limit(limit).to_list(limit)
        for d in docs:
            if isinstance(d.get("timestamp"), datetime):
                d["timestamp"] = d["timestamp"].isoformat()
        return docs

    async def get_events_by_type(
        self, user_id: str, event_type: str, limit: int = 20
    ) -> List[Dict[str, Any]]:
        docs = await self.db.app_knowledge_base.find(
            {"user_id": user_id, "event_type": event_type}, {"_id": 0}
        ).sort("timestamp", -1).limit(limit).to_list(limit)
        for d in docs:
            if isinstance(d.get("timestamp"), datetime):
                d["timestamp"] = d["timestamp"].isoformat()
        return docs

    # ── Context snapshot ──────────────────────────────────────────────────────

    async def get_app_context_snapshot(self, user_id: str) -> Dict[str, Any]:
        """Build a structured snapshot of current app state for the AI system prompt."""

        # Webhook + cookie session — both live in bot_config
        config = await self.db.bot_config.find_one({"_id": "config"})
        cfg = config or {}
        webhook_url = cfg.get("power_automate_webhook_url", "")
        webhook_connected = bool(webhook_url)
        # Cookie session: cookies are stored encrypted in bot_config, not a separate collection
        cookie_active = bool(cfg.get("d365_browser_cookies_enc"))

        # Default file
        default_file_doc = await self.db.uploaded_files.find_one(
            {"user_id": user_id, "is_default": True}
        )
        default_file = None
        if default_file_doc:
            ts = default_file_doc.get("uploaded_at")
            default_file = {
                "name": default_file_doc.get("filename", ""),
                "row_count": default_file_doc.get("row_count", 0),
                "uploaded_at": ts.isoformat() if isinstance(ts, datetime) else str(ts or ""),
            }

        # Total accounts cached for this user
        total_accounts = await self.db.user_account_data.count_documents(
            {"user_id": user_id}
        )

        # Last activity created by this user
        # Motor's find_one() does not accept sort — use find().sort().limit(1) instead
        _last = await self.db.workflow_executions.find(
            {"user_id": user_id}
        ).sort("created_at", -1).limit(1).to_list(1)
        last_wf = _last[0] if _last else None
        last_activity = None
        if last_wf:
            params = last_wf.get("params", {})
            ts = last_wf.get("created_at")
            last_activity = {
                "type": params.get("activity_type", ""),
                "subject": params.get("subject", ""),
                "account": params.get("account", ""),
                "status": last_wf.get("status", ""),
                "timestamp": ts.isoformat() if isinstance(ts, datetime) else str(ts or ""),
            }

        # Recent workflows (last 5)
        recent_docs = await self.db.workflow_executions.find(
            {"user_id": user_id},
            {"_id": 0, "params": 1, "status": 1, "created_at": 1},
        ).sort("created_at", -1).limit(5).to_list(5)
        recent_workflows = []
        for d in recent_docs:
            params = d.get("params", {})
            ts = d.get("created_at")
            recent_workflows.append({
                "type": params.get("activity_type", ""),
                "subject": params.get("subject", ""),
                "account": params.get("account", ""),
                "status": d.get("status", ""),
                "timestamp": ts.isoformat() if isinstance(ts, datetime) else str(ts or ""),
            })

        return {
            "webhook_connected": webhook_connected,
            "webhook_url": (webhook_url[:50] + "…") if len(webhook_url) > 50 else webhook_url,
            "default_file": default_file,
            "total_accounts_cached": total_accounts,
            "cookie_session_active": cookie_active,
            "last_activity_created": last_activity,
            "recent_workflows": recent_workflows,
        }
