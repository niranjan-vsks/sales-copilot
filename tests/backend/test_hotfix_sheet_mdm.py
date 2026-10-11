"""Hotfix: an MDM ID column in the activity sheet drives account tagging."""
import pytest

import account_match
import server
from activity_sheet_processor import map_columns, normalize_rows
from tests.backend.p1_support import flow_url  # noqa: F401
from tests.backend.test_p1_jobs import ACCOUNTS, _run_sheet, sheet_user  # noqa: F401
from tests.fakes import fake_flow


def test_mdm_column_detected_without_stealing_serial_or_regarding():
    headers = ["MDM ID", "Serial No", "Date", "Time", "Account Name", "Notes"]
    m = map_columns(headers)
    assert m["mdm_id"] == "MDM ID" and m["serial_no"] == "Serial No" and m["regarding"] == "Account Name"
    assert map_columns(["ID", "Regarding", "L2_MDM_ID-IDG"])["serial_no"] == "ID"
    assert map_columns(["ID", "Regarding", "L2_MDM_ID-IDG"])["mdm_id"] == "L2_MDM_ID-IDG"


def test_normalize_rows_keeps_mdm():
    rows = normalize_rows([{"MDM": "12345.0", "Sno": "1"}], map_columns(["MDM", "Sno"]))
    assert rows[0]["mdm_id"] == "12345.0" and rows[0]["regarding"] == ""


def test_resolve_row_mdm_wins_and_falls_back():
    by_list = account_match.resolve_row("totally different name", "IDG-4", ACCOUNTS)
    assert by_list["status"] == "exact" and by_list["account_name"] == "Northwind Traders Asia"
    isg = account_match.resolve_row("", "ISG-9", ACCOUNTS)
    assert isg["status"] == "exact" and isg["mdm_id_isg"] == "ISG-9"
    direct = account_match.resolve_row("Apollo Sugar Clinics", "998877.0", ACCOUNTS)
    assert direct["status"] == "mdm" and direct["mdm_id_idg"] == "998877"
    assert direct["account_name"] == "Apollo Sugar Clinics"
    assert account_match.resolve_row("Acme Technologies", "", ACCOUNTS)["status"] == "exact"


@pytest.mark.asyncio
async def test_sheet_with_mdm_column_logs_with_that_mdm(db, sheet_user):
    rows = [
        {"serial_no": "M1", "regarding": "Northwind Traders", "mdm_id": "IDG-5", "date": "01-05-2026", "time": "", "notes": ""},
        {"serial_no": "M2", "regarding": "Apollo Sugar Clinics", "mdm_id": "998877", "date": "01-05-2026", "time": "", "notes": ""},
    ]
    preview = (await server._classify_rows(sheet_user.user_id, rows, {}))["data"]["new_rows"]
    assert [r["account_match"]["status"] for r in preview] == ["exact", "mdm"]

    job = await _run_sheet(db, sheet_user, rows)
    assert job["done"] == 2 and job["failed"] == 0
    sent = [s["payload"] for s in fake_flow.STORE["legacy"]]
    assert sent[0]["account"] == "Northwind Traders Europe" and sent[0]["mdm_id"] == "IDG-5"
    assert sent[1]["account"] == "Apollo Sugar Clinics" and sent[1]["mdm_id"] == "998877"


@pytest.mark.asyncio
async def test_parse_text_accepts_mdm_without_regarding(auth_client, db):
    text = "Serial No\tDate\tMDM ID\n1\t01-05-2026\t12345"
    r = await auth_client.post("/api/activity-sheets/parse-text", json={"text": text})
    assert r.status_code == 200
    row = r.json()["data"]["new_rows"][0]
    assert row["mdm_id"] == "12345" and row["account_match"]["status"] == "mdm"


def test_short_form_name_matches_single_account_only():
    accts = [{"account_name": "AUROBINDO PHARMA LIMITED", "l2_mdm_id_idg": "PA1", "l2_mdm_id_isg": ""},
             {"account_name": "APOLLO SUGAR CLINICS LIMITED", "l2_mdm_id_idg": "PA2", "l2_mdm_id_isg": ""},
             {"account_name": "APOLLO TELEHEALTH SERVICES PRIVATE LIMITED", "l2_mdm_id_idg": "PA3", "l2_mdm_id_isg": ""}]
    r = account_match.resolve("Aurobindo", accts)
    assert r["status"] == "fuzzy" and r["mdm_id_idg"] == "PA1"
    assert account_match.resolve("Apollo", accts)["status"] != "fuzzy" or False  # two Apollos → never auto-picked


def test_two_digit_year_dates_parse():
    import timeutil
    assert timeutil.combine_local("27-Apr-26", "3:30PM", "Asia/Kolkata") == "2026-04-27T10:00:00Z"
    assert timeutil.combine_local("28-Apr-26", "4:30 PM", "Asia/Kolkata") == "2026-04-28T11:00:00Z"


@pytest.mark.asyncio
async def test_no_default_file_falls_back_to_latest_upload(db):
    from datetime import datetime, timezone
    await db.uploaded_files.insert_one({"file_id": "f-new", "user_id": "u1", "is_default": False,
                                        "uploaded_at": datetime.now(timezone.utc)})
    await db.user_account_data.insert_one({"file_id": "f-new", "user_id": "u1", "account_name": "NEULAND LABORATORIES LIMITED",
                                           "l2_mdm_id_idg": "PA9", "l2_mdm_id_isg": ""})
    accounts = await server._load_default_accounts("u1")
    assert account_match.resolve("neuland", accounts)["mdm_id_idg"] == "PA9"


SHEET_ACCTS = [{"account_name": "NEULAND LABORATORIES LIMITED", "l2_mdm_id_idg": "PA1", "l2_mdm_id_isg": ""},
               {"account_name": "AUROBINDO PHARMA LIMITED", "l2_mdm_id_idg": "PA2", "l2_mdm_id_isg": ""}]


async def _seed(db, user_id="user_x"):
    from datetime import datetime, timezone
    await db.uploaded_files.insert_one({"file_id": "fx", "user_id": user_id, "is_default": True,
                                        "uploaded_at": datetime.now(timezone.utc)})
    for a in SHEET_ACCTS:
        await db.user_account_data.insert_one({**a, "file_id": "fx", "user_id": user_id})


async def _parse(client, db, text):
    me = (await client.get("/api/auth/me")).json()
    await _seed(db, me["user_id"])
    r = await client.post("/api/activity-sheets/parse-text", json={"text": text})
    assert r.status_code == 200, r.text
    return r.json()["data"]


@pytest.mark.asyncio
@pytest.mark.parametrize("text", [
    "Sno\tDate\tRegarding\tTime\tNotes\n1\t11-10-2026\tneuland\t11:00 AM\tx\n2\t27-Apr-26\tAurobindo\t11:30\ty",
    "1\t11-10-2026\tneuland\t11:00 AM\tx\n2\t27-Apr-26\tAurobindo\t11:30\ty",                     # no header row
    "Sno,Date,Regarding,Time,Notes\n1,11-10-2026,neuland,11:00 AM,x\n2,27-Apr-26,Aurobindo,11:30,y",
    '[{"Sno":1,"Date":"11-10-2026","Regarding":"neuland","Time":"11:00 AM","Notes":"x"},'
    ' {"Sno":2,"Date":"27-Apr-26","Regarding":"Aurobindo","Time":"11:30","Notes":"y"}]',
    '{"rows":[{"Date":"11-10-2026","Account":"neuland"},{"Date":"27-Apr-26","Account":"Aurobindo"}]}',  # JSON, no serial
])
async def test_every_paste_format_tags_accounts(auth_client, db, text):
    data = await _parse(auth_client, db, text)
    got = [(r["account_match"]["status"], r["account_match"]["mdm_id"]) for r in data["new_rows"]]
    assert got == [("fuzzy", "PA1"), ("fuzzy", "PA2")]


@pytest.mark.asyncio
async def test_reused_serial_numbers_are_not_mistaken_for_logged_rows(auth_client, db):
    me = (await auth_client.get("/api/auth/me")).json()
    await db.activity_sheet_log.insert_one({"user_id": me["user_id"], "serial_no": "1", "d365_status": "success",
                                           "regarding": "SOME OTHER ACCOUNT", "date": "01-01-2026"})
    data = await _parse(auth_client, db, "Sno\tDate\tRegarding\n1\t11-10-2026\tneuland")
    assert data["total_new"] == 1 and data["total_duplicate"] == 0
