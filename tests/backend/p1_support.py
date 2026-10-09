"""Shared fixtures/helpers for the P1 tests (imported, not collected)."""
import socket
import threading
import time
import uuid
from datetime import datetime, timezone

import pytest_asyncio
import uvicorn

import server
from tests.fakes import fake_flow


@pytest_asyncio.fixture
async def flow_url(monkeypatch):
    """Run the fake flow on a real local port; reset its store and mode for each test."""
    monkeypatch.delenv("FAKE_FLOW_MODE", raising=False)
    monkeypatch.delenv("FAKE_FLOW_SEED", raising=False)
    fake_flow.reset()
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    srv = uvicorn.Server(uvicorn.Config(fake_flow.app, host="127.0.0.1", port=port, log_level="error"))
    thread = threading.Thread(target=srv.run, daemon=True)
    thread.start()
    for _ in range(100):
        if srv.started:
            break
        time.sleep(0.05)
    yield f"http://127.0.0.1:{port}/legacy"
    srv.should_exit = True
    thread.join(timeout=5)


async def set_config(db, **fields):
    await db.bot_config.update_one({"_id": "config"}, {"$set": fields}, upsert=True)


async def make_user_obj(db, role="rep"):
    uid = f"user_{uuid.uuid4().hex[:10]}"
    await db.users.insert_one({"user_id": uid, "email": f"{uid}@example.com", "name": "Test Rep",
                               "role": role, "created_at": datetime.now(timezone.utc)})
    return server.User(user_id=uid, email=f"{uid}@example.com", name="Test Rep", role=role)


async def seed_accounts(db, user_id, accounts, file_id="file-1"):
    await db.uploaded_files.insert_one({"user_id": user_id, "file_id": file_id, "is_default": True})
    await db.user_account_data.insert_many(
        [{"user_id": user_id, "file_id": file_id, **a} for a in accounts]
    )


APPOINTMENT = {
    "activity_type": "appointment", "account": "Acme", "subject": "Customer Meeting - Acme",
    "duration_minutes": 30, "start_time": "2026-04-09T12:00", "mdm_id": "IDG-1",
}
