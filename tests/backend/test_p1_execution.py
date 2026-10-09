"""P1.T1–T4, T7, T8 — execution truthfulness, transport opt-ins, dry run, payload data, platform fixes."""
import pytest
from fastapi import HTTPException

import d365_browser
import microsoft_auth
import server
from tests.backend.p1_support import APPOINTMENT, flow_url, make_user_obj, set_config  # noqa: F401
from tests.fakes import fake_flow

EXEC = {"workflow_id": "log-d365-activity", "params": APPOINTMENT}


async def _only_execution(db):
    docs = await db.workflow_executions.find({}, {"_id": 0}).to_list(10)
    assert len(docs) == 1
    return docs[0]


# ── T1: statuses and finalisation ─────────────────────────────────────────────

@pytest.mark.asyncio
async def test_flow_ok_is_success_with_record_id(auth_client, db, flow_url):
    await set_config(db, power_automate_webhook_url=flow_url)
    r = await auth_client.post("/api/workflows/execute", json=EXEC)
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "success"
    created = fake_flow.STORE["legacy"][0]["activityid"]
    assert body["result"]["d365_record_id"] == created
    doc = await _only_execution(db)
    assert doc["status"] == "success" and doc["d365_record_id"] == created
    assert doc["completed_at"] is not None and doc["error_code"] is None


@pytest.mark.asyncio
async def test_no_id_is_unverified(auth_client, db, flow_url, monkeypatch):
    monkeypatch.setenv("FAKE_FLOW_MODE", "no_id")
    await set_config(db, power_automate_webhook_url=flow_url)
    r = await auth_client.post("/api/workflows/execute", json=EXEC)
    assert r.status_code == 200
    assert r.json()["status"] == "unverified"
    assert r.json()["result"]["error_code"] == "FLOW_CONTRACT_VIOLATION"
    assert "did not return a record ID" in r.json()["result"]["error_message"]
    doc = await _only_execution(db)
    assert doc["status"] == "unverified" and doc["error_code"] == "FLOW_CONTRACT_VIOLATION"


@pytest.mark.asyncio
async def test_flow_error_is_failed_502_and_not_pending(auth_client, db, flow_url, monkeypatch):
    monkeypatch.setenv("FAKE_FLOW_MODE", "error")
    await set_config(db, power_automate_webhook_url=flow_url)
    r = await auth_client.post("/api/workflows/execute", json=EXEC)
    assert r.status_code == 502
    body = r.json()
    assert body["error_code"] == "FLOW_UNREACHABLE" and body["detail"] and body["execution_id"]
    doc = await _only_execution(db)
    assert doc["status"] == "failed" and doc["error_code"] == "FLOW_UNREACHABLE"
    assert doc["id"] == body["execution_id"] and doc["completed_at"] is not None


@pytest.mark.asyncio
async def test_flow_unset_is_failed_not_configured(auth_client, db):
    r = await auth_client.post("/api/workflows/execute", json=EXEC)
    assert r.status_code == 502 and r.json()["error_code"] == "FLOW_NOT_CONFIGURED"
    assert (await _only_execution(db))["status"] == "failed"


@pytest.mark.asyncio
async def test_unreachable_flow_url_is_failed(auth_client, db):
    await set_config(db, power_automate_webhook_url="https://127.0.0.1:9/never")
    r = await auth_client.post("/api/workflows/execute", json=EXEC)
    assert r.status_code == 502 and r.json()["error_code"] == "FLOW_UNREACHABLE"
    assert "127.0.0.1" not in r.json()["detail"]   # no URL leak
    assert (await _only_execution(db))["status"] == "failed"


@pytest.mark.asyncio
async def test_http_exception_branch_finalizes_execution(auth_client, db, monkeypatch):
    async def boom(user, params):
        raise HTTPException(status_code=503, detail="down")
    monkeypatch.setattr(server, "_execute_d365_activity", boom)
    r = await auth_client.post("/api/workflows/execute", json=EXEC)
    assert r.status_code == 503
    doc = await _only_execution(db)
    assert doc["status"] == "failed" and doc["error_code"] == "HTTP_503" and doc["completed_at"]


@pytest.mark.asyncio
async def test_unexpected_exception_finalizes_execution(auth_client, db, monkeypatch):
    async def boom(user, params):
        raise RuntimeError("kaboom")
    monkeypatch.setattr(server, "_execute_d365_activity", boom)
    r = await auth_client.post("/api/workflows/execute", json=EXEC)
    assert r.status_code == 500 and r.json()["error_code"] == "INTERNAL_ERROR"
    assert "kaboom" not in r.text
    assert (await _only_execution(db))["status"] == "failed"


@pytest.mark.asyncio
async def test_flow_400_maps_to_crm_validation(auth_client, db, monkeypatch):
    async def bad(url, payload):
        raise ValueError("Webhook returned 400: {\"error\": \"bad field\"}")
    monkeypatch.setattr(server.D365Client, "create_activity_via_webhook", staticmethod(bad))
    await set_config(db, power_automate_webhook_url="https://x.environment.api.powerplatform.com/f")
    r = await auth_client.post("/api/workflows/execute", json=EXEC)
    assert r.status_code == 502 and r.json()["error_code"] == "CRM_VALIDATION"


# ── T2: transport opt-ins and scopes ──────────────────────────────────────────

@pytest.mark.asyncio
async def test_oauth_and_browser_never_called_by_default(db, flow_url, monkeypatch):
    calls = []

    async def spy_token(*a, **k):
        calls.append("oauth")
        raise ValueError("should not be called")

    async def spy_browser(*a, **k):
        calls.append("browser")
        return None

    monkeypatch.setattr(server, "get_d365_token", spy_token)
    monkeypatch.setattr(d365_browser, "get_d365_token_from_cookies", spy_browser)
    user = await make_user_obj(db)

    # no flow configured and flags unset -> still nothing but a clean failure
    result = await server._execute_d365_activity(user, dict(APPOINTMENT))
    assert result["error_code"] == "FLOW_NOT_CONFIGURED"
    # flow configured, flags unset
    await set_config(db, power_automate_webhook_url=flow_url)
    result = await server._execute_d365_activity(user, dict(APPOINTMENT))
    assert result["status"] == "success" and result["method"] == "webhook"
    assert calls == []


@pytest.mark.asyncio
async def test_flags_true_enable_paths(db, flow_url, monkeypatch):
    calls = []

    async def failing_token(*a, **k):
        calls.append("oauth")
        raise ValueError("no consent")

    async def no_cookies(*a, **k):
        calls.append("browser")
        return None

    monkeypatch.setattr(server, "get_d365_token", failing_token)
    monkeypatch.setattr(d365_browser, "get_d365_token_from_cookies", no_cookies)
    user = await make_user_obj(db)
    await set_config(db, d365_direct_enabled=True, d365_browser_fallback_enabled=True)

    result = await server._execute_d365_activity(user, dict(APPOINTMENT))
    assert calls == ["oauth", "browser"]
    assert result["status"] == "failed" and "Direct D365 connection failed" in result["error_message"]

    await set_config(db, power_automate_webhook_url=flow_url)
    result = await server._execute_d365_activity(user, dict(APPOINTMENT))
    assert result["status"] == "success" and result["method"] == "webhook"


def test_d365_scopes_built_from_org(monkeypatch):
    monkeypatch.setenv("D365_ORG_URL", "https://example.crm.dynamics.com/")
    assert microsoft_auth.d365_scopes() == ["https://example.crm.dynamics.com/.default"]
    monkeypatch.setenv("D365_ORG_URL", "")
    with pytest.raises(ValueError, match="D365_ORG_URL not set"):
        microsoft_auth.d365_scopes()


@pytest.mark.asyncio
async def test_get_d365_token_requires_org(db, monkeypatch):
    monkeypatch.setenv("D365_ORG_URL", "")
    with pytest.raises(ValueError, match="D365_ORG_URL not set"):
        await microsoft_auth.get_d365_token("any-user", db)


# ── T3: dry run ───────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_dry_run_sends_nothing(auth_client, db, flow_url, monkeypatch):
    sent = []

    async def spy(url, payload):
        sent.append(payload)
        return {"activityid": "x"}

    monkeypatch.setattr(server.D365Client, "create_activity_via_webhook", staticmethod(spy))
    await set_config(db, power_automate_webhook_url=flow_url, dry_run_mode=True,
                     d365_direct_enabled=True, d365_browser_fallback_enabled=True)
    r = await auth_client.post("/api/workflows/execute", json=EXEC)
    assert r.status_code == 200
    assert r.json()["status"] == "dry_run" and r.json()["result"]["method"] == "dry_run"
    assert sent == [] and fake_flow.STORE["legacy"] == []
    assert (await _only_execution(db))["status"] == "dry_run"


# ── T4: payload data ──────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_appointment_payload_utc_end_and_status(db, flow_url):
    await set_config(db, power_automate_webhook_url=flow_url)
    user = await make_user_obj(db)
    params = {**APPOINTMENT, "mdm_id_idg": "IDG-1", "mdm_id_isg": "ISG-1"}
    result = await server._execute_d365_activity(user, params)
    assert result["status"] == "success"
    sent = fake_flow.STORE["legacy"][0]["payload"]
    assert sent["scheduledstart"] == "2026-04-09T06:30:00Z"      # 12:00 IST
    assert sent["scheduledend"] == "2026-04-09T07:00:00Z"
    assert sent["start_time"] == "2026-04-09T06:30:00Z"
    assert (sent["statecode"], sent["statuscode"]) == (1, 3)
    assert sent["mdm_id"] == "IDG-1" and sent["mdm_id_idg"] == "IDG-1" and sent["mdm_id_isg"] == "ISG-1"


@pytest.mark.asyncio
async def test_user_timezone_preference_is_used(db, flow_url):
    await set_config(db, power_automate_webhook_url=flow_url)
    user = await make_user_obj(db)
    await db.user_preferences.insert_one({"user_id": user.user_id, "timezone": "America/New_York"})
    await server._execute_d365_activity(user, dict(APPOINTMENT))
    assert fake_flow.STORE["legacy"][0]["payload"]["scheduledstart"] == "2026-04-09T16:00:00Z"


@pytest.mark.asyncio
async def test_z_start_time_passes_through(db, flow_url):
    await set_config(db, power_automate_webhook_url=flow_url)
    user = await make_user_obj(db)
    await server._execute_d365_activity(user, {**APPOINTMENT, "start_time": "2026-04-09T06:30:00.000Z"})
    assert fake_flow.STORE["legacy"][0]["payload"]["scheduledstart"] == "2026-04-09T06:30:00Z"


@pytest.mark.asyncio
async def test_appointment_without_start_uses_now_and_has_end(db, flow_url):
    await set_config(db, power_automate_webhook_url=flow_url)
    user = await make_user_obj(db)
    params = {k: v for k, v in APPOINTMENT.items() if k != "start_time"}
    await server._execute_d365_activity(user, params)
    sent = fake_flow.STORE["legacy"][0]["payload"]
    assert sent["scheduledstart"].endswith(":00Z") and sent["scheduledend"] > sent["scheduledstart"]


@pytest.mark.asyncio
async def test_phonecall_without_start_has_no_times_and_its_own_status(db, flow_url):
    await set_config(db, power_automate_webhook_url=flow_url)
    user = await make_user_obj(db)
    await server._execute_d365_activity(user, {"activity_type": "phonecall", "account": "Acme", "mdm_id": "1"})
    sent = fake_flow.STORE["legacy"][0]["payload"]
    assert "scheduledstart" not in sent and "scheduledend" not in sent
    assert (sent["statecode"], sent["statuscode"]) == (1, 2)


@pytest.mark.asyncio
async def test_invalid_start_time_is_input_invalid(db, flow_url):
    await set_config(db, power_automate_webhook_url=flow_url)
    user = await make_user_obj(db)
    result = await server._execute_d365_activity(user, {**APPOINTMENT, "start_time": "tomorrow-ish"})
    assert result["status"] == "failed" and result["error_code"] == "INPUT_INVALID"
    assert fake_flow.STORE["legacy"] == []


# ── T7: legacy URL detection ──────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_status_flags_legacy_host(admin_client, db):
    await set_config(db, power_automate_webhook_url="https://prod-12.westus.logic.azure.com:443/workflows/abc/triggers/manual/paths/invoke?sig=SECRET")
    body = (await admin_client.get("/api/d365/webhook/status")).json()
    assert body["legacy_host"] is True and body["host"] == "prod-12.westus.logic.azure.com"
    assert "SECRET" not in body["url_preview"]

    await set_config(db, power_automate_webhook_url="https://abc.12.environment.api.powerplatform.com/powerautomate/x")
    body = (await admin_client.get("/api/d365/webhook/status")).json()
    assert body["legacy_host"] is False and body["host"].endswith("powerplatform.com")


@pytest.mark.asyncio
async def test_save_rejects_legacy_accepts_new(admin_client, db):
    r = await admin_client.put("/api/d365/webhook/url", json={"url": "https://prod-1.westus.logic.azure.com/workflows/x"})
    assert r.status_code == 400 and "retired" in r.json()["detail"]
    r = await admin_client.put("/api/d365/webhook/url", json={"url": "https://abc.environment.api.powerplatform.com/x"})
    assert r.status_code == 200
    saved = await db.bot_config.find_one({"_id": "config"})
    assert saved["power_automate_webhook_url"].startswith("https://abc.environment")
    assert (await admin_client.put("/api/d365/webhook/url", json={"url": ""})).status_code == 200  # clearing is allowed


# ── T8: CORS PATCH and rate limits ────────────────────────────────────────────

@pytest.mark.asyncio
async def test_cors_preflight_allows_patch(client):
    r = await client.options("/api/user/preferences", headers={
        "Origin": "http://localhost:3000", "Access-Control-Request-Method": "PATCH",
        "Access-Control-Request-Headers": "content-type",
    })
    assert r.status_code == 200
    assert "PATCH" in r.headers["access-control-allow-methods"]


@pytest.mark.asyncio
async def test_login_is_rate_limited(client, db):
    headers = {"X-Forwarded-For": "203.0.113.77"}
    codes = []
    for _ in range(11):
        r = await client.post("/api/auth/login", json={"email": "nobody@example.com", "password": "x"}, headers=headers)
        codes.append(r.status_code)
    assert codes[:10] == [401] * 10 and codes[10] == 429


@pytest.mark.asyncio
async def test_change_password_is_rate_limited(auth_client):
    headers = {"X-Forwarded-For": "203.0.113.78"}
    body = {"current_password": "x", "new_password": "longenough1"}
    codes = [(await auth_client.post("/api/auth/change-password", json=body, headers=headers)).status_code
             for _ in range(6)]
    assert codes[5] == 429 and 429 not in codes[:5]
