# ARCHITECTURE BIBLE

> How Sales Copilot actually works today — every layer, every data flow, every integration — plus the target architecture it must evolve into.
> Companion documents: SECURITY (threats in these flows), TECH_DEBT (what to fix), EXECUTION (how to fix it).

---

## 1. System Overview

Sales Copilot is a **two-service deployment**: a React SPA and a FastAPI monolith, backed by MongoDB Atlas and a fan of external Microsoft/AI services.

```
Browser (React 18 SPA, HashRouter)
   │  fetch w/ credentials: 'include' (cookie session)
   │  AES-GCM encrypted sensitive payload fields (lib/crypto.js)
   ▼
FastAPI (backend/server.py — single app, /api prefix router)
   ├── Auth layer: cookie session_token → db.user_sessions → db.users
   ├── Domain routes: chat, workflows, excel, files, activity-sheets,
   │                  team, settings, monitoring, d365, notifications
   ├── Background jobs: asyncio.create_task (in-process, non-durable)
   └── Startup: index creation, activity-type seeding, first-email-user → admin promotion
   ▼
MongoDB Atlas (Motor async driver, ~16 collections)

External services (all called from backend):
   Microsoft Entra ID (MSAL)   → OAuth login + D365/Graph tokens
   D365 Dataverse Web API v9.2 → appointments, accounts, activities
   Power Automate HTTP webhook → alternative D365 write path
   Playwright headless Chromium→ cookie-session D365 token extraction
   Microsoft Graph             → calendar event creation
   Groq API (llama-3.1-8b-instant) → chat intent parsing, notes summarization
   SMTP                        → signup OTP emails
   Telegram Bot API            → execution notifications
```

There is **no queue, no cache layer, no worker process, no CDN config** beyond what Render provides. Everything synchronous runs in the request; everything asynchronous runs in `asyncio.create_task` inside the same process.

---

## 2. Backend Composition

### 2.1 `server.py` (~2,250 lines) — the monolith

Order of definition matters and encodes the architecture:

1. **Bootstrap** — env loading, fail-hard checks (`SECRET_KEY`, `CORS_ORIGINS` required in prod), Mongo client, `slowapi` rate limiter keyed on client IP (`X-Forwarded-For` aware — see SECURITY §7).
2. **Auth dependency** — `get_current_user(request)`: reads `session_token` cookie (falls back to `Authorization: Bearer`), looks up `db.user_sessions` (plaintext token match), joins `db.users`, checks expiry. `require_admin` layers a role check.
3. **Auth routes** — Microsoft OAuth (delegates to `microsoft_auth.py`), email+password login (bcrypt via `authorized_users.password_hash`), logout, me, change-password. Signup lives in `auth_signup.py` (router factory, mounted onto the api router).
4. **Workflow engine** — `/workflows/execute` dispatches on `workflow_type`: `log_activity` is real (D365 chain), the rest (`sync_emails`, `search_leads`, `update_calendar`, `process_files`, `send_alert`) return `coming_soon` via `n8n_client.py` stub. Every execution is recorded in `workflow_executions` and mirrored to the knowledge base event log.
5. **AI chat** — `/chat`: loads last N `chat_history` turns, calls `ai_chat.py` (Groq) with a live-state system prompt, parses the model's JSON "action" envelope, and if `action == log_activity`/`log_activity_sheet` executes the same D365 write path as workflows. Sheet-shaped pastes route through `activity_sheet_processor`.
6. **D365 admin** — connection test, activities fetch (merges live D365 activities with local `activity_sheet_log`/`workflow_executions` fallback), webhook URL save, browser cookie save. All stored in the single global `bot_config` document (`_id: "config"`).
7. **User surface** — preferences, activity types (seeded at startup), calendar event creation (Graph), Telegram config.
8. **Admin surface** — team CRUD on `authorized_users`, settings (bot_config passthrough), monitoring summary (aggregation pipelines over `workflow_executions`).
9. **Excel/batch** — upload → parse (`excel_processor`) → import into global `accounts` or per-user `user_account_data`; rules CRUD (`activity_rules`); preview/execute batch jobs (`batch_jobs`) via background task.
10. **Files** — per-user account list uploads (`uploaded_files` + `user_account_data`), default-file selection, account search (per-user data first, legacy global `accounts` fallback).
11. **Activity sheets** — parse text/file → structured rows; execute → background task that resolves accounts from cache, AI-summarizes notes, writes each row to D365, upserts `activity_sheet_log` (dedup by `serial_no`), tracks progress in `activity_sheet_jobs`.
12. **Ops & SPA serving** — `/healthz`, static mount that serves the built frontend from the same process (Render single-service option), catch-all route returning `index.html`.
13. **Startup hook** — creates indexes, seeds activity types, promotes the earliest email-auth user to admin if no admin exists.

### 2.2 Supporting modules

| Module | Responsibility | Key facts |
|---|---|---|
| `microsoft_auth.py` | MSAL confidential client; auth-code flow; token cache in `ms_tokens` (per user, per scope-set); silent refresh; `get_d365_token(user_id)` and `get_graph_token(user_id)` | Tokens stored unencrypted in Mongo |
| `auth_signup.py` | Router factory `create_signup_router(db, ...)`; signup → 6-digit OTP → `email_service` → verify → `authorized_users` + auto-login session | OTP hashed, attempts limited, resend cooldown |
| `ai_chat.py` | Groq client wrapper; builds system prompt = `prompts/ai_chat_system.txt` + live app-state block from `knowledge_base.py`; expects JSON envelope `{action, parameters, response}` by prompt convention (no schema enforcement) | Model: `llama-3.1-8b-instant` |
| `knowledge_base.py` | `KnowledgeBaseService`: append-only event log (`app_knowledge_base`) + `get_ai_context_snapshot()` (connection status, default file, account count, recent executions) injected into every chat prompt | The "live state" differentiator |
| `d365_client.py` | Dataverse Web API client: whoami test, account query, appointment create (bound `regardingobjectid`), activity list; static `send_via_power_automate(webhook_url, payload)` | Async httpx |
| `d365_browser.py` | Playwright: replay saved browser cookies against D365 org, sniff bearer token from network traffic, cache token in `bot_config` | The ToS-risk path (SECURITY §4.3) |
| `activity_sheet_processor.py` | Detects delimiter (TSV/CSV/pipe/markdown), maps ~40 column aliases (incl. Lenovo-specific "Primary Lenovo Attendee", MDM IDG/ISG), parses fuzzy datetimes, AI-summarizes notes via `prompts/notes_summarizer.txt`, resolves accounts against user cache w/ fuzzy match | The activity-sheet brain |
| `excel_processor.py` | openpyxl/csv parsing, header auto-detection, column classification, Jaccard-similarity fuzzy account matching | Batch-rules brain |
| `email_service.py` | SMTP (STARTTLS) OTP mail with inline HTML template | Sync smtplib run in thread |
| `payload_crypto.py` | AES-GCM decryption of frontend-encrypted fields (key from `PAYLOAD_ENCRYPTION_KEY`); **falls back to plaintext if key unset** | Counterpart: `frontend/src/lib/crypto.js` |
| `n8n_client.py` | Phase-2 stub: all workflows return `coming_soon` | Placeholder for real automation backend |
| `log_config.py` | TimedRotatingFileHandler, daily, 30-day retention, `logs/` dir | Ephemeral on Render free tier |

---

## 3. The D365 Connection Fallback Chain (crown jewel + biggest liability)

Every D365 write attempts, in order:

```
1. OAuth token        microsoft_auth.get_d365_token(user_id)
   │  requires admin-consented Entra app w/ Dataverse user_impersonation
   ▼ on failure
2. Power Automate     bot_config.pa_webhook_url → HTTP POST of activity payload
   │  requires an admin to have built a PA flow; fire-and-forget semantics
   ▼ on failure
3. Browser cookies    d365_browser: replay bot_config cookies in headless
   │  Chromium, capture a bearer token from D365's own XHR traffic,
   │  cache in bot_config.browser_token (+expiry), use as tier-1 token
   ▼ on failure
4. Local-only log     write to workflow_executions / activity_sheet_log
                      with d365_status: "failed" — data preserved, sync absent
```

**Why it exists**: enterprise tenant admins routinely refuse OAuth consent for third-party apps. Tiers 2–3 let a sales team adopt the product with zero IT involvement.
**Why it must change**: tier 3 impersonates a browser session (ToS/security exposure — SECURITY §4.3), and all tier 2–3 credentials live in one **global** `bot_config` shared by every user (SECURITY §5). Target: per-org connection records, tier 3 removed or gated behind explicit legal review.

---

## 4. AI Chat Data Flow

```
user msg ──▶ /chat
  ├─ load last 10 chat_history turns
  ├─ knowledge_base.get_ai_context_snapshot()   ◀── bot_config, uploaded_files,
  │     (connection status, default file,            user_account_data counts,
  │      account count, recent executions)           workflow_executions
  ├─ system prompt = ai_chat_system.txt + snapshot block
  ├─ Groq llama-3.1-8b-instant (JSON envelope by convention)
  ├─ parse {action, parameters, response}
  │     action: chat | log_activity | log_activity_sheet | ...
  ├─ if log_activity → resolve account (default-file cache → fuzzy) →
  │     D365 fallback chain (§3) → workflow_executions + knowledge event
  └─ persist both turns to chat_history, return response + action result
```

Deep dive, prompt text analysis, and failure modes: **AI_AND_AGENT_ARCHITECTURE_BIBLE.md**.

---

## 5. Data Model (MongoDB collections)

| Collection | Scope | Purpose / key fields |
|---|---|---|
| `users` | per user | Profile: `user_id`, `email`, `name`, `role`, `auth_method` |
| `authorized_users` | global roster | Allow-list + role + `password_hash` (bcrypt); admin bootstrap |
| `user_sessions` | per user | `session_token` (plaintext — SEC-01), `expires_at` (7d) |
| `ms_tokens` | per user | MSAL access/refresh tokens per scope-set |
| `pending_signups` | transient | OTP hash, attempts, expiry |
| `bot_config` | **GLOBAL** (`_id:"config"`) | D365 org URL, PA webhook, browser cookies + cached token, feature toggles — the multi-tenancy blocker |
| `user_preferences` | per user | Default activity type, Telegram chat ID, etc. |
| `activity_types` | global, seeded | Enabled activity types w/ D365 activitytypecode mapping |
| `chat_history` | per user | Role/content turns, timestamps |
| `workflow_executions` | per user | Every execution: type, status, account, `d365_status`, timing — the audit spine |
| `activity_rules` | per user | Batch rule templates (`subject_template`, type, duration) |
| `batch_jobs` | per user | Batch execution progress (`processed`, `succeeded`, `failed`, per-row results) |
| `uploaded_files` | per user | Account-list file metadata, `is_default` flag |
| `user_account_data` | per user × file | Parsed account rows: `account_name`, `mdm_id`, `mdm_type` (IDG/ISG) |
| `accounts` | global legacy | Older shared account import path (still a search fallback) |
| `activity_sheet_jobs` | per user | Sheet execution progress |
| `activity_sheet_log` | per user | One doc per sheet row ever logged; dedup key `serial_no`; the seed of the "interaction memory" asset |
| `app_knowledge_base` | global | Append-only app event log powering the AI context snapshot |

**Indexes** (created at startup): sessions token+expiry, executions by user+date, account search fields, sheet-log `user_id+serial_no` unique. No TTL indexes on sessions or pending signups (cleanup is query-side).

**Conventions**: UUIDs as string `user_id`/`id` (never Mongo ObjectId in APIs), `{_id: 0}` projections everywhere, ISO timestamps.

---

## 6. Frontend Architecture

- **Stack**: React 18, CRA + craco (not Next.js), Tailwind, shadcn/Radix components, `HashRouter` (chosen for static-host safety; the backend catch-all makes it unnecessary — candidate to migrate to BrowserRouter).
- **Routing** (`App.js`): public `/login`, `/signup`; everything else wrapped in `AuthGuard` (calls `/api/auth/me`, redirects to login) inside `SidebarLayout`. Admin pages additionally gate on `user.role === 'admin'` client-side (server enforces via `require_admin`).
- **API layer** (`lib/api.js`): single fetch wrapper — base URL from `REACT_APP_BACKEND_URL` (empty ⇒ same-origin), `credentials: 'include'`, JSON envelope-tolerant error extraction. Some older pages still import `axios` directly (TD-08: standardize).
- **Field encryption** (`lib/crypto.js`): WebCrypto AES-GCM encrypts designated sensitive fields (passwords, cookies, webhook URLs) with `REACT_APP_PAYLOAD_KEY` before POST; backend `payload_crypto.py` decrypts. Defense-in-depth against logging middleboxes — **not** a substitute for TLS, and silently disabled when keys are unset.
- **Key pages**: Dashboard (quick-log + stats), Chat (chat UI + inline sheet-paste detection), Activities (D365+local merged timeline), ExcelUpload (rules + batch), FileManagement (account lists), admin Connections/Team/Monitoring.

---

## 7. Deployment Topology

| Concern | Current state |
|---|---|
| Host | Render free tier (`render.yaml`: python web service + static site). Railway configs (`railway.json`, `Procfile`) also present from an earlier attempt — pick one, delete the other (TD-12). |
| Processes | 1 uvicorn worker. Background jobs in-process (die on deploy — R5). |
| Static serving | Either Render static site (SPA) + separate API, or single-service mode where FastAPI serves the built SPA. Both paths exist in code. |
| Secrets | Render env vars. Fail-hard checks for `SECRET_KEY`/`CORS_ORIGINS` in prod are good; `PAYLOAD_ENCRYPTION_KEY` and Groq/MSAL/SMTP keys are optional-with-degradation. |
| Logs | Rotating files on ephemeral disk (lost on redeploy) + stdout. No drain, no Sentry. |
| DB | MongoDB Atlas (connection string env). No backups configured beyond Atlas defaults. |

---

## 8. Target Architecture (12-month)

The monolith is the right call at this stage — the target is a **well-factored monolith**, not microservices:

```
apps/web (Next.js or CRA→Vite migration, TS)
apps/api
  ├── routes/{auth,chat,workflows,sheets,files,admin}.py   # split of server.py
  ├── services/{d365,ai,knowledge,notifications}.py
  ├── models/ (Pydantic v2, shared response envelope)
  └── workers/ (arq or Celery on Redis: sheet jobs, batch jobs, retries)
infra: Render paid / Fly / Railway single choice, Redis, log drain, Sentry
data: org_id on every collection; connections collection replaces bot_config;
      per-org D365 credential records (encrypted at rest, KMS-wrapped)
```

Migration sequence and task-level breakdown: EXECUTION BIBLE TASK-010…TASK-024. The two structural moves that unlock everything else: **(a)** `org_id` everywhere, **(b)** durable job queue.
