"""Hotfix: an admin grant in authorized_users must apply to a user who is already logged in."""
import secrets
from datetime import datetime, timedelta, timezone

import pytest


async def _signed_up_rep(db, email="New.User@Example.com"):
    now = datetime.now(timezone.utc)
    await db.users.insert_one({"user_id": "user_new", "email": email, "name": "New",
                               "role": "rep", "auth_method": "email", "created_at": now})
    await db.authorized_users.insert_one({"email": email, "role": "rep", "added_at": now})
    token = secrets.token_hex(32)
    await db.user_sessions.insert_one({"user_id": "user_new", "session_token": token,
                                       "expires_at": now + timedelta(days=7), "created_at": now})
    return {"session_token": token}


@pytest.mark.asyncio
async def test_admin_grant_applies_without_relogin(client, db):
    client.cookies.update(await _signed_up_rep(db))
    assert (await client.get("/api/team")).status_code == 403

    await db.authorized_users.update_one({"email": "New.User@Example.com"}, {"$set": {"role": "admin"}})

    me = await client.get("/api/auth/me")
    assert me.json()["role"] == "admin"
    assert (await client.get("/api/team")).status_code == 200
    assert (await db.users.find_one({"user_id": "user_new"}))["role"] == "admin"


@pytest.mark.asyncio
async def test_lowercased_grant_matches_mixed_case_email(client, db):
    client.cookies.update(await _signed_up_rep(db))
    await db.authorized_users.delete_many({})
    await db.authorized_users.insert_one({"email": "new.user@example.com", "role": "admin"})
    assert (await client.get("/api/auth/me")).json()["role"] == "admin"


@pytest.mark.asyncio
async def test_demotion_applies_too(client, db):
    client.cookies.update(await _signed_up_rep(db))
    await db.users.update_one({"user_id": "user_new"}, {"$set": {"role": "admin"}})
    assert (await client.get("/api/team")).status_code == 403
