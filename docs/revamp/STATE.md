# STATE — revamp tracker (single source of truth)

Update rules: [DOCTRINE.md §6](DOCTRINE.md). Edit only your phase's rows plus the log. Pull/rebase before editing.

**Last updated:** 2026-10-09 by Claude (Opus 5.5) — P0 in progress.
**Baseline:** `ab7e7f0` on `main`.
**Production:** www.loopcopilot.cc (frontend), api.loopcopilot.cc (backend), Railway. Running baseline code.

---

## Phase board

| Phase | Name | Status | Agent / branch | Depends on | Parallel with |
|---|---|---|---|---|---|
| P0 | Groundwork | IN PROGRESS | Claude Opus 5.5 / `revamp/p0-groundwork` (worktree `../loop-p0`) | — | — |
| P1 | Truthful Logging | IN PROGRESS | Claude Sonnet 5.5 / `revamp/p1-truthful-logging` (worktree `../loop-p1`) | P0 | P3 |
| P2 | Universal Connector | NOT STARTED | — | P0, P1 | P3 |
| P3 | Model Layer | NOT STARTED | — | P0 | P1, P2 |
| P4 | MCP Bridge | NOT STARTED | — | P2, P3 | — |
| P5 | Restructure | NOT STARTED | — | P1–P4 | — |
| P6 | Hardening | NOT STARTED | — | P5 | — |
| P7 | CRM Expansion | FUTURE (needs spec refresh) | — | P6 | — |

Status values: `NOT STARTED` · `IN PROGRESS` · `GATE` (building done, running G1–G7) · `DONE` · `BLOCKED: <reason>`.

## Task ticks
(Each agent adds its phase's task list here when starting, e.g. `- [x] P1.T1 Status vocabulary`.)

### P0
- [x] P0.R0 Railway failed build/deploy root cause recorded (see "Railway deploy failures")
- [x] P0.T1 `/api/version`
- [x] P0.T2 Test harness (`tests/conftest.py`, smoke tests)
- [x] P0.T3 Fake flow (`tests/fakes/fake_flow.py`) + tests
- [x] P0.T4 D365 probe script (`scripts/d365_probe.py`)
- [x] P0.T5 Dev DB facts + `docs/revamp/private/` folder
- [ ] P0.T6 Evidence collection (prod DB read-only — needs user go-ahead)
- [ ] P0.U1 Railway webhook/D365 logs + auto-deploy branch
- [ ] P0.U2 Flow run history + current trigger URL host
- [ ] P0.U3 DLP / "HTTP with Microsoft Entra ID (preauthorized)" check
- [ ] P0.U4 Generic flow built (FLOW_BUILD_GUIDE.md)
- [ ] P0.U5 Schema facts → `private/D365_SCHEMA.md`, `private/field_map.json`
- [ ] P0.U6 Canary (optional)

### P1
- [x] P1.T1 Status vocabulary + `_finalize_execution`
- [x] P1.T2 Transport order + opt-in flags, `D365_SCOPES`
- [x] P1.T3 Dry run is real
- [x] P1.T4 Correct payload data (`timeutil.py`, completed status, `scheduledend`)
- [x] P1.T5 Account resolution (`account_match.py`)
- [x] P1.T6 Bulk jobs count truthfully, retries never blocked
- [x] P1.T7 Legacy URL detection
- [x] P1.T8 CORS PATCH + rate-limit decorator order
- [x] P1.T9 Frontend truth
- [ ] P1.G Gates G1–G7

---

## Findings closed
(ID — phase — commit) e.g. `B12 — P1 — abc1234`

---

## Root cause (filled by P0)
- B11 legacy URL host: _unknown_
- Execution status distribution (90d): _unknown_
- Proven chain: _unknown_

## Railway deploy failures (filled by P0, 2026-10-09)
Source: Railway CLI `deployment list` (MCP not loaded in session; CLI is logged in). Build/deploy logs for the failed deployments are **no longer retained** by Railway (fetch returns empty), so causes are proven from deployment→commit mapping and the fix commits in local git history.
- **Status now:** no open failures. Latest `sales-copilot-api` and `sales-copilot-ui` deployments (commit `acccb8e`, 2026-10-09) are `SUCCESS`. All failures are from 2026-05-17 → 2026-05-19 (3 api, 11 ui) on pre-public-release history.
- **api (3 FAILED, `ef00f71`, `977087a`):** the `02/Habit-Tracking` merge (`ef00f71`) **deleted `backend/requirements.txt`**, so the Python build had no dependency manifest. Fixed by `482dd8d` "Restore backend/requirements.txt"; `977087a` redeploy then succeeded.
- **ui (11 FAILED, `ef00f71` → `ac784b4`):** a chain of package-manager/lockfile drift: (1) `package.json` had `packageManager: yarn@1.22.22` + a committed `yarn.lock` → Railpack ran yarn; (2) `66253a4` added `serve` devDep, `9ed09ec` removed `packageManager`, `e42a203` removed `yarn.lock` and fixed a trailing-comma JSON error — but **`package-lock.json` was never regenerated**, so strict `npm ci` kept failing (plus a React 19 vs `react-day-picker@8` peer conflict, fixed by `.npmrc legacy-peer-deps` in `086f68b`). Root cause: **`package-lock.json` out of sync with `package.json`**. Fixed by `5665cb4` "Sync package-lock.json" — first green ui build. Later port fixes (`b1d6bda`…`c0969f8`) were runtime routing, not build failures.
- **Lessons for every phase:** never delete/rename `backend/requirements.txt`; any `frontend/package.json` dependency change must ship with a regenerated `package-lock.json` (`npm install --legacy-peer-deps`); do not reintroduce `yarn.lock` or `packageManager`.

## Environment facts
- Local backend runs must use `DB_NAME=sales_copilot_dev` (never the prod DB).
- **Danger (P0 finding):** the main checkout's `.env` points at the **production** Atlas cluster with `DB_NAME=sales_copilot` (same host + DB name as Railway prod). Always override on the command line: `APP_ENVIRONMENT=dev DB_NAME=sales_copilot_dev python -m uvicorn server:app --port 8000` (`load_dotenv` does not override variables already set). Local `.env` has `APP_ENVIRONMENT=development`, which the code does **not** treat as dev (`APP_ENV == 'dev'`) — always pass `APP_ENVIRONMENT=dev`.
- Confirm the target before starting the server, host and DB only (never print the URL): `python -c "import os;from dotenv import dotenv_values as d;from urllib.parse import urlsplit as u;v=d('.env');print(u(v['MONGO_URL']).hostname, os.environ.get('DB_NAME', v.get('DB_NAME')))"`
- Tests: `python -m pip install -r backend/requirements.txt -r backend/requirements-dev.txt`, then `python -m pytest tests -q` from the repo root (in-memory mongomock; never touches Atlas). Fake flow: `python -m uvicorn tests.fakes.fake_flow:app --port 8765`. Probe: `scripts/d365_probe.py` (reads `docs/revamp/private/.env.probe`; use `--env-file <abs path>` from a worktree).
- `docs/revamp/private/` exists only in the main checkout. The main checkout is on branch `backup/pre-clean-main-2026-08-11` (unrelated history), whose `.gitignore` lacks the rule, so `docs/revamp/private/` was also added to `.git/info/exclude` (local, all worktrees).
- `gh` CLI is not authenticated; ship with plain `git push`.
- Railway auto-deploy branch: `main` for both `sales-copilot-api` and `sales-copilot-ui` (confirmed P0 from deployment metadata; project `outstanding-harmony`, env `production`; Railway source repo shows as `niranjan-vsks/sales-copilot`, same repo as `origin`).
- Backend start command comes from `backend/railway.json` (`$PORT`); do not change (B26).
- Flow variant: _A or B, decided in P0_.
- LLM env (after P3): `LLM_PROVIDER` (auto), `LLM_FALLBACK` (groq), `GROQ_API_KEY`, `GROQ_MODEL`, `GEMINI_API_KEY` (user adds when ready), `GEMINI_MODEL`, `LLM_TIMEOUT_S`.
- New env (P2): none required; flow URL/key are stored encrypted in Mongo via the admin UI. `DEFAULT_TIMEZONE` optional (default `Asia/Kolkata`, P1).

## Decisions (append-only)
- 2026-10-09 — Lenovo IT approval is not available. In-tenant execution via a Power Automate flow running as the user is the Lenovo path. No consent/DLP circumvention.
- 2026-10-09 — "Power Automate MCP" means the Dataverse MCP server. It needs tenant admin consent → used only for consenting tenants (P4). Copilot Studio route is a spike (P4.T4).
- 2026-10-09 — Groq stays default; Gemini activates by adding `GEMINI_API_KEY`; Groq is the fallback.
- 2026-10-09 — The flow becomes a thin generic proxy (`loop.crm.v1`); filters/fields live in `crm_field_maps`.
- 2026-10-09 — Pre-approved dependencies: `tzdata`, `google-genai`, `mcp`; dev: `pytest`, `pytest-asyncio`, `respx`, `mongomock-motor`. Pre-approved collections: `crm_field_maps`, `crm_connections`, `crm_outbox`.

## Log (newest first, one line each)
- 2026-10-10 — P1 started (Sonnet 5.5). User declared P0 done and said go ahead; P0 U1–U6/T6 are still unticked in STATE, so the P0 'DONE' dependency was waived by the user. P1 uses only P0 T1–T5 outputs (harness, fake flow); D365_SCHEMA.md status codes are unverified so spec defaults are used.
- 2026-10-09 — P0 started (Opus 5.5). Railway failed-deploy root cause recorded: api = deleted requirements.txt; ui = stale package-lock.json. Both fixed in May; prod green.
- 2026-10-09 — Specs, doctrine, audit, architecture, flow guide written (docs/revamp). Waiting for `BULLSEYE P0`.
