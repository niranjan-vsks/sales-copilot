"""P1.T4 / P1.T5 — pure helper modules."""
import pytest

import account_match
import timeutil

ACCOUNTS = [
    {"account_name": "Acme Technologies Ltd", "l2_mdm_id_idg": "IDG-1", "l2_mdm_id_isg": ""},
    {"account_name": "Globex Corporation", "l2_mdm_id_idg": "IDG-2", "l2_mdm_id_isg": "ISG-2"},
    {"account_name": "ISG Only Holdings", "l2_mdm_id_idg": "", "l2_mdm_id_isg": "ISG-9"},
    {"account_name": "Northwind Traders Asia", "l2_mdm_id_idg": "IDG-4", "l2_mdm_id_isg": ""},
    {"account_name": "Northwind Traders Europe", "l2_mdm_id_idg": "IDG-5", "l2_mdm_id_isg": ""},
    {"account_name": "Initech Solutions Group", "l2_mdm_id_idg": "IDG-6", "l2_mdm_id_isg": ""},
]


# ── timeutil ──────────────────────────────────────────────────────────────────

def test_naive_ist_to_utc():
    assert timeutil.to_utc_iso("2026-04-09T12:00", "Asia/Kolkata") == "2026-04-09T06:30:00Z"


def test_z_passthrough_and_offset_conversion():
    assert timeutil.to_utc_iso("2026-04-09T06:30:00Z", "Asia/Kolkata") == "2026-04-09T06:30:00Z"
    assert timeutil.to_utc_iso("2026-04-09T12:00:00+05:30", "UTC") == "2026-04-09T06:30:00Z"
    assert timeutil.to_utc_iso("2026-04-09T06:30:00.000Z", "UTC") == "2026-04-09T06:30:00Z"


@pytest.mark.parametrize("bad", ["", "   ", "garbage", "2026-13-45T99:99"])
def test_to_utc_iso_rejects_garbage(bad):
    with pytest.raises(ValueError):
        timeutil.to_utc_iso(bad, "Asia/Kolkata")


def test_unknown_timezone_raises():
    with pytest.raises(ValueError):
        timeutil.to_utc_iso("2026-04-09T12:00", "Not/AZone")


def test_combine_local_sheet_formats():
    assert timeutil.combine_local("01-05-2026", "11:00 AM", "Asia/Kolkata") == "2026-05-01T05:30:00Z"
    assert timeutil.combine_local("2026-05-01", "14:30", "Asia/Kolkata") == "2026-05-01T09:00:00Z"
    assert timeutil.combine_local("01-05-2026", "", "Asia/Kolkata") == "2026-04-30T18:30:00Z"
    assert timeutil.combine_local("", "11:00 AM", "Asia/Kolkata") == ""
    assert timeutil.combine_local("not a date", "11:00 AM", "Asia/Kolkata") == ""


def test_add_minutes():
    assert timeutil.add_minutes("2026-04-09T06:30:00Z", 45) == "2026-04-09T07:15:00Z"
    assert timeutil.add_minutes("2026-04-09T23:50:00Z", 20) == "2026-04-10T00:10:00Z"


def test_user_timezone_precedence(monkeypatch):
    monkeypatch.delenv("DEFAULT_TIMEZONE", raising=False)
    assert timeutil.user_timezone(None) == "Asia/Kolkata"
    assert timeutil.user_timezone({"timezone": "America/New_York"}) == "America/New_York"
    monkeypatch.setenv("DEFAULT_TIMEZONE", "Europe/London")
    assert timeutil.user_timezone({}) == "Europe/London"
    assert timeutil.user_timezone({"timezone": "Bogus/Zone"}) == "Europe/London"


# ── account_match ─────────────────────────────────────────────────────────────

def test_normalize_drops_suffixes_and_punctuation():
    assert account_match.normalize("  ACME Technologies, Ltd.  ") == "acme technologies"
    assert account_match.normalize("Globex Corporation") == "globex"


def test_exact_name():
    r = account_match.resolve("Globex Corporation", ACCOUNTS)
    assert r["status"] == "exact" and r["account_name"] == "Globex Corporation"
    assert r["mdm_id_idg"] == "IDG-2" and r["mdm_id_isg"] == "ISG-2"


def test_suffix_normalized_exact():
    r = account_match.resolve("acme technologies", ACCOUNTS)
    assert r["status"] == "exact" and r["account_name"] == "Acme Technologies Ltd"


def test_mdm_exact_idg_and_isg():
    assert account_match.resolve("IDG-4", ACCOUNTS)["account_name"] == "Northwind Traders Asia"
    r = account_match.resolve("ISG-9", ACCOUNTS)
    assert r["status"] == "exact" and r["account_name"] == "ISG Only Holdings"


def test_isg_only_account_picks_isg():
    r = account_match.resolve("ISG Only Holdings", ACCOUNTS)
    assert r["status"] == "exact"
    doc = {"l2_mdm_id_idg": r["mdm_id_idg"], "l2_mdm_id_isg": r["mdm_id_isg"]}
    assert account_match.pick_mdm(doc) == "ISG-9"


def test_pick_mdm_prefers_idg():
    assert account_match.pick_mdm({"l2_mdm_id_idg": "A", "l2_mdm_id_isg": "B"}) == "A"
    assert account_match.pick_mdm({"l2_mdm_id_idg": "", "l2_mdm_id_isg": "B"}) == "B"
    assert account_match.pick_mdm({}) == ""


def test_fuzzy_accept():
    r = account_match.resolve("Initech Solutions", ACCOUNTS)
    assert r["status"] in ("exact", "fuzzy") and r["account_name"] == "Initech Solutions Group"
    r = account_match.resolve("Initech Solutions Group India", ACCOUNTS)
    assert r["status"] == "fuzzy" and r["account_name"] == "Initech Solutions Group"
    assert r["score"] >= 0.6


def test_ambiguous_two_close_candidates():
    r = account_match.resolve("Northwind Traders", ACCOUNTS)
    assert r["status"] == "ambiguous"
    assert r["account_name"] == "" and r["mdm_id_idg"] == ""
    names = {c["account_name"] for c in r["candidates"]}
    assert names == {"Northwind Traders Asia", "Northwind Traders Europe"}


def test_duplicate_exact_names_are_ambiguous():
    dupes = [
        {"account_name": "Same Name", "l2_mdm_id_idg": "1", "l2_mdm_id_isg": ""},
        {"account_name": "Same Name Ltd", "l2_mdm_id_idg": "2", "l2_mdm_id_isg": ""},
    ]
    assert account_match.resolve("Same Name", dupes)["status"] == "ambiguous"


def test_none():
    assert account_match.resolve("Totally Unknown Company", ACCOUNTS)["status"] == "none"
    assert account_match.resolve("", ACCOUNTS)["status"] == "none"
    assert account_match.resolve("Acme", [])["status"] == "none"
