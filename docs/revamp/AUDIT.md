# Audit — Loop Copilot / Sales Copilot (baseline)

Baseline commit: `ab7e7f0` (main == feat/product-v2). Line references are valid **at that commit only**; after any phase lands, search by symbol name, not line number.

Every finding has an ID. Phase specs reference these IDs. When a phase fixes one, it marks it in [STATE.md](STATE.md) under "Findings closed".

Severity: **S1** = records silently not reaching D365 / data integrity. **S2** = security or broken feature. **S3** = correctness/UX debt.

---

## A. Why records are not landing in D365 (the reported bug)

The live write path for every entry point (Dashboard form, AI chat, activity sheet, rules engine) is `_execute_d365_activity()` in `backend/server.py`. It tries three transports in order: OAuth → Power Automate webhook → browser cookies. Only the webhook can work for Lenovo.

| ID | Sev | Finding | Where |
|---|---|---|---|
| B01 | S1 | Bulk jobs count `pending` as **done**. A row the flow never confirmed shows as logged. | `_run_activity_sheet_job` (`is_done = status in ("success","pending")`, server.py:2098); `_run_batch_job` (`inc_done`, server.py:1627) |
| B02 | S1 | Activity-sheet rows with status `pending` are upserted into `activity_sheet_log`. Dedup (`_classify_rows`) reads that log, so a row that never reached D365 is **permanently blocked** as "already logged". | server.py:2080–2094, 1938–1958 |
| B03 | S1 | `execute_workflow` re-raises `HTTPException` without updating the execution doc. When all transports fail (503), the execution stays `pending` forever in Recent Executions / Monitoring. | server.py:722–723 |
| B04 | S1 | Webhook HTTP 200/202 **without** `activityid` is recorded as `pending` ("accepted"), not failure. A PA flow without a Response action returns 202 immediately — the app cannot tell success from failure. Dashboard then shows a neutral/positive toast. | server.py:579–605; DashboardPage.js:233–244 |
| B11 | S1 (suspected, verify in P0) | Microsoft retired legacy `*.logic.azure.com` HTTP-trigger URLs on **2025-11-30**; callers still using them fail. If the URL saved in Admin → Connections (`bot_config.power_automate_webhook_url`) is the old host, **every** webhook call fails. | `bot_config` document; Connections page |
| B05 | S1 | D365 OAuth scope is `https://dynamics.microsoft.com/user_impersonation`. Dataverse requires `https://<org>.crm.dynamics.com/.default` (or `/user_impersonation`). Path 1 can never succeed even in a consenting tenant; every write pays a failed MSAL round-trip first. | microsoft_auth.py:36–38 |
| B06 | S1 | Appointment "completed" status pair is `{statecode: 3, statuscode: 4}`. For appointments statuscode 4 = Canceled (belongs to statecode 2). Completed = `{1, 3}`. If the flow passes these through, Dataverse rejects or files as canceled. | server.py:86–90 |
| B07 | S1 | Times are local (IST) but suffixed with `Z` → stored 5h30m off. Same bug in activity-sheet `combine_datetime`. Dashboard sends raw `datetime-local` value (no offset). | server.py:526–533; activity_sheet_processor.py:157–169; DashboardPage.js form |
| B08 | S1 | Appointments are sent without `scheduledend`. | `_execute_d365_activity` payload |
| B09 | S2 | Account linking uses only `l2_mdm_id_idg` in chat, activity-sheet and rules paths; ISG-only accounts never link. Search endpoints also only match IDG. (Dashboard form sends `idg || isg`.) | server.py:848, 1560, 1854, 2024 |
| B10 | S1 | Activity-sheet account resolution uses Jaccard token fuzzy match with threshold 0.35 and takes the top hit silently → wrong account + wrong MDM ID attached with no warning. | server.py:2053–2057; excel_processor.fuzzy_match |
| B25 | S1 | Admin "Dry run mode" toggle is saved to `bot_config` but **never read**. Admin believes writes are simulated; they are real. | server.py:137, ConnectionsPage.js:184 |
| B15 | S2 | The PA flow is hand-built per activity type (Switch cases, manual field mapping, manual Response JSON). Adding a filter or field requires editing the flow + backend. Fragile by design. | Power Automate (outside repo) |
| B16 | S3 | `get_d365_token` never caches tokens and never persists rotated refresh tokens. | microsoft_auth.py:200–246 |
| B14 | S3 | Chat forces `activity_type="appointment"` and subtype "Customer Meeting" for every chat-triggered write. | server.py:831–832; prompts/ai_chat_system.txt |
| B22 | S3 | Rules-engine batch writes appointments with no `start_time`. | `_run_batch_job` |

**Most probable root cause chain (to be proven in P0 with logs):** B11 (dead URL) or a flow without a proper Response action → B04 records it as `pending` (or B03 leaves it `pending`) → B01 counts it as done → B02 blocks retry. Even when a write gets through, B06/B07/B08 can make Dataverse reject it or store wrong data, and B10 can attach it to the wrong account.

---

## B. Security / platform

| ID | Sev | Finding | Where |
|---|---|---|---|
| B12 | S2 | CORS `allow_methods` omits `PATCH` → every PATCH from the browser fails preflight in prod (profile name, preferences). | server.py:2129 |
| B13 | S2 | `@limiter.limit` is placed **above** `@api_router.post(...)`, so the router registered the undecorated function — rate limits on login, change-password and chat are not applied. Signup/OTP endpoints have no limits at all. | server.py:373, 401, 767; auth_signup.py |
| B17 | S2 | Startup promotes the earliest email-signup user to admin on **every boot**, regardless of intent. | server.py:2194–2204 |
| B18 | S2 | Telegram bot tokens stored in plaintext in `user_preferences`. | server.py:1161–1171 |
| B23 | S2 | Legacy `accounts` collection is global (no `user_id`); `/accounts/search` falls back to it → cross-user data exposure. | server.py:1456–1499, 1863–1876 |
| B24 | S2 | `/excel/accounts/import` lets any authenticated rep overwrite the global `accounts` collection. | server.py:1456 |
| B19 | S3 | `load_dotenv()` runs after module imports; module-level env reads (`GROQ_MODEL`, `D365_ORG_URL` in d365_client) ignore `.env` in local dev. | server.py:29–38; ai_chat.py:26 |
| B26 | S3 | `backend/railway.json` start command uses `$PORT`, `backend/Procfile` hardcodes 3000, memory says "always 3000". railway.json wins on Railway. Works today — **do not touch** unless a deploy breaks. | backend/railway.json |
| B27 | S3 | `render.yaml` is stale (Render, superseded by Railway). | repo root |
| B28 | S3 | Local `.env` likely points at the production Atlas cluster. Local runs can mutate prod data. | repo root `.env` (not committed) |

---

## C. Product / architecture debt

| ID | Finding |
|---|---|
| D01 | `backend/server.py` is ~2,250 lines: routes, models, D365 orchestration, jobs, startup in one file. |
| D02 | No automated backend tests in repo (`tests/` is empty). A Playwright suite exists in `test_scripts/` but is git-ignored. |
| D03 | API response shapes are inconsistent: some endpoints follow `{success, data, error}`, older ones return raw objects. Rule going forward: **new** endpoints use the contract; existing shapes change only when the same phase updates their frontend caller. |
| D04 | Browser-cookie (Playwright) D365 fallback is fragile and must not be on the default write path. |
| D05 | LLM is hard-wired to Groq (`ai_chat.py`, `activity_sheet_processor.summarize_notes`, `_run_activity_sheet_job`). |
| D06 | The repo is presumed **public** (README "Initial public release", MIT). Tenant-specific data (org URL, field logical names, flow URLs, secrets) must never be committed. |

---

## D. External constraints (verified 2026-10-09)

1. **Lenovo tenant blocks admin consent** for third-party apps. No IT involvement is possible. Anything requiring a consented Entra app in Lenovo's tenant is out for Lenovo.
2. **Dataverse MCP server** requires (a) tenant-admin consent for the client app (Dataverse CLI app `0c412cc3-0dd6-449b-987f-05b053db9457` or a custom app) and (b) Power Platform admin enabling the client per environment (possibly Managed Environment). → **Not available to our backend in Lenovo.** It **is** enabled by default for **Copilot Studio** agents inside the tenant.
3. **"HTTP with Microsoft Entra ID (preauthorized)"** Power Automate connector calls Entra-protected APIs (incl. the Dataverse Web API) as the signed-in flow owner via a Microsoft first-party preauthorized app — **no admin consent**. Premium connector; can be blocked by tenant DLP policy. The newer non-preauthorized variant **does** need consent — use only the "(preauthorized)" one.
4. **Legacy flow URLs** (`*.logic.azure.com`) stopped working 2025-11-30. New URLs are environment-scoped on `*.environment.api.powerplatform.com`. Always copy the URL from the flow designer.

Sources: Microsoft Learn "Connect to Dataverse with MCP from other clients"; Microsoft Learn connector reference "HTTP with Microsoft Entra ID (preauthorized)"; Microsoft message center MC1168342 / community write-ups on the HTTP trigger URL migration.
