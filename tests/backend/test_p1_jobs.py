"""P1.T5 / P1.T6 — account resolution wiring, truthful bulk-job counters, retry-safe dedup."""
import uuid
from datetime import datetime, timezone

import pytest
import pytest_asyncio

import server
from tests.backend.p1_support import flow_url, make_user_obj, seed_accounts, set_config  # noqa: F401
from tests.fakes import fake_flow

ACCOUNTS = [
    {"account_name": "Acme Technologies Ltd", "l2_mdm_id_idg": "IDG-1", "l2_mdm_id_isg": ""},
    {"account_name": "ISG Only Holdings", "l2_mdm_id_idg": "", "l2_mdm_id_isg": "ISG-9"},
    {"account_name": "Northwind Traders Asia", "l2_mdm_id_idg": "IDG-4", "l2_mdm_id_isg": ""},
    {"account_name": "Northwind Traders Europe", "l2_mdm_id_idg": "IDG-5", "l2_mdm_id_isg": ""},
    {"account_name": "Initech Solutions Group", "l2_mdm_id_idg": "IDG-6", "l2_mdm_id_isg": ""},
]

SHEET_ROWS = [
    {"serial_no": "S1", "regarding": "Acme Technologies", "date": "01-05-2026", "time": "11:00 AM", "notes": ""},
    {"serial_no": "S2", "regarding": "Initech Solutions Group India", "date": "01-05-2026", "time": "", "notes": ""},
    {"serial_no": "S3", "regarding": "Northwind Traders", "date": "01-05-2026", "time": "", "notes": ""},
    {"serial_no": "S4", "regarding": "Zzz Unknown Co", "date": "01-05-2026", "time": "", "notes": ""},
]


async def _run_sheet(db, user, rows):
    job_id = str(uuid.uuid4())
    await db.activity_sheet_jobs.insert_one({
        "id": job_id, "user_id": user.user_id, "total": len(rows), "done": 0, "failed": 0,
        "unverified": 0, "dry_run": 0, "status": "running",
        "rows": [{"serial_no": r["serial_no"], "status": "pending"} for r in rows],
    })
    await server._run_activity_sheet_job(job_id, user, rows)
    return await db.activity_sheet_jobs.find_one({"id": job_id}, {"_id": 0})


@pytest_asyncio.fixture
async def sheet_user(db, flow_url):
    await set_config(db, power_automate_webhook_url=flow_url)
    user = await make_user_obj(db)
    await seed_accounts(db, user.user_id, ACCOUNTS)
    return user


# ── T5 + T6: the 4-row sheet ──────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_sheet_two_confirmed_two_failed_with_codes(db, sheet_user):
    job = await _run_sheet(db, sheet_user, SHEET_ROWS)
    assert (job["done"], job["failed"], job["unverified"], job["dry_run"]) == (2, 2, 0, 0)
    assert job["status"] == "complete"
    by_serial = {r["serial_no"]: r for r in job["rows"]}
    assert by_serial["S1"]["status"] == "success" and by_serial["S2"]["status"] == "success"
    assert by_serial["S3"]["status"] == "failed" and by_serial["S3"]["error_code"] == "ACCOUNT_AMBIGUOUS"
    assert set(by_serial["S3"]["candidates"]) == {"Northwind Traders Asia", "Northwind Traders Europe"}
    assert by_serial["S4"]["error_code"] == "ACCOUNT_NOT_FOUND"
    # unresolved rows never reached D365
    assert len(fake_flow.STORE["legacy"]) == 2
    first = fake_flow.STORE["legacy"][0]["payload"]
    assert first["account"] == "Acme Technologies Ltd" and first["mdm_id"] == "IDG-1"
    assert first["scheduledstart"] == "2026-05-01T05:30:00Z"        # 11:00 IST
    assert first["scheduledend"] == "2026-05-01T06:30:00Z"          # 60 minute sheet meetings


@pytest.mark.asyncio
async def test_failed_rows_are_offered_again_and_confirmed_are_duplicates(db, sheet_user):
    await _run_sheet(db, sheet_user, SHEET_ROWS)
    logged = {e["serial_no"]: e["d365_status"] for e in await db.activity_sheet_log.find({}, {"_id": 0}).to_list(10)}
    assert logged == {"S1": "success", "S2": "success"}          # failed rows never logged

    out = (await server._classify_rows(sheet_user.user_id, SHEET_ROWS, {}))["data"]
    assert [r["serial_no"] for r in out["duplicate_rows"]] == ["S1", "S2"]
    assert [r["serial_no"] for r in out["new_rows"]] == ["S3", "S4"]
    assert out["total_new"] == 2 and out["total_duplicate"] == 2 and out["total_unverified"] == 0
    statuses = {r["serial_no"]: r["account_match"]["status"] for r in out["new_rows"]}
    assert statuses == {"S3": "ambiguous", "S4": "none"}


@pytest.mark.asyncio
async def test_classify_attaches_account_match_before_execution(db, sheet_user):
    out = (await server._classify_rows(sheet_user.user_id, SHEET_ROWS, {}))["data"]
    m = {r["serial_no"]: r["account_match"] for r in out["new_rows"]}
    assert m["S1"]["status"] == "exact" and m["S1"]["mdm_id"] == "IDG-1"
    assert m["S2"]["status"] == "fuzzy" and m["S2"]["score"] >= 0.6
    assert m["S3"]["status"] == "ambiguous" and len(m["S3"]["candidates"]) == 2
    assert m["S4"]["status"] == "none"


@pytest.mark.asyncio
async def test_isg_only_account_links_with_isg(db, sheet_user):
    rows = [{"serial_no": "I1", "regarding": "ISG Only Holdings", "date": "01-05-2026", "time": "", "notes": ""}]
    job = await _run_sheet(db, sheet_user, rows)
    assert job["done"] == 1
    sent = fake_flow.STORE["legacy"][0]["payload"]
    assert sent["mdm_id"] == "ISG-9" and sent["mdm_id_isg"] == "ISG-9" and sent["mdm_id_idg"] == ""


@pytest.mark.asyncio
async def test_unverified_rows_counted_separately_logged_and_offered_for_resend(db, sheet_user, monkeypatch):
    monkeypatch.setenv("FAKE_FLOW_MODE", "no_id")
    job = await _run_sheet(db, sheet_user, SHEET_ROWS[:1])
    assert (job["done"], job["unverified"], job["failed"]) == (0, 1, 0)
    assert job["rows"][0]["status"] == "unverified" and job["rows"][0]["error_code"] == "FLOW_CONTRACT_VIOLATION"
    entry = await db.activity_sheet_log.find_one({"serial_no": "S1"})
    assert entry["d365_status"] == "unverified"

    out = (await server._classify_rows(sheet_user.user_id, SHEET_ROWS[:1], {}))["data"]
    assert [r["serial_no"] for r in out["unverified_rows"]] == ["S1"]
    assert out["total_unverified"] == 1 and out["new_rows"] == [] and out["duplicate_rows"] == []


@pytest.mark.asyncio
async def test_flow_failure_is_failed_not_logged_and_retryable(db, sheet_user, monkeypatch):
    monkeypatch.setenv("FAKE_FLOW_MODE", "error")
    job = await _run_sheet(db, sheet_user, SHEET_ROWS[:1])
    assert (job["done"], job["failed"]) == (0, 1)
    assert await db.activity_sheet_log.count_documents({}) == 0
    out = (await server._classify_rows(sheet_user.user_id, SHEET_ROWS[:1], {}))["data"]
    assert [r["serial_no"] for r in out["new_rows"]] == ["S1"]


@pytest.mark.asyncio
async def test_dry_run_rows_counted_and_not_logged(db, sheet_user):
    await set_config(db, dry_run_mode=True)
    job = await _run_sheet(db, sheet_user, SHEET_ROWS[:1])
    assert (job["done"], job["dry_run"], job["failed"], job["unverified"]) == (0, 1, 0, 0)
    assert await db.activity_sheet_log.count_documents({}) == 0
    assert fake_flow.STORE["legacy"] == []


@pytest.mark.asyncio
async def test_legacy_pending_log_entries_are_unverified_not_blocking(db, sheet_user):
    await db.activity_sheet_log.insert_one({"user_id": sheet_user.user_id, "serial_no": "S1", "d365_status": "pending"})
    out = (await server._classify_rows(sheet_user.user_id, SHEET_ROWS[:1], {}))["data"]
    assert [r["serial_no"] for r in out["unverified_rows"]] == ["S1"]


@pytest.mark.asyncio
async def test_no_account_list_fails_rows_cleanly(db, flow_url):
    await set_config(db, power_automate_webhook_url=flow_url)
    user = await make_user_obj(db)
    job = await _run_sheet(db, user, SHEET_ROWS[:1])
    assert job["failed"] == 1 and job["rows"][0]["error_code"] == "ACCOUNT_NOT_FOUND"
    assert "Upload" in job["rows"][0]["error_message"]
    assert fake_flow.STORE["legacy"] == []


# ── batch rules ───────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_batch_job_counts_truthfully(db, sheet_user, monkeypatch):
    rule = {"subject_template": "Review {name}", "duration_minutes": 30}
    accounts = await server._resolve_rule_accounts({"account_filter": "all"}, sheet_user.user_id)
    isg_only = next(a for a in accounts if a["name"] == "ISG Only Holdings")
    assert isg_only["mdm_id"] == "ISG-9" and isg_only["account_id"] == "ISG-9"

    async def run(mode):
        monkeypatch.setenv("FAKE_FLOW_MODE", mode)
        job_id = str(uuid.uuid4())
        await db.batch_jobs.insert_one({
            "id": job_id, "user_id": sheet_user.user_id, "total": 1, "done": 0, "failed": 0,
            "unverified": 0, "dry_run": 0, "rows": [{}], "created_at": datetime.now(timezone.utc),
        })
        await server._run_batch_job(job_id, sheet_user, rule, accounts[:1])
        return await db.batch_jobs.find_one({"id": job_id}, {"_id": 0})

    ok = await run("ok")
    assert (ok["done"], ok["unverified"], ok["failed"]) == (1, 0, 0)
    no_id = await run("no_id")
    assert (no_id["done"], no_id["unverified"], no_id["failed"]) == (0, 1, 0)
    err = await run("error")
    assert (err["done"], err["unverified"], err["failed"]) == (0, 0, 1)
    assert err["rows"][0]["error_code"] == "FLOW_UNREACHABLE"


@pytest.mark.asyncio
async def test_rule_filter_matches_isg_ids(db, sheet_user):
    accounts = await server._resolve_rule_accounts({"account_filter": "ISG-9"}, sheet_user.user_id)
    assert [a["name"] for a in accounts] == ["ISG Only Holdings"]


# ── search endpoints ──────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_search_and_file_accounts_match_isg(auth_client, db):
    me = (await auth_client.get("/api/auth/me")).json()
    await seed_accounts(db, me["user_id"], ACCOUNTS, file_id="f-search")
    await db.uploaded_files.update_one({"file_id": "f-search"}, {"$set": {"row_count": 5}})
    r = await auth_client.get("/api/accounts/search", params={"q": "ISG-9"})
    assert [a["account_name"] for a in r.json()["data"]["results"]] == ["ISG Only Holdings"]
    r = await auth_client.get("/api/files/f-search/accounts", params={"q": "ISG-9"})
    assert [a["account_name"] for a in r.json()["data"]["accounts"]] == ["ISG Only Holdings"]


# ── chat route ────────────────────────────────────────────────────────────────

def _chat_ai(account):
    async def fake_process(message, user_id, history, context_snapshot=None):
        return {"action": "trigger_workflow", "workflow_type": "log_activity", "user_message": "ok",
                "payload": {"account": account, "subject": "Meeting", "duration_minutes": 30,
                            "start_time": "2026-04-09T15:00"}}
    return fake_process


@pytest.mark.asyncio
async def test_chat_links_isg_only_account(auth_client, db, flow_url, monkeypatch):
    me = (await auth_client.get("/api/auth/me")).json()
    await set_config(db, power_automate_webhook_url=flow_url)
    await seed_accounts(db, me["user_id"], ACCOUNTS)
    monkeypatch.setattr(server, "process_message", _chat_ai("ISG Only Holdings"))
    r = await auth_client.post("/api/chat", json={"message": "log a meeting"})
    assert r.status_code == 200
    assert r.json()["workflow_result"]["status"] == "success"
    sent = fake_flow.STORE["legacy"][0]["payload"]
    assert sent["mdm_id"] == "ISG-9" and sent["scheduledend"] == "2026-04-09T10:00:00Z"


@pytest.mark.asyncio
async def test_chat_refuses_ambiguous_account(auth_client, db, flow_url, monkeypatch):
    me = (await auth_client.get("/api/auth/me")).json()
    await set_config(db, power_automate_webhook_url=flow_url)
    await seed_accounts(db, me["user_id"], ACCOUNTS)
    monkeypatch.setattr(server, "process_message", _chat_ai("Northwind Traders"))
    r = await auth_client.post("/api/chat", json={"message": "log a meeting"})
    result = r.json()["workflow_result"]
    assert result["status"] == "failed" and result["error_code"] == "ACCOUNT_AMBIGUOUS"
    assert fake_flow.STORE["legacy"] == []


@pytest.mark.asyncio
async def test_chat_reports_flow_failure_truthfully(auth_client, db, monkeypatch):
    monkeypatch.setattr(server, "process_message", _chat_ai("Anyone"))
    r = await auth_client.post("/api/chat", json={"message": "log a meeting"})
    result = r.json()["workflow_result"]
    assert result["status"] == "failed" and result["error_code"] == "FLOW_NOT_CONFIGURED" and result["error"]
