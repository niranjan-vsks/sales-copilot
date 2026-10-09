"""Shared pytest fixtures for the backend test suite.

Environment is pinned *before* `server` is imported so the module never sees a
real MONGO_URL / DB_NAME. Every test gets a fresh in-memory Mongo (mongomock).
"""
import os
import secrets
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

from cryptography.fernet import Fernet

os.environ["APP_ENVIRONMENT"] = "dev"
os.environ["MONGO_URL"] = "mongodb://localhost:27017"
os.environ["DB_NAME"] = "sales_copilot_test"
os.environ["SECRET_KEY"] = "test-secret"
os.environ["TOKEN_ENCRYPTION_KEY"] = Fernet.generate_key().decode()
os.environ["CORS_ORIGINS"] = "http://localhost:3000"
os.environ["GROQ_API_KEY"] = "test"
os.environ.pop("RAILWAY_GIT_COMMIT_SHA", None)

BACKEND_DIR = Path(__file__).resolve().parent.parent / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import httpx  # noqa: E402
import pytest_asyncio  # noqa: E402
from mongomock_motor import AsyncMongoMockClient  # noqa: E402

import server  # noqa: E402


@pytest_asyncio.fixture
async def db(monkeypatch):
    test_db = AsyncMongoMockClient()["test"]
    monkeypatch.setattr(server, "db", test_db)
    monkeypatch.setattr(server.kb, "db", test_db)
    return test_db


@pytest_asyncio.fixture
async def seeded_db(db):
    """db with startup seed data (ASGITransport does not run startup events)."""
    await server._seed_activity_types()
    return db


@pytest_asyncio.fixture
async def client(db):
    transport = httpx.ASGITransport(app=server.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


async def _make_user(db, role: str) -> dict:
    user_id = f"user_{uuid.uuid4().hex[:12]}"
    email = f"{role}-{user_id}@example.com"
    now = datetime.now(timezone.utc)
    await db.users.insert_one({
        "user_id": user_id, "email": email, "name": f"Test {role}",
        "role": role, "created_at": now,
    })
    await db.authorized_users.insert_one({
        "email": email, "role": role, "added_at": now,
    })
    token = secrets.token_hex(32)
    await db.user_sessions.insert_one({
        "user_id": user_id, "session_token": token,
        "expires_at": now + timedelta(days=1), "created_at": now,
    })
    return {"session_token": token}


@pytest_asyncio.fixture
async def user(db):
    return await _make_user(db, "rep")


@pytest_asyncio.fixture
async def admin(db):
    return await _make_user(db, "admin")


@pytest_asyncio.fixture
async def auth_client(client, user):
    client.cookies.update(user)
    return client


@pytest_asyncio.fixture
async def admin_client(client, admin):
    client.cookies.update(admin)
    return client
