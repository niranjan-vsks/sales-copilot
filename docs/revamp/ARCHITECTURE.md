# Architecture — current and target

Read [AUDIT.md](AUDIT.md) first. This file defines the **contracts** every phase builds against. If a phase needs to change a contract, it must record the change in [STATE.md](STATE.md) → "Decisions" and bump the contract version.

---

## 1. Current system (baseline `ab7e7f0`)

```
React 19 SPA (www.loopcopilot.cc, Railway "sales-copilot-ui", serve -s build on :3000)
   │  fetch(REACT_APP_BACKEND_URL + /api/*, credentials: include)   [frontend/src/lib/api.js]
   ▼
FastAPI (api.loopcopilot.cc, Railway "sales-copilot-api")            [backend/server.py]
   ├─ Auth: httpOnly session_token cookie → user_sessions (Mongo); MS SSO (MSAL) + email/OTP
   ├─ Chat: Groq llama-3.1-8b-instant, JSON-in-prompt, live app snapshot (knowledge_base.py)
   ├─ Files: Excel/CSV → user_account_data (account_name, l2_mdm_id_idg, l2_mdm_id_isg, ...)
   └─ D365 write: _execute_d365_activity()
         1. OAuth Dataverse REST (broken scope, B05; blocked for Lenovo anyway)
         2. Power Automate webhook (bot_config.power_automate_webhook_url) ← only viable path
         3. Browser cookies (Playwright)
   ▼
MongoDB Atlas (DB_NAME, default sales_copilot)
```

Entry points into the D365 write: `POST /api/workflows/execute` (Dashboard), `POST /api/chat` (AI agent), `POST /api/activity-sheets/execute` (bulk sheet job), `POST /api/excel/rules/{id}/execute` (rules batch job).

---

## 2. Target system

```
Frontend ──► FastAPI ──► crm.service.log_activity()  ◄── chat agent tools (llm/ + agent tools)
                              │  validate → resolve account → build payload → create → read back
                              ▼
                     crm.registry → connector chosen by crm_connections config
                       ├─ DataverseFlowConnector   (Lenovo: generic PA flow, runs as the rep)
                       ├─ DataverseDirectConnector (consenting tenants: OAuth Web API)
                       ├─ DataverseMCPConnector    (consenting tenants: Dataverse MCP)   [P4]
                       ├─ FakeConnector            (tests, dry-run)
                       └─ SalesforceConnector / HubSpotConnector                         [P7]
```

Principles (locked):
1. **The LLM never writes to a CRM.** It proposes a structured `ActivityRequest`; the service validates and executes deterministically.
2. **Success means proven.** `confirmed` only when the CRM returned a record id **and** a read-back found it. No silent `pending`.
3. **Tenant specifics are config, not code.** Tables, field names, filters, option-set values live in `crm_field_maps` (Mongo), editable by admins, seeded from a private file — never committed.
4. **Idempotent writes.** The backend generates the record GUID before the first attempt and reuses it on retry, so a retry cannot create a duplicate.
5. **One flow, built once.** The Power Automate flow is a thin, generic, authenticated proxy. It contains no business logic and is never edited when fields or filters change.

---

## 3. Contract: CRM connector interface (Python) — `backend/crm/base.py` (P2)

```python
from typing import Literal, Optional, Protocol, Any
from pydantic import BaseModel, Field

ActivityType = Literal["appointment", "phonecall", "task"]
WriteStatus  = Literal["confirmed", "unverified", "failed", "dry_run"]

class ActivityRequest(BaseModel):
    activity_type: ActivityType
    subject: str = Field(min_length=1, max_length=200)
    account_name: str = ""                     # display only
    lookup: dict[str, str] = {}                # e.g. {"mdm_id": "12345", "<custom_param>": "X"}
    start_utc: Optional[str] = None            # ISO-8601 with Z, already UTC-normalised
    end_utc: Optional[str] = None
    duration_minutes: int = Field(default=30, ge=1, le=1440)
    notes: str = ""
    location: str = ""
    teams_meeting: bool = False
    activity_sub_type: str = ""
    custom: dict[str, Any] = {}                # values for custom_params declared in the field map
    mark_completed: bool = True
    source: Literal["dashboard", "chat", "activity_sheet", "rules", "api"] = "dashboard"

class AccountMatch(BaseModel):
    status: Literal["found", "not_found", "ambiguous", "skipped"]
    account_id: Optional[str] = None           # CRM GUID
    candidates: list[dict] = []                # for ambiguous

class WriteResult(BaseModel):
    status: WriteStatus
    record_id: Optional[str] = None
    record_url: Optional[str] = None
    entity: str
    connector: str
    error_code: Optional[str] = None           # see §6
    error_message: Optional[str] = None
    attempts: int = 1
    duration_ms: int = 0

class HealthResult(BaseModel):
    ok: bool
    connector: str
    detail: str = ""
    latency_ms: int = 0

class CRMConnector(Protocol):
    name: str
    async def health(self) -> HealthResult: ...
    async def find_account(self, filters: list[tuple[str, str]]) -> AccountMatch: ...
    async def create(self, entity_set: str, body: dict, record_id: str) -> tuple[int, dict]: ...
    async def get(self, entity_set: str, record_id: str, select: list[str]) -> Optional[dict]: ...
    async def update(self, entity_set: str, record_id: str, body: dict) -> tuple[int, dict]: ...
```

`crm/service.py` owns all business logic (validation, field mapping, account resolution, completion PATCH, read-back, idempotency, status). Connectors are dumb transports.

---

## 4. Contract: generic Power Automate flow — `loop.crm.v1` (P2)

Built **once** by the user following [FLOW_BUILD_GUIDE.md](FLOW_BUILD_GUIDE.md). Runs as the user, with their MFA, inside the tenant.

### Request (backend → flow)
```
POST <flow URL copied from designer>
Content-Type: application/json
X-Loop-Key: <LOOP_FLOW_KEY shared secret>

{
  "contract": "loop.crm.v1",
  "request_id": "6f1c...uuid",
  "method": "GET" | "POST" | "PATCH",
  "path": "appointments" | "appointments(<guid>)" | "accounts?$select=accountid,name&$filter=lvo_mdmid eq '123'&$top=2",
  "body": { ... } | null
}
```

### Response (flow → backend) — **always** returned, including on Dataverse errors
```
HTTP 200
{
  "contract": "loop.crm.v1",
  "request_id": "<echo>",
  "status_code": 201,                 // Dataverse HTTP status (or 401/400 from the guard)
  "body": { ... } | null              // Dataverse JSON body, or error JSON
}
```

### Guard rules inside the flow
- Reject (respond `status_code: 401`) if `X-Loop-Key` header ≠ the secret stored in the flow.
- Reject (`status_code: 400`) if `method` ∉ {GET, POST, PATCH} or the first path segment (before `(` or `?`) ∉ allow-list `accounts, appointments, phonecalls, tasks, systemusers, EntityDefinitions`.
- No DELETE, ever.

### Transport variants (decided in P0)
- **Variant A (preferred):** "HTTP with Microsoft Entra ID (preauthorized)" → *Invoke an HTTP request* against `/api/data/v9.2/{path}`. Fully generic.
- **Variant B (fallback if Variant A is DLP-blocked):** Microsoft Dataverse connector with dynamic table name (*List rows* / *Add a new row* / *Update a row*, JSON item). Backend sends the same envelope; flow maps it. P0 spike must confirm dynamic-table JSON items and `@odata.bind` work.

---

## 5. Contract: field map — Mongo `crm_field_maps` (P2)

One document per connection (`_id: "default"` for Lenovo). Seeded by an admin-only import endpoint from `docs/revamp/private/field_map.json` (git-ignored). Shape:

```json
{
  "_id": "default",
  "version": 1,
  "org_url": "https://<org>.crm.dynamics.com",
  "account_lookup": {
    "entity_set": "accounts",
    "id_field": "accountid",
    "name_field": "name",
    "filters": [
      {"param": "mdm_id", "field": "lvo_mdmid", "required": true},
      {"param": "<new_filter_param>", "field": "<logical_name>", "required": false}
    ],
    "on_multiple": "fail"
  },
  "custom_params": [
    {"key": "<param>", "label": "<UI label>", "type": "text", "required": false,
     "applies_to": ["appointment", "phonecall", "task"], "used_for": "field" }
  ],
  "activities": {
    "appointment": {
      "entity_set": "appointments",
      "primary_key": "activityid",
      "regarding_nav": "regardingobjectid_account_appointment",
      "fields": {
        "subject": {"from": "subject"},
        "description": {"from": "notes"},
        "scheduledstart": {"from": "start_utc"},
        "scheduledend": {"from": "end_utc"},
        "location": {"from": "location"},
        "isonlinemeeting": {"from": "teams_meeting"},
        "<subtype_logical>": {"from": "activity_sub_type", "optionset": {"Customer Meeting": 100000000}},
        "<custom_logical>": {"from": "custom.<param>"}
      },
      "complete": {"statecode": 1, "statuscode": 3}
    },
    "phonecall": { "entity_set": "phonecalls", "primary_key": "activityid",
                   "regarding_nav": "regardingobjectid_account_phonecall",
                   "fields": {"subject": {"from": "subject"}, "description": {"from": "notes"},
                              "actualdurationminutes": {"from": "duration_minutes"},
                              "scheduledstart": {"from": "start_utc"}},
                   "complete": {"statecode": 1, "statuscode": 2} },
    "task":      { "entity_set": "tasks", "primary_key": "activityid",
                   "regarding_nav": "regardingobjectid_account_task",
                   "fields": {"subject": {"from": "subject"}, "description": {"from": "notes"},
                              "actualdurationminutes": {"from": "duration_minutes"},
                              "scheduledend": {"from": "start_utc"}},
                   "complete": {"statecode": 1, "statuscode": 5} }
  }
}
```

All `<...>` values and every logical name / status code above **must be verified against the tenant's metadata in P0** and recorded in `docs/revamp/private/D365_SCHEMA.md`. The values shown are Dataverse defaults and placeholders.

**Adding a filter** = append to `account_lookup.filters` + a `custom_params` entry. **Adding a field** = append to `activities.<type>.fields` + a `custom_params` entry. No code change, no flow change.

---

## 6. Error codes (stable strings, used in DB, UI and tests)

| Code | Meaning |
|---|---|
| `FLOW_NOT_CONFIGURED` | No flow URL / key in config |
| `FLOW_UNREACHABLE` | Network error, DNS, timeout, or legacy dead URL |
| `FLOW_AUTH_REJECTED` | Flow guard returned 401 (bad X-Loop-Key) |
| `FLOW_CONTRACT_VIOLATION` | Response missing `contract`/`status_code` (e.g. 202 with no body = flow has no Response action) |
| `CRM_VALIDATION` | Dataverse 400 (bad field, bad status pair, missing required) — message carries Dataverse text |
| `CRM_PERMISSION` | Dataverse 401/403 |
| `CRM_THROTTLED` | Dataverse 429 / 503 (retryable) |
| `ACCOUNT_NOT_FOUND` | Lookup filters matched 0 accounts |
| `ACCOUNT_AMBIGUOUS` | Lookup matched >1 account |
| `READBACK_FAILED` | Create returned an id but GET did not find it (status `unverified`) |
| `INPUT_INVALID` | Our own validation failed before any CRM call |
| `LLM_UNAVAILABLE` | All configured LLM providers failed |

---

## 7. Contract: LLM provider layer — `backend/llm/` (P3)

```python
class LLMMessage(BaseModel): role: Literal["system","user","assistant"]; content: str
class LLMResult(BaseModel): text: str; provider: str; model: str; latency_ms: int

class LLMProvider(Protocol):
    name: str
    async def complete(self, messages: list[LLMMessage], *, json_mode: bool,
                       temperature: float, max_tokens: int, timeout_s: float) -> LLMResult: ...

async def complete_json(messages, schema: type[BaseModel], **kw) -> tuple[BaseModel, LLMResult]
    # primary → validate with pydantic → one repair retry → fallback provider → LLMUnavailable
```

Env (pending from user: only `GEMINI_API_KEY`):

| Var | Default | Meaning |
|---|---|---|
| `LLM_PROVIDER` | `auto` | `auto` = gemini if `GEMINI_API_KEY` set, else groq. Or `groq` / `gemini` explicitly. |
| `LLM_FALLBACK` | `groq` | Provider tried when primary fails. `none` disables. |
| `GROQ_API_KEY`, `GROQ_MODEL` | existing, `llama-3.1-8b-instant` | |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | unset, `gemini-2.5-flash` | Verify the current model id at build time. |
| `LLM_TIMEOUT_S` | `20` | |

---

## 8. Execution record (Mongo `workflow_executions`) — fields added in P1/P2

Existing fields stay. Added: `connector`, `error_code`, `error_message`, `attempts`, `record_id` (alias of `d365_record_id`, keep both for UI compat), `idempotency_key`, `request` (sanitised ActivityRequest), `verified_at`. Status vocabulary: `running`, `confirmed`, `unverified`, `failed`, `dry_run`. During P1 (before the service exists) the legacy values `success`/`failed` remain, and `pending` is **no longer written** except as the initial transient state.

UI mapping: `confirmed`/`success` → green; `unverified` → amber with "Re-check"; `failed` → red with error code; `dry_run` → grey.
