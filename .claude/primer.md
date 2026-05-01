# Sales Copilot — Session Primer

> Rewritten at every session end. Always reflects current reality.
> Last updated: 2026-04-04

---

## CURRENT STATE — ALL PHASES COMPLETE

**Branch:** `02/Habit-Tracking`
**App status:** Full-stack running. All planned features built and wired.

---

## WHAT IS BUILT (verified by reading actual code)

### Backend (`backend/`)
| File | What it does |
|---|---|
| `server.py` | FastAPI app — all routes, DB logic, startup indexes |
| `ai_chat.py` | Context-aware Groq+Llama — `build_system_prompt()` with live app snapshot |
| `knowledge_base.py` | `KnowledgeBaseService` — writes events, builds `get_app_context_snapshot()` |
| `excel_processor.py` | `parse_file()`, `detect_account_columns()`, `fuzzy_match()` |
| `d365_client.py` | Dataverse REST client + `create_activity_via_webhook()` |
| `d365_browser.py` | Playwright cookie session manager (fallback auth) |
| `microsoft_auth.py` | MSAL auth — `get_auth_url`, `handle_callback`, `get_d365_token` |

### All API Routes in server.py
```
Auth:
  GET  /api/auth/microsoft              → redirect to MS login
  GET  /api/auth/microsoft/callback     → exchange code, create session
  GET  /api/auth/me
  POST /api/auth/logout
  GET  /api/auth/dev-login/check        → DEV_LOGIN_ENABLED flag
  POST /api/auth/dev-login              → demo login (dev only)

Workflows:
  GET  /api/workflows/list
  POST /api/workflows/execute           → calls _execute_d365_activity()
  GET  /api/workflows/executions

Chat:
  POST /api/chat                        → Groq + live context snapshot + auto-trigger
  GET  /api/chat/history

D365:
  GET  /api/d365/test
  GET  /api/d365/activities
  GET  /api/d365/webhook/status
  PUT  /api/d365/webhook/url            → stores webhook URL in bot_config
  GET  /api/d365/browser/status
  POST /api/d365/browser/save-cookies

Files:
  POST /api/files/upload-accounts      → parse + store to user_account_data
  GET  /api/files/                     → list uploads for user
  POST /api/files/{file_id}/set-default
  DEL  /api/files/{file_id}            → deletes file + its account rows

Accounts:
  GET  /api/accounts/search?q=&limit=  → regex on account_name in user_account_data
                                         NOTE: searches ALL user data, not just default file

Excel (legacy):
  POST /api/excel/upload
  POST /api/excel/accounts/import
  GET  /api/excel/accounts
  GET  /api/excel/rules, POST, DELETE
  POST /api/excel/rules/{id}/preview
  POST /api/excel/rules/{id}/execute
  GET  /api/excel/jobs/{id}

Admin:
  GET/POST/DEL /api/team
  GET/PUT      /api/settings
  GET          /api/monitoring/summary
  GET          /api/config
```

### MongoDB Collections
```
users                — user accounts
user_sessions        — session tokens
bot_config           — webhook URL, cookie enc, settings
workflow_executions  — every workflow run (status, result, params)
chat_history         — per-message AI conversation log
user_account_data    — parsed account rows (mdm_id, account_name, etc.)
uploaded_files       — file upload metadata (is_default, row_count, etc.)
app_knowledge_base   — AI memory: every significant app event
activity_rules       — batch logging rules
batch_jobs           — batch execution progress
accounts             — legacy excel import accounts
authorized_users     — team members and roles
```

### MongoDB Indexes (created on startup)
- `user_sessions.session_token`
- `workflow_executions.user_id`, `workflow_executions.created_at`
- `chat_history.(user_id, created_at)`
- `user_account_data.(user_id, account_name)` ← for fast account search
- `uploaded_files.(user_id, uploaded_at)`
- `app_knowledge_base.(user_id, timestamp)`, `.(user_id, event_type)`

### Frontend (`frontend/src/`)
| File | What it does |
|---|---|
| `App.js` | Routes — all pages wired |
| `pages/DashboardPage.js` | 6 workflow cards (1 live = Log D365), appointment form with AccountSearchInput, MDM ID field, recent executions table |
| `pages/ChatPage.js` | Context-aware chat, suggested prompts, WorkflowCard for AI-triggered actions |
| `pages/ActivitiesPage.js` | D365 activities list with record links |
| `pages/LoginPage.js` | MS SSO + dev login |
| `pages/ExcelPage.js` | Legacy Excel upload + rules manager |
| `pages/admin/ConnectionsPage.js` | Webhook URL config + browser cookie input |
| `pages/admin/FileManagementPage.js` | Upload account files, set default, delete |
| `pages/admin/MonitoringPage.js` | Execution stats + log |
| `pages/admin/TeamPage.js` | Add/remove team members |
| `components/AccountSearchInput.js` | Debounced account search dropdown — used in appointment form |

### Routing (App.js)
```
/login                  → LoginPage (public)
/dashboard              → DashboardPage (TopNavLayout)
/chat                   → ChatPage (TopNavLayout)
/excel                  → ExcelPage (TopNavLayout)
/activities             → ActivitiesPage (SidebarLayout)
/admin/connections      → ConnectionsPage (SidebarLayout, admin)
/admin/team             → TeamPage (SidebarLayout, admin)
/admin/monitoring       → MonitoringPage (SidebarLayout, admin)
/admin/file-management  → FileManagementPage (SidebarLayout, admin)
```

---

## POWER AUTOMATE FLOW (confirmed from screenshots)

**Flow name:** Moltbot D365 Activity Logger
**Trigger:** Manual (HTTP webhook)
**Structure:**
```
Manual trigger (receives JSON payload)
  ↓
List rows — Accounts table
  Filter: lvo_mdmid eq '{mdm_id}'    ← lvo_mdmid IS THE CONFIRMED D365 FIELD
  Select cols: accountid, name
  Row count: 1
  ↓
Switch (activity_type)
  Case 3 = appointment:
    Condition (account found?):
      True  → Add Appointment With Account
               Regarding: concat('/accounts/', first(body('List_rows')?['value'])?['accountid'], ')')
      False → Add Appointment Without Account
  Default: 0 Actions
  ↓
Response:
  {
    "activityid": "@{coalesce(outputs('Add_Appointment_With_Account')?['body/activityid'], outputs('Add_Appointment_Without_Account')?['body/activityid'])}",
    "status": "success"
  }
```

**Key confirmed facts:**
- D365 MDM ID field name: `lvo_mdmid`
- Account linking: uses `regardingobjectid_account@odata.bind` pattern via concat
- Response always returns activityid via coalesce (never fails due to missing account)
- Currently only Appointment (Case 3) is handled — other cases not yet built in PA

---

## D365 Connection Priority in _execute_d365_activity()
```
1. OAuth token (get_d365_token) — will fail for Lenovo tenant users
2. Power Automate webhook — primary working path for beta
3. Playwright browser cookies — fallback
```

---

## KNOWN GAPS / THINGS TO WATCH

1. **`/api/accounts/search` doesn't filter by default file** — it searches ALL rows for the user across all uploaded files. If user uploads a new file without setting it as default, old rows still show. Low priority for now but worth noting.

2. **DashboardPage form still has activity_type selector** — the form has phonecall/task/appointment options. Prompt 3 said "disable phone call, task, meeting — only appointment". Currently the default is appointment but the selector is still present. May need to lock it to appointment-only.

3. **PA Switch only handles Case 3 (appointment)** — the Switch's Default branch has 0 actions. If a phonecall or task is sent, nothing is created in D365. This is acceptable for now (sprint scope = appointment only).

4. **Browser cookie path (d365_browser.py)** — playwright not expected to be installed on Render. This is a dev/local fallback only.

---

## ENVIRONMENT VARIABLES REQUIRED
```
MONGO_URL
DB_NAME=sales_copilot
AZURE_CLIENT_ID
AZURE_CLIENT_SECRET
AZURE_TENANT_ID
AZURE_REDIRECT_URI
D365_ORG_URL=https://lenovo-nitro-prod.crm.dynamics.com
GROQ_API_KEY
TOKEN_ENCRYPTION_KEY
SECRET_KEY
INTERNAL_KEY
REACT_APP_BACKEND_URL
FRONTEND_URL
APP_ENVIRONMENT=dev|prod
DEV_LOGIN_ENABLED=true|false   (dev only)
DEV_LOGIN_USER                 (dev only)
DEV_LOGIN_PASS                 (dev only)
```

---

## WHAT TO BUILD NEXT (when Niranjan says BULLSEYE)

Currently nothing explicitly blocked. Potential items:
- Lock DashboardPage form to appointment-only (remove activity_type dropdown per Prompt 3)
- Add is_default filtering to `/api/accounts/search`
- Test end-to-end: upload file → set default → type in form → PA creates D365 appointment with account linked
- Add other activity types to PA Switch (phonecall Case, task Case)
