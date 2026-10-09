# P2 — Universal Connector

**Goal:** replace the hand-built webhook with the generic `loop.crm.v1` flow and a backend CRM layer. Every activity type (appointment, phone call, task) works through one code path. New filters and fields become config. Writes are idempotent and confirmed by read-back.

**Recommended model:** Sonnet 5.5 (Opus if G4 fails twice).
**Dependencies:** P0 DONE (generic flow built, `field_map.json` ready), P1 DONE.
**Parallel-safe with:** P3. **Not** with P1, P4, P5.
**Branch:** `revamp/p2-universal-connector`
**Closes:** B14, B15, B16 (direct connector caches tokens), B22, D04.

---

## Files

| File | Action |
|---|---|
| `backend/crm/__init__.py`, `base.py`, `errors.py`, `field_map.py`, `service.py`, `registry.py` | create |
| `backend/crm/connectors/__init__.py`, `dataverse_flow.py`, `dataverse_direct.py`, `fake.py` | create |
| `backend/server.py` | `_execute_d365_activity` becomes a thin wrapper over `crm.service.log_activity`; chat route workflow block; job runners; new admin routes (below); startup index/seed lines |
| `backend/d365_client.py` | used by `dataverse_direct.py` only; add nothing else |
| `frontend/src/pages/DashboardPage.js` | activity type dropdown (all enabled types), dynamic custom-param inputs, unverified "Re-check" action |
| `frontend/src/pages/admin/ConnectionsPage.js` | new "CRM Connection" card (flow URL, key, test, field-map import, status) |
| `frontend/src/pages/admin/FileManagementPage.js` | sheet/rules: activity type selector (default appointment) |
| `tests/fakes/fake_flow.py` | extend only if a gap is found |
| `tests/backend/test_p2_*.py` | create |
| `docs/revamp/FLOW_BUILD_GUIDE.md` | fix only if reality differs |

**Do not touch:** `ai_chat.py`, `llm/`, `prompts/`, `activity_sheet_processor.py` (P3).

## Dependencies
None new.

## New Mongo collections (pre-approved)
- `crm_field_maps` — ARCHITECTURE §5. Index: `_id` default.
- `crm_connections` — `{_id: "default", type: "dataverse_flow"|"dataverse_direct"|"fake", flow_url_enc, flow_key_enc, enabled, updated_at, last_health: {...}}`. Flow URL and key encrypted with the existing Fernet `TOKEN_ENCRYPTION_KEY` (reuse `microsoft_auth._fernet`).

---

## Tasks

### P2.T1 — `crm/base.py`, `crm/errors.py`
Exactly the models and Protocol in ARCHITECTURE §3. `errors.py`: `class CRMError(Exception): code: str; message: str; retryable: bool` with one constructor per §6 code.

### P2.T2 — `crm/field_map.py`
- Pydantic model for the §5 document. `load_field_map(db) -> FieldMap` (cache 60s in-process; invalidate on admin import).
- `build_body(fm, req: ActivityRequest, account_id: str | None, record_id: str) -> dict`: for each field mapping, resolve `from` (`subject`, `notes`, `start_utc`, `end_utc`, `duration_minutes`, `location`, `teams_meeting`, `activity_sub_type`, `custom.<key>`); skip empty strings/None; apply `optionset` map (unknown label → `CRMError INPUT_INVALID`); set primary key (`activityid: record_id`); if `account_id` set `"<regarding_nav>@odata.bind": f"/{lookup.entity_set}({account_id})"`.
- `build_account_filter(fm, lookup: dict) -> list[tuple[field, value]]`: required params missing → `INPUT_INVALID`; values escaped for OData (`'` → `''`).
- `custom_params_for(fm, activity_type) -> list[dict]` for the UI.

### P2.T3 — Connectors
- `connectors/dataverse_flow.py` (`name="dataverse_flow"`): builds the §4 envelope; POST with timeout 45s via httpx; maps responses: transport error/timeout → `FLOW_UNREACHABLE` (retryable); HTTP 202 or body without `contract` → `FLOW_CONTRACT_VIOLATION`; `status_code` 401 from guard → `FLOW_AUTH_REJECTED`; 400 → `CRM_VALIDATION` (message = Dataverse `error.message`); 401/403 → `CRM_PERMISSION`; 429/503/504 → `CRM_THROTTLED` (retryable); 412 or duplicate-key error on create → treat as "already exists" (return status_code and let service read back). `find_account` builds `accounts?$select=<id_field>,<name_field>&$filter=<f1> eq '<v1>' and <f2> eq '<v2>'&$top=2`. `health()` = `GET WhoAmI`. Path variant B (Dataverse connector) uses the same envelope — no backend difference.
- `connectors/dataverse_direct.py`: wraps `D365Client` + `get_d365_token`, cache the access token per user until 5 min before expiry (B16). Only used when `crm_connections.type == "dataverse_direct"`.
- `connectors/fake.py`: talks to the fake flow `/v1` (it is just `DataverseFlowConnector` pointed at a URL); exists for clarity in registry/tests.
- `registry.get_connector(db, user) -> CRMConnector` reads `crm_connections`. If none configured but legacy `bot_config.power_automate_webhook_url` exists, return a `LegacyWebhookConnector` shim that wraps the P1 legacy path (keeps prod working until the admin switches) — implement in `connectors/legacy_webhook.py` (add to files list; it is a move of P1 code, no behaviour change).

### P2.T4 — `crm/service.py`: `log_activity(db, user, req: ActivityRequest, execution_id) -> WriteResult`
Algorithm (each step logged with `execution_id`):
1. Dry run (`bot_config.dry_run_mode`) → build everything, return `dry_run`.
2. Validate `req` against the field map (activity type configured; required custom params present; for appointments compute `end_utc = start_utc + duration` if missing; start missing → now).
3. Resolve account: if any lookup filter value present → `connector.find_account`; 0 → `ACCOUNT_NOT_FOUND`; >1 → `ACCOUNT_AMBIGUOUS`; required filter missing → `INPUT_INVALID`.
4. `record_id = idempotency_key = uuid5(NAMESPACE_URL, f"{user.user_id}:{execution_id}")` (stable across retries of the same execution).
5. `create(entity_set, body, record_id)` with retry: up to 3 attempts on retryable errors, backoff 2s, 6s. Duplicate → continue to read-back.
6. If `complete` configured and `req.mark_completed` → `update(entity_set, record_id, complete)`; failure here → result `unverified` with `CRM_VALIDATION` message "Created but could not mark completed".
7. Read back `get(entity_set, record_id, select=[primary_key, "subject", "_regardingobjectid_value"])`; found → `confirmed` (verify regarding id equals resolved account id when one was resolved; mismatch → `unverified`); not found → `unverified` `READBACK_FAILED`.
8. Return `WriteResult` with `record_url = f"{org_url}/main.aspx?etn=<logical>&id={record_id}&pagetype=entityrecord"`.

### P2.T5 — Rewire every entry point
- `_execute_d365_activity(user, params)` keeps its signature for callers; converts legacy `params` → `ActivityRequest` (map `account`→`account_name`, `mdm_id`→`lookup.mdm_id`, `start_time` via `timeutil.to_utc_iso`, unknown keys → `custom` only if declared in field map) and returns the P1-shaped dict with `status` now in {`confirmed`,`unverified`,`failed`,`dry_run`}. Execution docs gain the ARCHITECTURE §8 fields.
- Chat route: stop forcing `activity_type="appointment"`; accept `activity_type` from the AI payload if it is an enabled type, else default appointment. (P3 updates the prompt to emit it; until then the default applies.)
- Activity-sheet and rules jobs: accept `activity_type` (default appointment) and pass through; rules batch requires a `start_time` (default: today 09:00 in user tz) (B22).
- Keep P1 truth rules: `activity_sheet_log` written only for `confirmed`/`unverified`; dedup "already logged" = `confirmed` or legacy `success`.
- UI status `confirmed` replaces `success` for new records; keep rendering legacy `success`.

### P2.T6 — Admin routes (all `require_admin`, contract `{success,data,error}`)
- `GET /api/crm/connection` → type, enabled, flow host only, key set yes/no, last_health.
- `PUT /api/crm/connection` body `{type, flow_url?, flow_key?, enabled}` → validates https, rejects `logic.azure.com`, encrypts and stores.
- `POST /api/crm/connection/test` → `health()` + `find_account` with a sample MDM from the default file (read-only) → stores `last_health`.
- `GET /api/crm/field-map` → the map (admin only; never exposed to reps except via the next route).
- `PUT /api/crm/field-map` body = full document → pydantic-validated → saved → cache invalidated.
- `GET /api/crm/form-config` (`require_auth`) → enabled activity types + `custom_params` per type (what the Dashboard renders).
- `POST /api/workflows/executions/{id}/recheck` (`require_auth`, own executions; admin any) → read-back only; flips `unverified` → `confirmed` if found.
- `GET /api/config/activity-types` keeps working; enabled types = types present in the field map (seed `activity_types.enabled` accordingly at startup, do not drop the collection).

### P2.T7 — Frontend
- Connections page: "CRM Connection" card — type select (Power Automate flow / Direct Dataverse), flow URL (password-style input, shows host after save), key, Save, "Test connection" (shows WhoAmI user + sample account result + latency), field-map JSON upload (file input → PUT), last health. Keep the old webhook card visible but labelled "Legacy webhook (used only when no CRM connection is configured)".
- Dashboard: activity type select from `/crm/form-config`; render `custom_params` inputs (text) for the selected type, sent as `params.custom`; also send `params.lookup` with `mdm_id` and any custom params whose `used_for` is `filter`; "Re-check" button on unverified rows (calls recheck, refreshes).
- File management: activity type select for sheet and rules (default appointment).

### P2.T8 — Tests (fake flow `/v1`)
Service: confirmed path (body contains `activityid`, `@odata.bind`, `scheduledend`, completion PATCH applied); idempotent retry (first attempt times out after the fake stored the record → second create gets duplicate → read-back confirms → exactly one record in `/_records`); each error code in §6 reachable; ambiguous/not-found account; custom field + custom filter end-to-end from field map with zero code change (add them in the test's field map only); phonecall and task paths; dry run makes zero calls; legacy shim still works when no `crm_connections` exists.

---

## Click paths (G4) — fake flow `/v1` with a field map that includes one custom filter and one custom field

1. Admin → Connections → configure flow (fake URL + key) → Test → shows WhoAmI + sample account.
2. Admin → upload field map JSON → Dashboard shows the custom inputs for Appointment.
3. Dashboard → Appointment with custom field + custom filter → confirmed; fake store record has the custom field and correct regarding bind.
4. Dashboard → Phone call → confirmed. Task → confirmed.
5. Fake returns 400 on a field → red toast `CRM_VALIDATION` with the Dataverse message.
6. Force read-back miss (fake mode) → amber unverified → Re-check after fixing → green.
7. Activity sheet with 3 rows as phone calls → 3 confirmed.
8. Remove `crm_connections` → legacy webhook still used (regression).

## Production rollout (G7 + canary)
1. Deploy with `crm_connections` absent → legacy shim → prod unchanged (smoke).
2. Admin configures the real flow + uploads `private/field_map.json` in prod → Test connection green.
3. With user approval "approve canary P2": one `[LOOP-CANARY]` appointment, phone call and task via the Dashboard → all confirmed → user verifies in D365 and deletes them.
4. Record results in HANDOFF.md.

## Definition of done
- [ ] Tasks ticked; G1–G7 green; canary confirmed (or explicitly waived by the user)
- [ ] Adding a filter/field demonstrated by config only (test + note in HANDOFF)
- [ ] STATE.md, HANDOFF.md updated; P2 DONE
