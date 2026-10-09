# P1 — Truthful Logging

**Goal:** on today's architecture (legacy webhook flow), make every write path tell the truth and send correct data. After P1, nothing is shown as logged unless the flow returned a record ID; failures are visible, retryable, and never block re-submission. Also fixes the two platform bugs that break features in prod (CORS PATCH, dead rate limits).

**Recommended model:** Sonnet 5.5.
**Dependencies:** P0 DONE (harness, fake flow, schema facts for status codes).
**Parallel-safe with:** P3 (disjoint files — see ownership). **Not** with P2, P5.
**Branch:** `revamp/p1-truthful-logging`
**Closes:** B01, B02, B03, B04, B05, B06, B07, B08, B09, B10, B12, B13, B25 (and surfaces B11 in the UI).

---

## Files (ownership — only these)

| File | Scope of change |
|---|---|
| `backend/server.py` | only: `_D365_COMPLETED_STATUS`, `_execute_d365_activity`, `execute_workflow`, the chat route's workflow block, `_run_activity_sheet_job`, `_run_batch_job`, `_classify_rows`, `search_accounts`, `get_file_accounts` (search `$or`), `_resolve_rule_accounts`, `d365_webhook_status`, `save_webhook_url`, `monitoring_summary` (counts), CORS middleware args, the three `@limiter.limit` decorator orders, new helper functions listed below |
| `backend/microsoft_auth.py` | `D365_SCOPES` only |
| `backend/timeutil.py` | create |
| `backend/account_match.py` | create |
| `frontend/src/pages/DashboardPage.js` | `onSubmit` payload + toast logic; `ExecStatusBadge` colours |
| `frontend/src/pages/admin/FileManagementPage.js` | activity-sheet parse preview + job progress rendering only |
| `frontend/src/pages/admin/ConnectionsPage.js` | legacy-URL warning only |
| `frontend/src/pages/admin/MonitoringPage.js` | "Pending" label → "Unverified" only |
| `frontend/src/pages/ChatPage.js` | rendering of `workflow_result.status` only (audit first; change only if it mislabels) |
| `frontend/src/pages/ActivitiesPage.js` | status badge mapping only (audit first) |
| `tests/backend/test_p1_*.py` | create |
| `backend/requirements.txt` | add `tzdata` |

**Do not touch:** `activity_sheet_processor.py`, `ai_chat.py`, `prompts/` (owned by P3).

## Dependencies (pre-approved)
`tzdata>=2024.1` (runtime; makes `zoneinfo` work on Windows).

---

## Tasks

### P1.T1 — Status vocabulary and execution finalisation (B03, B04)
- Statuses written by this phase: `success` (record id returned), `unverified` (flow accepted but no id), `failed` (with `error_code`), `dry_run`. **`pending` is only the transient initial state** of a `workflow_executions` doc and must never remain after the request completes.
- Add helper `async def _finalize_execution(execution_id: str, result: dict | None, error: Exception | None) -> None` that always sets `status`, `result`, `d365_record_id`, `error_code`, `error_message`, `completed_at`. Call it in **every** exit of `execute_workflow`, including the `HTTPException` branch (B03).
- `_execute_d365_activity` returns a dict with keys: `status`, `d365_record_id`, `record_url`, `entity_set`, `method`, `error_code`, `error_message`. It no longer raises for transport failures; it returns `status: "failed"` with a code from ARCHITECTURE §6 (`FLOW_NOT_CONFIGURED`, `FLOW_UNREACHABLE`, `FLOW_CONTRACT_VIOLATION`, `CRM_VALIDATION`). `execute_workflow` maps `failed` → HTTP 502 with body `{"detail": <message>, "error_code": <code>, "execution_id": ...}`; others → 200.
- Webhook response without `activityid` → `status: "unverified"`, `error_code: "FLOW_CONTRACT_VIOLATION"`, message "Flow accepted the request but did not return a record ID. Check D365 before retrying."
**Tests:** fake flow modes `ok` → success; `no_id` → unverified; `error` → failed + execution doc not pending; flow URL unset → failed `FLOW_NOT_CONFIGURED`.

### P1.T2 — Transport order and opt-ins (B05, D04)
- Fix `D365_SCOPES` to `[f"{org}/.default"]` built at call time from `D365_ORG_URL` (strip trailing slash). If `D365_ORG_URL` is empty, `get_d365_token` raises `ValueError("D365_ORG_URL not set")`.
- In `_execute_d365_activity`: OAuth path runs **only** if `bot_config.d365_direct_enabled is True`; browser-cookie path runs **only** if `bot_config.d365_browser_fallback_enabled is True`. Both default false. (If P0 evidence shows `method: "browser"` successes in the last 30 days, set the default for the browser flag to the evidence and note it in STATE.md Decisions.)
**Tests:** with flags unset, OAuth/browser functions are never called (monkeypatch to raise if called).

### P1.T3 — Dry run is real (B25)
If `bot_config.dry_run_mode is True`, `_execute_d365_activity` returns `{"status": "dry_run", "method": "dry_run", ...}` after building the payload, without any network call, and logs the payload (redacted) at INFO. Dashboard/Chat/Jobs display "Dry run — nothing was sent to D365".
**Tests:** dry run → no HTTP call (respx asserts zero routes hit), status `dry_run`.

### P1.T4 — Correct payload data (B06, B07, B08)
- `_D365_COMPLETED_STATUS`: set from `D365_SCHEMA.md` (defaults if unverified: appointment `{1,3}`, phonecall `{1,2}`, task `{1,5}`). Comment cites the source.
- Create `backend/timeutil.py`:
  - `to_utc_iso(value: str, tz_name: str) -> str` — accepts ISO with `Z`/offset (convert to UTC) or naive `YYYY-MM-DDTHH:MM[:SS]` (interpret in `tz_name`); returns `YYYY-MM-DDTHH:MM:SSZ`; raises `ValueError` on garbage.
  - `combine_local(date_str: str, time_str: str, tz_name: str) -> str` — same date/time formats as `activity_sheet_processor.combine_datetime` (copy the format lists), interprets in `tz_name`, returns UTC ISO; empty date → `""`.
  - `add_minutes(iso_utc: str, minutes: int) -> str`.
  - `user_timezone(prefs: dict | None) -> str` — `prefs.timezone` → env `DEFAULT_TIMEZONE` → `"Asia/Kolkata"`.
- `_execute_d365_activity`: resolve the user's timezone (`db.user_preferences`), normalise `start_time` via `to_utc_iso`; for appointments always send `scheduledend = start + duration` (if no start: start = now UTC rounded down to the minute, and note it in the description? **No** — if no start for an appointment, use now and set `scheduledend` accordingly). Remove the old `len(st) == 16` hack.
- `_run_activity_sheet_job`: use `timeutil.combine_local(date, time, tz)` instead of `_sheet_combine_datetime`.
- Dashboard `onSubmit`: send `start_time` as `new Date(values.start_time).toISOString()` when present (browser timezone → UTC Z).
**Tests:** IST naive `2026-04-09T12:00` → `2026-04-09T06:30:00Z`; `...Z` passthrough; sheet `01-05-2026` + `11:00 AM` in Asia/Kolkata → `2026-05-01T05:30:00Z`; appointment payload contains `scheduledend`.

### P1.T5 — Account resolution that cannot silently pick the wrong account (B09, B10)
Create `backend/account_match.py`:
- `normalize(name) -> str` (lowercase, strip punctuation, collapse spaces, drop suffixes `ltd, limited, pvt, private, inc, llc, corp, corporation, co`).
- `resolve(regarding: str, accounts: list[dict]) -> dict` returning `{"status": "exact"|"fuzzy"|"ambiguous"|"none", "account_name", "mdm_id_idg", "mdm_id_isg", "score", "candidates": [top3]}`. Rules: exact normalized name or exact MDM ID (IDG or ISG) match wins; else Jaccard via `excel_processor.fuzzy_match(..., threshold=0.6, top_n=3)`; accept only if top score ≥ 0.6 **and** (no second candidate or top − second ≥ 0.15); else `ambiguous` (≥1 candidate) or `none`.
- `pick_mdm(doc) -> str` = IDG if non-empty else ISG.
- Use in: `_run_activity_sheet_job` (unresolved → row `failed` with `error_code` `ACCOUNT_NOT_FOUND`/`ACCOUNT_AMBIGUOUS` and candidates, **no D365 call**), chat route MDM lookup (replace the two regex queries; load the default file's accounts with a projection including both MDM fields), `_resolve_rule_accounts` (`mdm_id = pick_mdm`).
- Webhook payload additionally carries `mdm_id_idg` and `mdm_id_isg` (keep `mdm_id` = `pick_mdm`).
- `search_accounts` and `get_file_accounts`: add `{"l2_mdm_id_isg": regex}` to the `$or`.
- `_classify_rows`: for each new row attach `account_match` (status, account_name, mdm id, score) using the default file's accounts, so the user sees the match **before** executing.
**Tests:** exact, suffix-normalized exact, MDM exact, fuzzy accept, ambiguous (two close), none; ISG-only account resolves.

### P1.T6 — Bulk jobs count truthfully and never block retries (B01, B02)
- `_run_activity_sheet_job` and `_run_batch_job`: `done` increments only for `success`; add `unverified` and `dry_run` counters (`$inc`); `failed` increments for failures. Job doc gains `unverified: 0`, `dry_run: 0` at creation.
- `activity_sheet_log` upsert happens **only** for `success` and `unverified` (store `d365_status` accordingly), never for `failed` or `dry_run`.
- `_classify_rows`: a row is "already logged" only if its log entry has `d365_status == "success"`. Rows with `unverified` go to a new list `unverified_rows` (returned alongside `new_rows`/`duplicate_rows`, with count `total_unverified`). Executing them requires the frontend to send them explicitly (user ticks "Resend unverified").
**Tests:** failed row is not in log and is re-offered as new; unverified row appears in `unverified_rows`; success row is a duplicate.

### P1.T7 — Legacy URL detection (B11 surfacing)
- `d365_webhook_status` adds `legacy_host: bool` (host ends with `logic.azure.com`) and `host` (hostname only).
- `save_webhook_url` rejects hosts ending in `logic.azure.com` with 400 "This is a retired Power Automate URL format (stopped working 30 Nov 2025). Open the flow and copy the new trigger URL."
- ConnectionsPage shows a red inline warning when `legacy_host` is true.
**Tests:** status flags legacy; save rejects legacy, accepts `*.environment.api.powerplatform.com`.

### P1.T8 — Platform fixes (B12, B13)
- CORS `allow_methods` add `"PATCH"`.
- For each `@limiter.limit` usage in server.py: order must be `@api_router.<verb>(...)` first (top), `@limiter.limit(...)` directly under it. Verify with a test that the 11th login attempt within a minute returns 429 (the limiter keys on `X-Forwarded-For`; set it in the test).
**Tests:** OPTIONS preflight for PATCH `/api/user/preferences` with Origin `http://localhost:3000` returns `access-control-allow-methods` containing PATCH; rate limit test.

### P1.T9 — Frontend truth
- `ExecStatusBadge`: `success` green, `confirmed` green, `unverified` amber, `failed` red, `dry_run` grey `#9CA3AF`, unknown → grey.
- Dashboard toasts: success+url → "Activity confirmed in D365" with View action; `unverified` → warning toast "Sent, but D365 did not confirm a record ID. Check D365 before retrying."; `dry_run` → info "Dry run — nothing was sent"; HTTP 502 → error toast with `error_code` and message. Remove the generic "Activity logged" else-branch.
- FileManagementPage sheet flow: preview table shows an "Account match" column (green exact/fuzzy with score, amber ambiguous, red none) and a "Resend unverified" checkbox section; job progress shows confirmed / unverified / failed counts and per-row error codes.
- ChatPage / ActivitiesPage: audit how `status` is rendered; map the new values with the same colours. If already generic, leave untouched and note "no change needed" in HANDOFF.
- MonitoringPage: label only.

---

## Click paths to verify (G4) — against fake flow `/legacy`

1. Login → Dashboard → Log Activity → pick account via search (ISG-only test account too) → submit with a start time → fake mode `ok`: green toast, Recent Executions row green with View link; DB doc `status: success`, `scheduledend` present in fake store, start time in UTC.
2. Same with mode `no_id` → amber toast, amber badge, doc `unverified`.
3. Mode `error` and flow URL unset → red toast with code; doc `failed`, never `pending`.
4. Admin → Connections → toggle dry run on → submit → grey dry-run toast; fake store unchanged.
5. File Management → paste a 4-row sheet (exact, fuzzy, ambiguous, unknown account) → preview shows match column → execute → 2 confirmed, 2 failed with codes → re-paste → failed rows offered as new, confirmed rows as duplicates.
6. Admin → Connections → paste a `logic.azure.com` URL → rejected with message; status shows warning for an existing legacy URL.
7. Profile → change name → saved (PATCH works through CORS when frontend and backend run on different ports).
8. Chat → "log a meeting with <exact account> today at 3pm for 30 minutes" → result rendered truthfully.

## Definition of done
- [ ] All tasks ticked in STATE.md; tests for each
- [ ] DOCTRINE gates G1–G7 green (G7 prod smoke must include Profile name change = PATCH works in prod)
- [ ] Findings listed in "Closes" marked closed in STATE.md
- [ ] HANDOFF.md written; P1 DONE
