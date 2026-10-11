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

## P3 handoff (parallel lane — Model Layer)

**From:** Claude (Sonnet 5.5), P3 session, 2026-10-11, unattended. P1's handoff above is untouched (P1 is still at GATE).
**Phase:** P3 Model Layer — T1–T8 built; G1–G6 green; G7 partial → P3 stays **GATE** (authenticated prod smoke needs credentials).
**Branch:** `revamp/p3-model-layer` (worktree `../loop-p3`), shipped to `main` by fast-forward push.
**Dependency note:** user waived P0's open user tasks for P3 (P3 only uses the P0 harness). P4 was **not** started (P2 is not DONE and the user said not to).

**Done**
- `backend/llm/`: `base.py` (LLMMessage/LLMResult/LLMUnavailable, call-time env), `groq_provider.py`, `gemini_provider.py` (lazy SDK import; roles user/model; system → `system_instruction`; json → `response_mime_type`; retries once without `temperature` if the model rejects it), `router.py` (`primary_name/fallback_name`, `complete_json` = primary → validate → one repair call → fallback → `LLMUnavailable`; `complete_text` returns an `LLMResult`), `schemas.py` (`ChatDecision`).
- `ai_chat.process_message` keeps its signature and return keys; never raises (LLM failure → the existing "trouble processing" clarification, so the chat route no longer 500s on a missing/invalid key). Incomplete triggers (no subject/account, bad duration, no rows) are downgraded to a clarification in the schema.
- Enabled-types contract is enforced in code: if the model picks a type not in `context["enabled_activity_types"]` (default `["appointment"]`) the reply is coerced to an appointment and the message says so. P4 will feed the real list; until then phone calls/tasks are logged as appointments, same as before P3.
- Prompt: phonecall/task mapping, `__ENABLED_TYPES__`, default subjects ("Customer Meeting - <account>", "Call with <account>", "Follow-up - <account>").
- `summarize_notes` uses `complete_text` (0.2 temp, 300 tokens); `groq_client`/`model` args are accepted and ignored; raw notes returned on failure.
- Tests: `tests/backend/test_p3_*.py` + `p3_support.py` (51 tests, no network). Full suite: 138 passed, 1 skipped (live Groq test, needs `REAL_GROQ_API_KEY`).

**IMPORTANT findings for the user**
1. **Groq retired `llama-3.1-8b-instant`.** With the project's Groq key the call returns 404 `model_not_found`, and the key's model list has no Llama model. Unless Railway sets `GROQ_MODEL` to something valid, **production chat has probably been answering "I'm having trouble processing that" since the retirement** (the old code swallowed the 404; not verified on prod, which needs a login). P3 changes the default to `qwen/qwen3.8-27b` (tested: correct JSON for meeting/call/task/question/pasted table, faithful note summaries, 0.3–1 s). `openai/gpt-oss-120b` was rejected: it invented details in a summary. **Action: in Railway → `sales-copilot-api` → Variables, delete `GROQ_MODEL` if it is set to `llama-3.1-8b-instant`.**
2. Gemini default model is `gemini-3.6-flash` (Google lists it as the current stable Flash; `gemini-2.5-flash` has an announced shutdown on 2026-10-16 and was returning 404s for some accounts in July). The Gemini path was only tested against SDK stubs; **no real `GEMINI_API_KEY` was available**. Click path 5 not run.
3. Gemini docs say sampling params (`temperature`) are deprecated on newer models; the provider retries without it when the error mentions temperature.

**Next step (exact)**
1. User: add `GEMINI_API_KEY` (optionally `GEMINI_MODEL`) in Railway when ready; do the Railway `GROQ_MODEL` check above.
2. Run the authenticated prod smoke: log in, open AI Agent, ask "How many accounts do I have?" (the answer must not be the "trouble processing" text), no console errors. Then set P3 DONE in STATE.md.
3. Optional once a Gemini key exists: `LLM_PROVIDER=auto` locally → log line `LLM json ok provider=gemini`.

**Scope requests (server.py is not P3's)**
- `server._run_activity_sheet_job` still builds `AsyncGroq(...)` from `GROQ_API_KEY` and only calls `summarize_notes` when that client exists (`if groq_client and notes_raw`). With Gemini as primary and no Groq key, notes would not be summarised. Fix in P2/P5: drop the client, call `summarize_notes(notes, regarding, date_str)` unconditionally (it already falls back to raw notes), and remove the `GROQ_MODEL` use there.
- Chat-triggered activities do not write `workflow_executions` (pre-existing; `GET /api/workflows/executions` does not list them). Belongs to P2's service.
- Root `requirements.txt` (Render legacy) still lacks `google-genai` and `tzdata`; harmless for Railway (uses `backend/requirements.txt`), Gemini would just be unavailable there.

**Gate results**
- G1: `python -m compileall -q backend` ok; `python -m flake8 backend --select=E9,F63,F7,F82` ok. Frontend untouched (no build needed).
- G2: `python -m pytest tests -q` → 138 passed, 1 skipped.
- G3 (wiring): `POST /api/chat` — caller `frontend/src/pages/ChatPage.js` (`api.post('/chat', {message})`) — request shape unchanged — response keys unchanged (`action, workflow_triggered, workflow_result, clarification_needed, message`); `workflow_triggered` may now be `phonecall`/`task` only when the enabled list contains them (WorkflowCard prints any string) — reads/writes `chat_history`, reads `app_knowledge_base` snapshot via `kb` — indexes unchanged. `POST /api/activity-sheets/execute` (FileManagementPage `handleSheetExecute`) — unchanged contract; notes now summarised through `llm.router`. Dangling refs: `grep -rn "_get_groq_client\|ai_chat.GROQ_MODEL" backend tests scripts` → none.
- G4 (local, HTTP click paths against the real `server.py` over uvicorn, Mongo = in-memory mongomock, **not Atlas**, fake flow `/legacy`, real Groq key from the main `.env`, never printed; the frontend is untouched so no browser run): meeting → appointment, status success, subject "Customer Meeting - Acme Corp"; call → coerced to appointment with the "Logging this as an appointment…" message (default enabled list); task → same; "log a meeting" → asks for the account, nothing sent; webhook/accounts question → correct answer from live state; activity sheet with notes → job `complete {done:1}` and the fake flow received the summarised text; bad Groq key + `LLM_FALLBACK=none` → HTTP 200 with the graceful message, no 500. One unexplained 20 s `TimeoutError` on the first request of a freshly started server in the bad-key run (the router handled it and returned the graceful message; not reproducible standalone or on the second request).
- G5 (data audit, in-memory): `chat_history` 5 user / 5 assistant rows, assistant `workflow_result.status` = success x3, else none; `activity_sheet_jobs` job complete `{total:1, done:1, failed:0}`, no `pending` rows; fake flow store holds the expected records, no duplicates.
- G6 (diff audit): no secrets/tenant data/URLs; no new endpoints; provider error strings are reduced to exception type names in `LLMUnavailable` and logs; prompts and model output are not logged; user text only goes to the configured LLM providers; keys are read from env at call time.
- G7: see the "G7" line appended below after the push.

## Handoff log
- 2026-10-11 — Sonnet 5.5 — P3 T1–T8 built, G1–G6 green; G7 partial (see P3 handoff).
- 2026-10-10 — Sonnet 5.5 — P1 T1–T9 built, G1–G6 green; G7 recorded in STATE.md.
- 2026-10-09 — Opus 5.5 — specs written; awaiting BULLSEYE P0.
