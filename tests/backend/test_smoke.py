import pytest


@pytest.mark.asyncio
async def test_healthz(client):
    r = await client.get("/healthz")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


@pytest.mark.asyncio
async def test_version(client):
    r = await client.get("/api/version")
    assert r.status_code == 200
    assert r.json() == {"commit": "local", "service": "sales-copilot-api", "env": "dev"}


@pytest.mark.asyncio
async def test_auth_me_requires_cookie(client):
    r = await client.get("/api/auth/me")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_auth_me_with_session(auth_client):
    r = await auth_client.get("/api/auth/me")
    assert r.status_code == 200
    assert r.json()["role"] == "rep"


@pytest.mark.asyncio
async def test_admin_route_rejects_rep_and_allows_admin(client, user, admin):
    client.cookies.update(user)
    assert (await client.get("/api/team")).status_code == 403
    client.cookies.update(admin)
    assert (await client.get("/api/team")).status_code == 200


@pytest.mark.asyncio
async def test_activity_types_seeded(auth_client, seeded_db):
    r = await auth_client.get("/api/config/activity-types")
    assert r.status_code == 200
    assert [t["id"] for t in r.json()] == ["appointment"]
