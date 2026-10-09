# STATE — revamp tracker (single source of truth)

Update rules: [DOCTRINE.md §6](DOCTRINE.md). Edit only your phase's rows plus the log. Pull/rebase before editing.

**Last updated:** 2026-10-09 by Claude (Opus 5.5) — specs written, no code changed yet.
**Baseline:** `ab7e7f0` on `main`.
**Production:** www.loopcopilot.cc (frontend), api.loopcopilot.cc (backend), Railway. Running baseline code.

---

## Phase board

| Phase | Name | Status | Agent / branch | Depends on | Parallel with |
|---|---|---|---|---|---|
| P0 | Groundwork | NOT STARTED | — | — | — |
| P1 | Truthful Logging | NOT STARTED | — | P0 | P3 |
| P2 | Universal Connector | NOT STARTED | — | P0, P1 | P3 |
| P3 | Model Layer | NOT STARTED | — | P0 | P1, P2 |
| P4 | MCP Bridge | NOT STARTED | — | P2, P3 | — |
| P5 | Restructure | NOT STARTED | — | P1–P4 | — |
| P6 | Hardening | NOT STARTED | — | P5 | — |
| P7 | CRM Expansion | FUTURE (needs spec refresh) | — | P6 | — |

Status values: `NOT STARTED` · `IN PROGRESS` · `GATE` (building done, running G1–G7) · `DONE` · `BLOCKED: <reason>`.

## Task ticks
(Each agent adds its phase's task list here when starting, e.g. `- [ ] P1.T1 Status vocabulary`.)

---

## Findings closed
(ID — phase — commit) e.g. `B12 — P1 — abc1234`

---

## Root cause (filled by P0)
- B11 legacy URL host: _unknown_
- Execution status distribution (90d): _unknown_
- Proven chain: _unknown_

## Environment facts
- Local backend runs must use `DB_NAME=sales_copilot_dev` (never the prod DB).
- `gh` CLI is not authenticated; ship with plain `git push`.
- Railway auto-deploy branch: _to confirm in P0 (expected `main`)_.
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
- 2026-10-09 — Specs, doctrine, audit, architecture, flow guide written (docs/revamp). Waiting for `BULLSEYE P0`.
