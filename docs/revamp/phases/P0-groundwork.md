# P0 — Groundwork

**Goal:** turn suspicion into evidence, and give every later phase a safe harness: version endpoint, dev database, backend test suite, fake flow, D365 probe, private config folder, and the new generic flow built and verified.

**Recommended model:** Opus 5.5 (diagnosis and judgment). Sonnet can do the agent tasks if the user does the user tasks.
**Dependencies:** none. **Blocks:** every other phase.
**Parallel-safe with:** nothing (it creates the shared harness).
**Branch:** `revamp/p0-groundwork`

---

## Files

| File | Action |
|---|---|
| `backend/server.py` | add `GET /api/version` only (next to `/healthz`) |
| `tests/conftest.py` | create |
| `tests/backend/__init__.py`, `tests/backend/test_smoke.py` | create |
| `tests/fakes/__init__.py`, `tests/fakes/fake_flow.py` | create |
| `scripts/d365_probe.py` | create |
| `backend/requirements-dev.txt` | create |
| `.gitignore` | append `docs/revamp/private/` |
| `docs/revamp/private/` (git-ignored) | create `README.md`, `EVIDENCE.md`, `D365_SCHEMA.md`, `field_map.json` |
| `docs/revamp/STATE.md`, `HANDOFF.md` | update |

## Dependencies (pre-approved)

Dev only, in `backend/requirements-dev.txt` (not installed on Railway): `pytest>=8`, `pytest-asyncio>=0.23`, `respx>=0.21`, `mongomock-motor>=0.0.29`, `httpx` (already present).

---

## Agent tasks

### P0.T1 — `/api/version`
Add to `server.py`:
```python
@app.get("/api/version", tags=["ops"])
async def version():
    return {"commit": os.environ.get("RAILWAY_GIT_COMMIT_SHA", "local"),
            "service": "sales-copilot-api", "env": APP_ENV}
```
Register on `app` (not `api_router`) so it bypasses auth, like `/healthz`. Must be defined **before** the dev-mode SPA catch-all route.
**Accept:** local `curl localhost:8000/api/version` → `{"commit":"local",...}`.

### P0.T2 — Test harness
- `tests/conftest.py`: before importing `server`, set env `APP_ENVIRONMENT=dev`, `MONGO_URL=mongodb://localhost:27017`, `DB_NAME=sales_copilot_test`, `SECRET_KEY=test-secret`, `TOKEN_ENCRYPTION_KEY=<Fernet.generate_key()>`, `CORS_ORIGINS=http://localhost:3000`, `GROQ_API_KEY=test`. Add `backend/` to `sys.path`. Replace `server.db` and `server.kb.db` with a `mongomock_motor.AsyncMongoMockClient()["test"]` database per test (function-scoped fixture). Provide fixtures: `client` (httpx `AsyncClient` with `ASGITransport(app=server.app)`, base_url `http://test`), `user` and `admin` (insert into `users`, `authorized_users`, `user_sessions`; return the session cookie dict), `auth_client`, `admin_client`.
- Startup events are **not** run by ASGITransport — call `server._seed_activity_types()` in the fixture when needed.
- `tests/backend/test_smoke.py`: `/healthz` 200; `/api/version` 200; `/api/auth/me` 401 without a cookie and 200 with one.
**Accept:** `python -m pytest tests -q` green on Windows from the repo root.

### P0.T3 — Fake flow (local stand-in for Power Automate + Dataverse)
`tests/fakes/fake_flow.py`, a FastAPI `app` with an in-memory store, supporting **both**:
1. **Legacy webhook shape** (today's payload: `subject`, `activity_type`, `mdm_id`, ...) at `POST /legacy`. Behaviour selected by env `FAKE_FLOW_MODE` or header `X-Fake-Mode`: `ok` → 200 `{"activityid": "<uuid>", "status": "success"}`; `no_id` → 202 empty body; `error` → 500; `slow` → sleep 35s.
2. **`loop.crm.v1` contract** (see ARCHITECTURE §4) at `POST /v1`: guard on `X-Loop-Key == FAKE_FLOW_KEY` (default `test-key`); in-memory tables `accounts`, `appointments`, `phonecalls`, `tasks`; supports `GET accounts?$filter=<field> eq '<v>'` (parse simple `eq` clauses joined by ` and `), `POST <set>` (honours a client-supplied `activityid` in the body; 409-style duplicate → status_code 412 with Dataverse-like error body), `GET <set>(<id>)`, `PATCH <set>(<id>)`; validates appointment status pairs (rejects `{3,4}`) and requires `scheduledend` for appointments, mimicking Dataverse 400 bodies `{"error":{"code":"0x...","message":"..."}}`. Seed accounts from env `FAKE_FLOW_SEED` (JSON) or a default of two accounts with field `lvo_mdmid` values `"1001"` and `"1002"`.
- Add `GET /_records` to dump the store for assertions.
**Accept:** unit tests in `tests/backend/test_fake_flow.py` cover each mode and the v1 guard.

### P0.T4 — D365 probe script
`scripts/d365_probe.py` (CLI, stdlib + httpx): reads `LOOP_FLOW_URL`, `LOOP_FLOW_KEY` from env or `docs/revamp/private/.env.probe`. Commands:
- `python scripts/d365_probe.py whoami` → `GET WhoAmI` through the v1 flow.
- `python scripts/d365_probe.py account --filter lvo_mdmid=1001` → account lookup.
- `python scripts/d365_probe.py metadata appointment` → `GET EntityDefinitions(LogicalName='appointment')/Attributes?$select=LogicalName,AttributeType,RequiredLevel` (Variant A only).
- `python scripts/d365_probe.py canary --mdm 1001` → **refuses to run** unless `--i-have-user-approval` is passed; creates one `[LOOP-CANARY]` appointment, reads it back, prints id and URL.
Prints redacted output (no secrets). Works against the fake flow by pointing `LOOP_FLOW_URL` at `http://localhost:8765/v1`.
**Accept:** all commands work against the fake flow.

### P0.T5 — Dev database and private folder
- Create `docs/revamp/private/README.md` explaining: this folder is git-ignored; it holds tenant evidence, schema, `field_map.json`, `.env.probe`.
- Append `docs/revamp/private/` to `.gitignore`; verify with `git check-ignore -v docs/revamp/private/README.md`.
- Document in STATE.md "Environment facts": local runs use `DB_NAME=sales_copilot_dev`; how to confirm the local `.env` `MONGO_URL` cluster (print host only, never the credentials).

### P0.T6 — Evidence collection (agent side)
Using only read-only means:
- Determine the host of the saved webhook URL: query `bot_config` `{_id:"config"}` → print **only** the URL host (e.g. `prod-xx.westus.logic.azure.com` vs `*.environment.api.powerplatform.com`). Requires the user's go-ahead to connect to the prod DB read-only; ask first. Record result as B11 confirmed/refuted.
- Count `workflow_executions` by `status` and by `result.method` for the last 90 days; count `activity_sheet_log` by `d365_status`; sample 5 latest failed/pending `error_message` / `result.webhook_raw_response` (redacted). Record in `private/EVIDENCE.md`, summary (no tenant data) in STATE.md.

---

## User tasks (the agent prepares the checklist in HANDOFF.md and waits)

- **U1 — Railway logs:** Railway → `sales-copilot-api` → Deployments → latest → Logs → filter `webhook` and `D365`. Paste the last ~50 relevant lines into `private/EVIDENCE.md`. Also confirm: Settings → Source → which branch auto-deploys (expected `main`).
- **U2 — Flow run history:** open the existing flow → Run history. Are runs appearing at all after Nov 30 2025? Note failed run errors. Copy the **current** trigger URL from the trigger card and compare its host with P0.T6.
- **U3 — DLP / connector check:** in make.powerautomate.com (Lenovo environment), create a blank instant flow → add action → search "HTTP with Microsoft Entra ID (preauthorized)". Can you add it and create a connection with Base Resource URL = Azure AD Resource URI = your D365 org URL? Save the flow: does it save without a DLP error? Report Variant A available yes/no.
- **U4 — Build the generic flow** by following [../FLOW_BUILD_GUIDE.md](../FLOW_BUILD_GUIDE.md) (Variant A, or B if U3 failed). Put the URL and key into `private/.env.probe` (`LOOP_FLOW_URL=`, `LOOP_FLOW_KEY=`).
- **U5 — Schema facts:** with the new flow, run (agent can run them for you) `probe whoami`, `probe metadata appointment|phonecall|task|account`. Otherwise open these in a browser where you are logged into D365 (read-only, your own session): `https://<org>.crm.dynamics.com/api/data/v9.2/EntityDefinitions(LogicalName='account')/Attributes?$select=LogicalName,DisplayName` (and for appointment/phonecall/task), save the JSON into `private/`. Answer: logical name of the MDM ID field (expected `lvo_mdmid`); does it hold IDG, ISG, or both? Is it an alternate key? Logical name + type of the **new filter** and **new field** the client asked for; the subtype field and its option value for "Customer Meeting"; how attendees are stored today (if at all).
- **U6 — Canary approval (optional but recommended):** type "approve canary P0" to let the agent create one `[LOOP-CANARY]` appointment through the new flow and read it back. You delete it afterwards in D365.

## Outputs

- `private/D365_SCHEMA.md` — verified logical names, status codes, option values, regarding navigation property names (`regardingobjectid_account_appointment` etc. — verify via `EntityDefinitions(LogicalName='appointment')/ManyToOneRelationships?$select=ReferencingEntityNavigationPropertyName,ReferencedEntity`).
- `private/field_map.json` — filled-in instance of ARCHITECTURE §5 for Lenovo.
- STATE.md "Root cause" section: proven chain with evidence references (no tenant data).
- STATE.md "Flow variant": A or B. "Deploy procedure": confirmed auto-deploy branch.

## Gate (subset of DOCTRINE §4)

G1, G2, G6, G7 (the version endpoint must report the deployed commit). G3–G5 not applicable beyond the version endpoint.

## Definition of done

- [ ] `/api/version` live in prod showing the deployed SHA
- [ ] `pytest` harness + fake flow + probe committed and green
- [ ] Root cause recorded with evidence (B11 confirmed or refuted; B01–B04 observed in data or not)
- [ ] Flow variant decided; generic flow built and `probe whoami` succeeds against the real flow
- [ ] `private/D365_SCHEMA.md` and `private/field_map.json` complete
- [ ] STATE.md and HANDOFF.md updated; P0 marked DONE
