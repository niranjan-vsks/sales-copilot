# HANDOFF

Rules: [DOCTRINE.md §6](DOCTRINE.md). Overwrite "Current handoff" at the end of every session. Append one line to "Handoff log".

---

## Current handoff

**From:** Claude (Sonnet 5.5), P1 session, 2026-10-10
**Phase:** P1 Truthful Logging — all tasks T1–T9 built; G1–G6 green; G7 (deploy + prod verification) see "Next step"
**Branch:** `revamp/p1-truthful-logging` (worktree `../loop-p1`)
**Dependency note:** the user declared P0 done and said go ahead; STATE.md still showed P0 T6 and U1–U6 open, so this was a user waiver. P1 only used P0 T1–T5 (harness, fake flow). `private/D365_SCHEMA.md` is unfilled, so `_D365_COMPLETED_STATUS` uses the Dataverse stock pairs (appointment 1/3, phonecall 1/2, task 1/5) — re-check against the tenant when U5 is done.

**Done this session**
- T1 statuses `success`/`unverified`/`failed`/`dry_run`, `_finalize_execution` on every exit (502 body `{detail, error_code, execution_id}`), T2 OAuth/browser opt-in + `d365_scopes()`, T3 real dry run, T4 `timeutil.py` + UTC payloads + `scheduledend` + status pairs, T5 `account_match.py` wired into chat/sheet/rules/search, T6 honest bulk counters + retry-safe dedup, T7 legacy-host detection, T8 CORS PATCH + limiter order, T9 frontend.
- Tests: 87 pass (59 new in `tests/backend/test_p1_*.py`; helper `p1_support.py`).

**Next step (exact)**
1. If G7 below is not all green: finish it. Prod checks that need the test login (`test_scripts/.env` does not exist on this machine): login, dashboard loads, Profile name change (PATCH) with zero console errors. Run them or give the credentials.
2. Then set P1 DONE in STATE.md, commit, push.
3. P2 may start only when `docs/revamp/private/field_map.json` is real (it is still the `<org>` template) and the generic flow exists (P0 U4/U5).

**Open questions for the user**
- Test-account credentials for the prod smoke (G7), or run the smoke yourself.
- `d365_direct_enabled` / `d365_browser_fallback_enabled` have no admin UI (not in `SettingsUpdateRequest`, outside P1's files). Both default off, which is the intent; set them directly in `bot_config` if you ever need them.

**Scope requests**
- `frontend/src/lib/api.js` drops everything but `detail` from an error body, so the 502's `error_code` never reaches the UI. P1 worked around it with a local `postExecute()` in DashboardPage. Suggest a 3-line change to `api.js` (attach `err.data`) in P5/P6 and then delete `postExecute`.
- `ChatPage.js` mislabelled any unknown status as "awaiting D365 confirmation" — fixed (in scope). `ActivitiesPage.js`: audited, only counts `success`/`d365_status === 'success'`; **no change needed**.

**Decisions made (also in STATE.md)**
- Legacy `pending` activity-sheet log entries and `pending` executions are treated as `unverified` (offered under "Resend unverified", counted as Unverified) — otherwise the rows B02 blocked would stay blocked.
- Chat refuses an ambiguous account (`ACCOUNT_AMBIGUOUS`, nothing sent). An account that matches nothing still proceeds unlinked (existing behaviour).
- Extra error codes outside ARCHITECTURE §6: `INTERNAL_ERROR` (unexpected exception, details only in the server log), `HTTP_<n>` (an HTTPException raised inside a workflow).
- Flow HTTP errors map: 401/403 `FLOW_AUTH_REJECTED`, 400/422 `CRM_VALIDATION`, anything else / network / timeout `FLOW_UNREACHABLE`.
- `microsoft_auth.D365_SCOPES` constant became `d365_scopes()` (call-time, needs `D365_ORG_URL`).
- `monitoring_summary.pending_range` keeps its key and now counts `unverified` + legacy `pending`.

**Gate results**
- G1: `python -m compileall -q backend` ok; `python -m flake8 backend --select=E9,F63,F7,F82` ok; `cd frontend && npm ci --legacy-peer-deps && npm run build` → "Compiled successfully", no warnings.
- G2: `python -m pytest tests -q` → 87 passed (28 baseline + 59 new).
- G3 (wiring):
  - `POST /api/workflows/execute` — caller DashboardPage.js:postExecute — request shape matches: yes (params + UTC `start_time`, `mdm_id_idg/isg`) — response consumed: yes (`status`, `d365_record_url`; 502 `detail`/`error_code`) — writes `workflow_executions`, `app_knowledge_base`; reads `user_preferences`, `bot_config` — index `(user_id, created_at)`: yes.
  - `GET /api/workflows/executions` — DashboardPage:loadExecutions, MonitoringPage — shape unchanged, new statuses rendered — yes.
  - `POST /api/chat` — ChatPage.js:WorkflowCard — `workflow_result.{status,error_code,error_message,error,record_url}` consumed — reads `uploaded_files`, `user_account_data` (index `(user_id,file_id,account_name)`), `bot_config`, `user_preferences`.
  - `POST /api/activity-sheets/parse-text|parse-file` — FileManagementPage:handleSheetParse — consumes `new_rows[].account_match`, `unverified_rows`, `total_unverified`: yes — reads `activity_sheet_log` (unique index `(user_id,serial_no)`).
  - `POST /api/activity-sheets/execute`, `GET /api/activity-sheets/jobs/{id}` — handleSheetExecute / pollSheetJob — `done/failed/unverified/dry_run`, row `error_code` consumed: yes — writes `activity_sheet_jobs` (index yes), `activity_sheet_log`.
  - `POST /api/excel/rules/{id}/preview|execute`, `GET /api/excel/jobs/{id}` — handlePreview / startRun / pollJob — preview rows keep `account_id/mdm_id/name/subject`: yes — writes `batch_jobs` (index yes).
  - `GET /api/accounts/search`, `GET /api/files/{id}/accounts` — account picker / file preview — ISG added to `$or`, response unchanged.
  - `GET /api/d365/webhook/status`, `PUT /api/d365/webhook/url` — ConnectionsPage — `host`, `legacy_host` consumed; 400 `detail` shown via the error toast: yes — `bot_config`.
  - `GET /api/monitoring/summary` — MonitoringPage — keys unchanged.
  - `PATCH /api/auth/me`, `PATCH /api/user/preferences` — UserProfilePage — CORS now allows PATCH.
  - Dangling references: `grep -rn "D365_SCOPES\|_sheet_combine_datetime\|_fuzzy_match" backend` → none left.
- G4 (local click paths; Playwright scripts run against the real `server.py` + real React build, fake flow `/legacy`, Mongo = in-memory mongomock — **not Atlas, not even `sales_copilot_dev`**; login through the real form; chat LLM stubbed because P3 owns it). All 8 spec paths pass, 38 checks, screenshots in the session scratchpad `shots/` (10-path1-ok … 81-chat-ambiguous). Console errors only the expected 4xx/5xx of the failure paths. The existing `test_scripts/` suite was not run: it needs `.env` credentials for prod, which do not exist here.
- G5 (data audit, in-memory DB after the click paths): `workflow_executions` 6 docs = 2 success / 1 unverified / 2 failed / 1 dry_run; zero `pending`; every failed doc has `error_code`; success docs have `d365_record_id`, dry_run has none; `completed_at` set on all. `activity_sheet_jobs`: `{total:4, done:2, failed:2, unverified:0}` rows `success,success,failed,failed`; second job `{done:0, unverified:2, failed:2}`. `activity_sheet_log`: only `11:success, 12:success, 21:unverified, 22:unverified` — no failed/dry-run rows, no duplicate serials.
- G6 (diff security audit): no secrets, tenant URLs or customer data (placeholders only); no new endpoints; every touched query is `user_id`-scoped; no OData/regex injection surface added (search regexes already `re.escape`d); unexpected exception text no longer stored in docs shown in the UI (fixed in `999e5cf`); flow error bodies are shown truncated to 300 chars for `CRM_VALIDATION`/`FLOW_UNREACHABLE` (intended: Dataverse text); login/change-password/chat rate limits now actually applied (tests).
- G7 (shipped `9d5827b`, 2026-10-10): `main` pushed (ff-only, no rebase needed). Railway deployed in ~3 min: `/api/version` commit = `9d5827b93415fb5a42309912c0886aa69b7cbf19` (was `7318529…`), `/healthz` `{"status":"ok"}`, `www.loopcopilot.cc` 200, production login page renders with zero console errors, deployed JS bundle contains the new strings ("did not confirm a record ID", "retired Power Automate URL format", "Account match"), and an `OPTIONS /api/user/preferences` preflight with `Origin: https://www.loopcopilot.cc` and `Access-Control-Request-Method: PATCH` returns 200 with `allow-methods: GET, POST, PUT, PATCH, DELETE, OPTIONS` (B12 fixed in prod). **NOT done: authenticated prod smoke** (login, dashboard loads, Profile name change = real PATCH, zero console errors) — no `test_scripts/.env` on this machine and no credentials were given. Nothing was written to D365 or to the prod DB by this session. P1 therefore stays at GATE until that smoke passes.

**Repo notes for agents**
- Worktree `../loop-p1` has its own `frontend/node_modules` (`npm ci --legacy-peer-deps`). Local E2E harness (not committed): scratchpad scripts `e2e_backend.py` (real server, mongomock), `e2e_flow.py` (fake flow + mode switch), `e2e_stage{2,3,4}.cjs` (Playwright). The installed Playwright expects Chromium 1223; point `executablePath` at `%LOCALAPPDATA%\ms-playwright\chromium-1243\chrome-win64\chrome.exe`.
- Test-support fixture `flow_url` (tests/backend/p1_support.py) runs the fake flow on a real local port; set `FAKE_FLOW_MODE` with `monkeypatch.setenv`.
- Root `CLAUDE.md` / `AGENT.md` are unrelated Jetro content.

## Handoff log
- 2026-10-10 — Sonnet 5.5 — P1 T1–T9 built, G1–G6 green; G7 recorded in STATE.md.
- 2026-10-09 — Opus 5.5 — specs written; awaiting BULLSEYE P0.
