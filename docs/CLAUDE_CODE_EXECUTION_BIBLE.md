# Claude Code Execution Bible

> Operating manual for AI coding agents (Claude Code, v0, Cursor, etc.) working in the `sales-copilot` repository. Read this before making any change. It encodes the repository's conventions, invariants, landmines, and verification procedures so an agent can work safely without re-deriving them.
>
> Companion documents: [MASTER_ENGINEERING_INDEX.md](./MASTER_ENGINEERING_INDEX.md) (start here), [ARCHITECTURE_BIBLE.md](./ARCHITECTURE_BIBLE.md), [TECHNICAL_DEBT_AND_REFACTORING_BIBLE.md](./TECHNICAL_DEBT_AND_REFACTORING_BIBLE.md)

---

## 1. Repository Orientation (60-Second Version)

- **Stack:** FastAPI (Python, async) backend + Create React App (JavaScript, not TypeScript) frontend + MongoDB (Motor). AI via Anthropic SDK. Integrations: Microsoft Graph/Dynamics 365 OAuth, SMTP email, optional n8n webhooks, optional Playwright automation.
- **Backend entry point:** `backend/server.py` (~2,250 lines — the monolith). All routes are mounted under `/api` via `api_router`.
- **Frontend entry point:** `frontend/src/App.js` (SPA with react-router; pages in `frontend/src/pages/`, shared UI in `frontend/src/components/`).
- **Auth:** custom session tokens (bcrypt + opaque token in `sessions` collection) from `auth_signup.py`, plus Microsoft OAuth in `microsoft_auth.py`. Session token is sent as a Bearer header; `get_current_user` dependency resolves it.
- **Sensitive payloads:** login/signup bodies are AES-GCM encrypted client-side (`frontend/src/lib/crypto.js`) and decrypted server-side (`backend/payload_crypto.py`). **Both files must stay in sync.**
- **Prompts:** live as text files in `backend/prompts/`. Do not inline prompts in Python.

## 2. Golden Rules

1. **Every user-data query must filter by `user_id`.** There is no RLS, no ORM scoping — a missing `user_id` filter is a cross-tenant data leak. This is the single most important invariant in the codebase.
2. **Never log or echo secrets** — session tokens, `ANTHROPIC_API_KEY`, SMTP creds, D365 tokens, or decrypted login payloads.
3. **Do not change the crypto scheme unilaterally.** `payload_crypto.py` (Python) and `crypto.js` (JS) implement the same AES-GCM envelope. Any change to key derivation, IV handling, or encoding must be made in both files in the same commit.
4. **Do not convert the frontend to TypeScript** or restructure CRA tooling as a side effect of another task. Propose it separately.
5. **Mongo documents use `id` (UUID string), not `_id`, as the app-level identifier.** Responses exclude `_id` (queries project it out or models strip it). Follow the existing pattern.
6. **All API routes go on `api_router`** (prefix `/api`), never directly on `app`, or the frontend proxy and deploy routing will miss them.
7. **Datetimes are stored as ISO strings in UTC** in most collections. Match the existing convention of the collection you are touching — check before assuming datetime objects.
8. **Prompts change behavior; treat them like code.** If you edit a file in `backend/prompts/`, state the behavioral intent in the commit message.

## 3. Things That Look Wrong But Are Intentional

| Observation | Why it is that way |
|---|---|
| Passwords are pre-hashed with SHA-256 client-side, then bcrypt server-side | Defense-in-depth choice made with encrypted payloads; do not "simplify" to plaintext-over-TLS without an explicit decision |
| `server.py` is a monolith | Known debt, documented in TECHNICAL_DEBT_AND_REFACTORING_BIBLE.md — extract only when a task requires touching that area, per the refactoring plan there |
| Reminders/notifications are computed on-read, not scheduled | Deliberate: no scheduler exists; do not add cron-like behavior in-process |
| Some D365 code exists twice (Web API client + Playwright browser automation) | Playwright path is legacy/fallback; prefer `d365_client.py` for new work |
| CORS allows the deployed frontend origins explicitly | Keep the allowlist explicit; do not switch to `*` |

## 4. Landmines (Do Not Step Here Casually)

- **`microsoft_auth.py` in-memory OAuth state** — breaks under multiple instances; if you touch auth, don't add more in-memory state.
- **In-memory rate limiters** in signup/login — same constraint.
- **`asyncio.create_task` background processing** for Excel uploads — a redeploy kills jobs. Don't add new fire-and-forget background tasks; if a task needs background work, discuss the queue plan in PRODUCTION_AND_SCALING_BIBLE.md §6.
- **`d365_browser.py` (Playwright)** — heavy, fragile, environment-dependent. Never import it into request-path code.
- **Token refresh for Microsoft OAuth** — refresh logic and expiry windows are delicate; test against a real tenant before merging changes.
- **Excel parsing (`excel_processor.py`, `activity_sheet_processor.py`)** — column mappings are driven by real customer sheets. Do not "clean up" header matching without sample files.

## 5. How to Make Common Changes

### Add a new API endpoint
1. Define the Pydantic request/response models near the other models in `server.py` (or the relevant module).
2. Add the route to `api_router` with the `get_current_user` dependency unless it is genuinely public.
3. Filter every DB query by `current_user["id"]`.
4. Add the frontend call in `frontend/src/lib/api.js` (all HTTP goes through this module — never `fetch` directly from components).

### Add a new AI behavior
1. Put the prompt in a new file under `backend/prompts/`.
2. Load it the way `ai_chat.py` loads its prompt (read at call time or module import, matching existing code).
3. Reuse the existing Anthropic client setup and model constant; do not hardcode a different model string without checking currently valid model IDs.
4. Cap injected context (chat history windows, KB excerpts) — unbounded context is a cost and latency bug.

### Add a new collection
1. Use UUID-string `id`, `user_id`, and ISO-UTC timestamps.
2. Add the index to the checklist in PRODUCTION_AND_SCALING_BIBLE.md §5.
3. Exclude `_id` from responses like every other endpoint.

### Change the frontend
1. Pages in `frontend/src/pages/`, shared components in `frontend/src/components/`.
2. Use the existing api.js client and existing toast/error patterns.
3. Keep JavaScript (no TS), keep the existing styling approach used by neighboring components.

## 6. Verification Procedures

There is **no test suite**. Verification is manual/agent-driven:

1. **Backend boots:** `cd backend && python -c "import server"` catches syntax/import errors cheaply. Full check: run uvicorn and hit `GET /api/`.
2. **Frontend builds:** `cd frontend && npm run build` (CRA is strict about unused vars in CI mode — fix warnings it escalates).
3. **Auth smoke test:** signup → verify (grab code from logs/db in dev) → login → call an authenticated endpoint.
4. **Browser verification:** for UI changes, load the app, exercise the changed flow, and screenshot. A clean compile is not verification.
5. **Multi-tenancy check (mandatory for any DB-touching change):** confirm every new/modified query includes the `user_id` filter. Grep your diff for `find(`, `find_one(`, `update_`, `delete_` and inspect each.
6. **Crypto round-trip (if payload_crypto/crypto.js touched):** encrypt in browser console, decrypt server-side, both directions.

## 7. Environment & Secrets Map

| Variable | Used by | Notes |
|---|---|---|
| `MONGO_URL`, `DB_NAME` | server.py bootstrap | Motor client |
| `ANTHROPIC_API_KEY` | ai_chat.py, processors | The main variable cost |
| `PAYLOAD_ENC_KEY` (or equivalent) | payload_crypto.py + baked into frontend build | Must match between FE build and BE |
| `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `MS_TENANT_ID`, redirect URI | microsoft_auth.py | OAuth + Graph + D365 |
| `D365_*` | d365_client.py | Web API base URL, scopes |
| SMTP host/port/user/pass/from | email_service.py | Verification + reset emails |
| `N8N_WEBHOOK_URL` | n8n_client.py | Optional; code must no-op gracefully when absent |
| `CORS_ORIGINS` / frontend URL | server.py CORS | Explicit allowlist |

Never print these. When a new variable is needed, add it to this table.

## 8. Task Playbook for Agents

1. **Read `MASTER_ENGINEERING_INDEX.md`** to locate the right bible for your task domain.
2. **Gather context in parallel** — read all files you'll touch plus their callers before editing.
3. **Prefer the smallest change that fits existing patterns.** This codebase rewards consistency over cleverness; a locally-idiomatic fix beats an architecturally "better" one that fragments conventions.
4. **When a task requires touching a landmine (§4), stop and surface the constraint** to the user instead of silently working around it.
5. **Run the §6 verification steps relevant to your change** before declaring done.
6. **Update these docs** when you change something they describe — stale bibles are worse than none. In particular: new env vars → §7 table; new collections → index checklist; new invariants → §2.

## 9. Definition of Done

A change is done when:
- [ ] It follows §2 golden rules (especially `user_id` scoping)
- [ ] Backend imports cleanly and frontend builds
- [ ] The changed flow was exercised end-to-end (browser for UI, curl/client for API)
- [ ] No secrets in logs, diffs, or error messages
- [ ] Relevant bible sections were updated
- [ ] The commit message states behavioral intent, not just mechanics
