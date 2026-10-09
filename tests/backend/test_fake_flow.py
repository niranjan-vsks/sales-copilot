import uuid

import httpx
import pytest
import pytest_asyncio

from tests.fakes import fake_flow

KEY = {"X-Loop-Key": "test-key"}


@pytest_asyncio.fixture
async def flow(monkeypatch):
    monkeypatch.delenv("FAKE_FLOW_KEY", raising=False)
    monkeypatch.delenv("FAKE_FLOW_MODE", raising=False)
    monkeypatch.delenv("FAKE_FLOW_SEED", raising=False)
    fake_flow.reset()
    transport = httpx.ASGITransport(app=fake_flow.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://fake") as c:
        yield c


async def call(flow, method, path, body=None, headers=KEY):
    env = {"contract": "loop.crm.v1", "request_id": str(uuid.uuid4()), "method": method, "path": path, "body": body}
    r = await flow.post("/v1", json=env, headers=headers)
    assert r.status_code == 200
    data = r.json()
    assert data["contract"] == "loop.crm.v1" and data["request_id"] == env["request_id"]
    return data["status_code"], data["body"]


def _appointment(account_id, **extra):
    return {"subject": "Test", "scheduledstart": "2026-10-09T10:00:00Z", "scheduledend": "2026-10-09T11:00:00Z",
            "regardingobjectid_account_appointment@odata.bind": f"/accounts({account_id})", **extra}


async def _account_id(flow, mdm="1001"):
    _, body = await call(flow, "GET", f"accounts?$select=accountid,name&$filter=lvo_mdmid eq '{mdm}'")
    return body["value"][0]["accountid"]


# ── legacy ───────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_legacy_ok(flow):
    r = await flow.post("/legacy", json={"subject": "x", "activity_type": "appointment", "mdm_id": "1001"})
    assert r.status_code == 200
    assert r.json()["status"] == "success" and uuid.UUID(r.json()["activityid"])
    assert len((await flow.get("/_records")).json()["legacy"]) == 1


@pytest.mark.asyncio
async def test_legacy_no_id(flow):
    r = await flow.post("/legacy", json={}, headers={"X-Fake-Mode": "no_id"})
    assert r.status_code == 202 and r.content == b""


@pytest.mark.asyncio
async def test_legacy_error_via_env(flow, monkeypatch):
    monkeypatch.setenv("FAKE_FLOW_MODE", "error")
    r = await flow.post("/legacy", json={})
    assert r.status_code == 500


@pytest.mark.asyncio
async def test_legacy_slow(flow, monkeypatch):
    slept = []

    async def fake_sleep(s):
        slept.append(s)

    monkeypatch.setattr(fake_flow.asyncio, "sleep", fake_sleep)
    r = await flow.post("/legacy", json={}, headers={"X-Fake-Mode": "slow"})
    assert slept == [35] and r.status_code == 200


# ── v1 guard ─────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_v1_rejects_bad_key(flow):
    status, body = await call(flow, "GET", "WhoAmI", headers={"X-Loop-Key": "wrong"})
    assert status == 401 and body["error"]["message"] == "rejected by guard"


@pytest.mark.asyncio
async def test_v1_custom_key_from_env(flow, monkeypatch):
    monkeypatch.setenv("FAKE_FLOW_KEY", "other")
    assert (await call(flow, "GET", "WhoAmI"))[0] == 401
    assert (await call(flow, "GET", "WhoAmI", headers={"X-Loop-Key": "other"}))[0] == 200


@pytest.mark.asyncio
@pytest.mark.parametrize("method,path", [("DELETE", "appointments(1)"), ("GET", "contacts"), ("POST", "solutions")])
async def test_v1_rejects_method_and_path_outside_allow_list(flow, method, path):
    assert (await call(flow, method, path, body={}))[0] == 400


@pytest.mark.asyncio
async def test_v1_missing_envelope_fields(flow):
    r = await flow.post("/v1", json={"contract": "loop.crm.v1"}, headers=KEY)
    assert r.status_code == 400


# ── v1 Dataverse behaviour ───────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_whoami(flow):
    status, body = await call(flow, "GET", "WhoAmI")
    assert status == 200 and "UserId" in body


@pytest.mark.asyncio
async def test_account_lookup_filter_select_top(flow):
    status, body = await call(flow, "GET", "accounts?$select=accountid,name&$filter=lvo_mdmid eq '1002'&$top=2")
    assert status == 200 and len(body["value"]) == 1
    assert set(body["value"][0]) == {"@odata.etag", "accountid", "name"}
    _, none = await call(flow, "GET", "accounts?$filter=lvo_mdmid eq '9999'")
    assert none["value"] == []


@pytest.mark.asyncio
async def test_filter_with_and_and_escaped_quote(flow, monkeypatch):
    monkeypatch.setenv("FAKE_FLOW_SEED", '[{"name": "O\'Brien", "lvo_mdmid": "7", "region": "IN"}]')
    fake_flow.reset()
    _, body = await call(flow, "GET", "accounts?$filter=lvo_mdmid eq '7' and name eq 'O''Brien'")
    assert len(body["value"]) == 1
    _, body = await call(flow, "GET", "accounts?$filter=lvo_mdmid eq '7' and region eq 'US'")
    assert body["value"] == []


@pytest.mark.asyncio
async def test_bad_filter_is_dataverse_400(flow):
    status, body = await call(flow, "GET", "accounts?$filter=contains(name,'x')")
    assert status == 400 and body["error"]["code"].startswith("0x")


@pytest.mark.asyncio
async def test_create_read_patch_appointment(flow):
    account_id = await _account_id(flow)
    activity_id = str(uuid.uuid4())
    status, created = await call(flow, "POST", "appointments", _appointment(account_id, activityid=activity_id))
    assert status == 201 and created["activityid"] == activity_id
    assert created["_regardingobjectid_value"] == account_id

    status, read = await call(flow, "GET", f"appointments({activity_id})?$select=subject")
    assert status == 200 and read["subject"] == "Test"

    status, body = await call(flow, "PATCH", f"appointments({activity_id})", {"statecode": 1, "statuscode": 3})
    assert status == 204 and body is None
    records = (await flow.get("/_records")).json()
    assert records["appointments"][activity_id]["statecode"] == 1


@pytest.mark.asyncio
async def test_duplicate_activityid_is_412(flow):
    account_id = await _account_id(flow)
    payload = _appointment(account_id, activityid=str(uuid.uuid4()))
    assert (await call(flow, "POST", "appointments", payload))[0] == 201
    status, body = await call(flow, "POST", "appointments", payload)
    assert status == 412 and body["error"]["code"] == "0x80040237"


@pytest.mark.asyncio
async def test_appointment_requires_scheduledend(flow):
    account_id = await _account_id(flow)
    payload = _appointment(account_id)
    del payload["scheduledend"]
    status, body = await call(flow, "POST", "appointments", payload)
    assert status == 400 and "scheduledend" in body["error"]["message"]


@pytest.mark.asyncio
async def test_invalid_status_pair_rejected(flow):
    account_id = await _account_id(flow)
    status, _ = await call(flow, "POST", "appointments", _appointment(account_id, statecode=3, statuscode=4))
    assert status == 400
    status, created = await call(flow, "POST", "appointments", _appointment(account_id))
    status, _ = await call(flow, "PATCH", f"appointments({created['activityid']})", {"statecode": 3, "statuscode": 4})
    assert status == 400


@pytest.mark.asyncio
async def test_bind_to_missing_account_rejected(flow):
    status, body = await call(flow, "POST", "appointments", _appointment(str(uuid.uuid4())))
    assert status == 400 and "Does Not Exist" in body["error"]["message"]


@pytest.mark.asyncio
async def test_get_missing_record_is_404(flow):
    status, body = await call(flow, "GET", f"tasks({uuid.uuid4()})")
    assert status == 404 and body["error"]["code"] == "0x80040217"


@pytest.mark.asyncio
async def test_phonecall_and_task_create(flow):
    account_id = await _account_id(flow)
    for table in ("phonecalls", "tasks"):
        nav = f"regardingobjectid_account_{table[:-1]}@odata.bind"
        status, _ = await call(flow, "POST", table, {"subject": "x", nav: f"/accounts({account_id})"})
        assert status == 201


@pytest.mark.asyncio
async def test_metadata_attributes(flow):
    status, body = await call(flow, "GET",
                              "EntityDefinitions(LogicalName='appointment')/Attributes?$select=LogicalName,AttributeType,RequiredLevel")
    assert status == 200 and body["value"]
