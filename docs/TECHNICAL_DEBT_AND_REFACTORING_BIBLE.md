# TECHNICAL DEBT & REFACTORING BIBLE

> Every known debt item, scored and sequenced. Debt here means: code that works today but taxes every future change.
> Scoring: **Impact** (how much it slows/risks future work, 1–5) × **Effort** (1=hours, 5=multi-week) → priority = high impact, low effort first.
> Security-classified items live in ENTERPRISE_SECURITY_BIBLE and are referenced, not duplicated.

---

## 1. Debt Register

| ID | Item | Impact | Effort | Priority | Detail |
|---|---|---|---|---|---|
| TD-01 | `server.py` monolith (~2,250 lines: routes, models, jobs, startup, SPA serving in one file) | 5 | 3 | **P1** | §3 |
| TD-02 | Zero tests, zero CI (a `tests/` dir with only `__init__.py`) | 5 | 2 | **P0** | §2 |
| TD-03 | In-process background jobs (`asyncio.create_task`) — non-durable, die on deploy, stuck-"running" jobs | 5 | 3 | **P1** | §4 |
| TD-04 | Global `bot_config` document (also SEC-12) | 5 | 4 | **P0/P1** | SECURITY §5 |
| TD-05 | Customer-specific logic hardcoded: Lenovo column aliases, "Customer Meeting" subtype, MDM IDG/ISG assumptions | 4 | 2 | **P1** | §5 |
| TD-06 | Duplicate D365 write logic: chat path, workflow path, sheet path, batch path each re-implement parts of the fallback chain | 4 | 2 | **P1** | Extract one `D365WriteService` used by all four |
| TD-07 | Two API response shapes: bare objects (old routes) vs `{success, data, error}` envelope (new routes) | 3 | 2 | P2 | Standardize on envelope; frontend `api.js` already tolerates both |
| TD-08 | Frontend mixes `axios` and the `lib/api.js` fetch wrapper | 2 | 1 | P2 | Standardize on `api.js`; drop axios dependency |
| TD-09 | Plain JS frontend, no TypeScript | 3 | 4 | P3 | New code in TS; migrate opportunistically (CRA→Vite makes this natural) |
| TD-10 | Legacy `accounts` global collection still a search fallback alongside `user_account_data` | 3 | 2 | P2 | Migrate remaining data, delete fallback branch |
| TD-11 | Lint/format tools in requirements (black/isort/flake8) but not enforced | 2 | 1 | **P0** (rides CI) | Add to CI gate |
| TD-12 | Dual deploy configs: `render.yaml` + Railway `railway.json`/`Procfile` both live | 2 | 1 | P2 | Pick Render, delete Railway files |
| TD-13 | `HashRouter` + backend SPA catch-all both present (either alone suffices) | 2 | 1 | P3 | Move to BrowserRouter once single-serve mode is confirmed |
| TD-14 | No request IDs / structured logging; file logs on ephemeral disk | 4 | 2 | **P1** | JSON logs to stdout + drain; request-ID middleware |
| TD-15 | Copy-pasted `requirements.txt` at repo root (Render build path) can drift from `backend/requirements.txt` | 2 | 1 | P2 | Single source; symlink or build script |
| TD-16 | Unused/dead surfaces: `TopNavLayout`, `n8n_client` stubs presented as workflows in UI, `Frontend_designs/` exports in repo | 2 | 1 | P3 | Delete or clearly mark; move designs out of repo |
| TD-17 | No DB migration story (index creation at startup is the only schema management) | 3 | 2 | P2 | Adopt a migrations runner (e.g. beanie/pymongo-migrate or hand-rolled versioned scripts) before `org_id` backfill |
| TD-18 | Sync SMTP + Playwright inside async request paths (thread offload exists but fragile) | 3 | 2 | P2 | Move both behind the job queue (TD-03) |

---

## 2. TD-02: The Test Vacuum (fix first, fix now)

Nothing in this codebase can be safely changed until this lands. Minimum harness:

1. **Stack**: `pytest` + `pytest-asyncio` + `httpx.AsyncClient` against the FastAPI app + `mongomock-motor` (or a throwaway Atlas/testcontainers Mongo).
2. **Fixtures**: app factory with injected test DB; authenticated-client fixture (seeded user + hashed session); admin-client fixture.
3. **First test targets (highest value per test):**
   - Auth: login/logout/me, session expiry, admin gate.
   - Tenant/user scoping: user A cannot read user B's files/rules/jobs (pre-`org_id` IDOR suite → grows into the tenant-isolation suite).
   - Activity sheet parse: golden files for TSV/CSV/markdown/pipe tables, column alias mapping, datetime edge cases (pure functions — easiest wins in the repo).
   - Excel processor: header detection, fuzzy matching thresholds.
   - Chat envelope parsing: malformed JSON, unknown actions, valid action dispatch (mock Groq).
   - D365 fallback chain: each tier's failure promotes the next (mock httpx).
4. **CI**: GitHub Actions — lint (black/isort/flake8) + tests on every PR; branch protection on `main`.

Definition of done: EXECUTION TASK-001/002. Target: ~60% line coverage on `activity_sheet_processor`, `excel_processor`, auth, and the fallback chain before any refactor from §3 begins.

---

## 3. TD-01: Monolith Decomposition Plan

Split `server.py` mechanically, no behavior change, in this order (each step is a PR with tests green):

```
backend/
├── main.py               # app factory, middleware, router mounting, startup
├── config.py             # env loading + fail-hard checks
├── deps.py               # get_current_user, require_admin, db handle
├── models/               # Pydantic request/response models (extract as-is)
├── routes/
│   ├── auth.py           # + mount auth_signup router here
│   ├── chat.py
│   ├── workflows.py
│   ├── d365_admin.py     # test/activities/webhook/browser/status
│   ├── excel.py          # rules, batch jobs, imports
│   ├── files.py          # uploads, accounts search
│   ├── sheets.py         # activity-sheets
│   ├── team_settings.py  # team, settings, monitoring
│   └── user.py           # preferences, telegram, calendar
├── services/
│   ├── d365_write.py     # TD-06: the single fallback-chain writer
│   ├── jobs.py           # job orchestration (later: queue adapter)
│   └── notifications.py  # telegram
└── (existing modules unchanged: ai_chat, knowledge_base, d365_client, …)
```

Rules: extraction only — no renames of routes, no response-shape changes (that's TD-07, a separate pass). The `api_router` prefix and every path stay byte-identical; the integration test suite from §2 is the safety net.

---

## 4. TD-03: Background Job Durability

Current: `asyncio.create_task` for batch jobs and sheet executions; progress documents in `batch_jobs`/`activity_sheet_jobs`. Deploy/restart mid-job ⇒ job stuck "running" forever, rows partially written to D365, no resume.

Target (Phase 1): **queue-backed workers**.
- Broker: Redis + `arq` (async-native, minimal) — Celery acceptable if team prefers.
- Job records stay in Mongo (they're also the user-facing progress API); the queue carries only job IDs.
- **Idempotency**: sheet rows already dedup by `serial_no` — formalize: every row write checks `activity_sheet_log` before D365 write, making job retries safe. Batch rules need an equivalent (row hash).
- **Leases + heartbeats**: a reaper marks jobs with stale heartbeats as `failed(retryable)`.
- Interim mitigation (cheap, do immediately): on startup, mark all `running` jobs older than X as `interrupted` so the UI stops showing phantom progress.

---

## 5. TD-05: De-Lenovo-ing the Product

Inventory of customer-specific hardcoding:
- Column aliases: "Primary Lenovo Attendee", MDM ID IDG/ISG column names (`activity_sheet_processor`).
- Activity subtype "Customer Meeting" defaults.
- Implicit MDM-ID account model (`mdm_id`, `mdm_type`) shaping `user_account_data`.

Fix: introduce **per-org sheet-mapping config** (a `column_mappings` doc per org: alias → canonical field), seed it with the current aliases as the default profile, and load it in the processor. The Lenovo profile becomes config row #1 instead of code. Ship with an admin UI later; config-by-Mongo-document is fine first.

---

## 6. Refactoring Roadmap (sequenced)

| Order | Work | Depends on | Maps to |
|---|---|---|---|
| 1 | Test harness + CI + lint gate (TD-02, TD-11) | — | TASK-001…004 |
| 2 | Startup job-reaper mitigation (TD-03 interim) | 1 | TASK-005 |
| 3 | Security P0s (SEC-01/03/05/07/09) | 1 | TASK-006…009 |
| 4 | Monolith split (TD-01) + single D365 writer (TD-06) | 1 | TASK-010 |
| 5 | Migrations runner (TD-17) → `org_id` backfill + per-org connections (TD-04/SEC-12) | 4 | TASK-011/012 |
| 6 | Queue-backed jobs (TD-03 full) | 4 | TASK-013 |
| 7 | Observability: request IDs, JSON logs, Sentry (TD-14) | 4 | TASK-014 |
| 8 | Response envelope unification (TD-07), axios removal (TD-08), legacy `accounts` retirement (TD-10) | 4 | TASK-015…017 |
| 9 | Per-org column mappings (TD-05) | 5 | TASK-018 |
| 10 | Deploy config cleanup (TD-12/15), dead code removal (TD-16), router modernization (TD-13), TS adoption (TD-09) | any | TASK-019+ |

**Standing rule**: no new feature PR may increase the size of `server.py` once step 4 begins; new routes go straight into `routes/`.

## 7. What Is *Not* Debt (deliberate calls to keep)

- **Mongo over Postgres**: document model fits the variable-shape sheet/execution data; revisit only if relational reporting demands it (see EDR-02).
- **FastAPI monolith over microservices**: correct at this scale and for the next 18 months.
- **Deterministic parsers over LLM parsing**: keep (AI BIBLE §5).
- **UUID string IDs + `{_id: 0}` projections**: consistent and API-friendly; keep.
- **Fail-hard startup checks**: expand, don't remove.
