# MASTER ENGINEERING INDEX

> The table of contents for the entire company. Every other document in `docs/` hangs off this one.
> Audience: founders, new senior engineers, investors performing technical due diligence, Claude Code executing tasks.

---

## 1. Executive Summary

**Sales Copilot** is a CRM activity-automation platform for enterprise sales teams. Its core insight: sales reps hate logging activities into Dynamics 365, so they don't — and CRM data quality collapses. Sales Copilot removes that friction with four logging surfaces:

1. **AI Chat** — natural language ("log a meeting with Acme yesterday about the Q3 renewal") → structured D365 appointment, powered by Groq Llama with live application-state prompt injection.
2. **Activity Sheets** — paste or upload a table of meetings (TSV/CSV/Excel/markdown); the system parses, deduplicates by serial number, AI-summarizes informal notes into professional CRM prose, fuzzy-matches account names to canonical MDM IDs, and bulk-logs to D365.
3. **Batch Rules** — reusable templates ("Customer Meeting with {name}") executed across an uploaded account list.
4. **Manual form** — dashboard quick-log.

Its most differentiated (and most dangerous — see Security Bible) engineering artifact is the **three-tier D365 connection fallback chain**: OAuth token → Power Automate webhook → headless-browser cookie-session token extraction. This was born from real enterprise pain: tenant admins refuse OAuth consent, so the product routes around IT.

**Stage**: working beta, single-tenant, deployed on Render free tier (Railway configs also present). No tests, no CI/CD, no billing, no multi-tenancy. Origin context is a Lenovo sales team (MDM ID IDG/ISG column detection, "Primary Lenovo Attendee" column alias, hardcoded "Customer Meeting" subtype).

**The bet**: activity capture is the wedge; the durable asset is the **customer interaction memory** accumulating in `app_knowledge_base` and `activity_sheet_log`. See PRODUCT_AND_FEATURE_BIBLE.md §3.

---

## 2. Current Product Snapshot

| Surface | Route | Status |
|---|---|---|
| Login (email+password, Microsoft OAuth) | `/login` | Live |
| Signup with email OTP verification | `/signup` | Live |
| Dashboard (quick-log activity, stats) | `/dashboard` | Live |
| AI Chat | `/chat` | Live |
| Activities log (D365 + local fallback merge) | `/activities` | Live |
| File Management (account list upload) | `/admin/file-management` | Live (all users) |
| Profile & preferences (incl. Telegram) | `/profile` | Live |
| Admin: Connections (webhook, browser cookies) | `/admin/connections` | Live (admin) |
| Admin: Team management | `/admin/team` | Live (admin) |
| Admin: Monitoring dashboard | `/admin/monitoring` | Live (admin) |
| Workflows: sync-emails, search-leads, update-calendar, process-files, alerts | — | `coming_soon` stubs |

---

## 3. Architecture Summary

```
┌─────────────────────────┐        ┌──────────────────────────────────┐
│ React SPA (CRA/craco)   │  HTTPS │ FastAPI monolith (server.py)     │
│ HashRouter, shadcn UI   │───────▶│  /api/* — auth, chat, workflows, │
│ cookie session          │  CORS  │  excel, files, activity-sheets,  │
│ AES-GCM field encrypt   │        │  team, settings, monitoring     │
└─────────────────────────┘        └───────┬──────────┬──────────────┘
                                           │          │
                              MongoDB Atlas│          │ External
                              (Motor async)│          ▼
                                           │   ┌─ Microsoft Entra ID (MSAL OAuth)
                                           │   ├─ D365 Dataverse Web API v9.2
                                           │   ├─ Power Automate HTTP webhook
                                           │   ├─ Playwright headless Chromium (cookie path)
                                           │   ├─ Microsoft Graph (calendar, mail scopes)
                                           │   ├─ Groq API (Llama 3.1 8B instant)
                                           │   ├─ SMTP (OTP emails)
                                           │   └─ Telegram Bot API (notifications)
                                           ▼
                              15 collections (see ARCHITECTURE_BIBLE §5)
```

Full detail: **ARCHITECTURE_BIBLE.md**.

---

## 4. Repository Map

```
/
├── backend/                     # FastAPI service (Python 3.11)
│   ├── server.py                # ★ 2,250-line monolith: all routes, models, jobs, startup
│   ├── microsoft_auth.py        # MSAL OAuth: login, token refresh, D365 token acquisition
│   ├── auth_signup.py           # Email+OTP signup router (factory pattern)
│   ├── ai_chat.py               # Groq chat layer, live-state system prompt builder
│   ├── knowledge_base.py        # Event log + AI context snapshot service
│   ├── d365_client.py           # Dataverse Web API client + PA webhook static method
│   ├── d365_browser.py          # Playwright cookie-session token extraction
│   ├── activity_sheet_processor.py  # Table parsing, column alias mapping, datetime, notes AI
│   ├── excel_processor.py       # xlsx/csv parsing, column auto-detect, Jaccard fuzzy match
│   ├── email_service.py         # SMTP OTP email (inline HTML template)
│   ├── payload_crypto.py        # AES-GCM field decryption (frontend counterpart: lib/crypto.js)
│   ├── n8n_client.py            # Phase-2 stub (returns coming_soon)
│   ├── log_config.py            # Daily-rotating file logs, 30-day retention
│   ├── prompts/                 # ai_chat_system.txt, notes_summarizer.txt
│   └── railway.json / Procfile  # Deploy configs
├── frontend/                    # React 18 SPA (CRA + craco, Tailwind, shadcn/Radix)
│   └── src/
│       ├── App.js               # HashRouter route table, AuthGuard wrapping
│       ├── components/          # AuthGuard, AccountSearchInput, ui/* (shadcn)
│       ├── layouts/             # SidebarLayout (primary), TopNavLayout (unused?)
│       ├── lib/                 # api.js (fetch wrapper), crypto.js (AES-GCM), utils.js
│       └── pages/               # Dashboard, Chat, Activities, Excel, Login, Signup,
│                                #   UserProfile, admin/{Connections,Team,Monitoring,FileManagement}
├── Frontend_designs/            # Static HTML design references (Stitch exports)
├── tests/                       # Empty (__init__.py only) — see TECHNICAL_DEBT §2
├── render.yaml                  # Render blueprint: API web service + static site
└── requirements.txt             # Root copy (Render build path)
```

---

## 5. Document Hierarchy & Reading Order

| # | Document | Role | Read when |
|---|---|---|---|
| 1 | **MASTER_ENGINEERING_INDEX.md** (this) | Map of everything | First, always |
| 2 | **ARCHITECTURE_BIBLE.md** | How the system works today + target architecture | Before touching any code |
| 3 | **ENTERPRISE_SECURITY_BIBLE.md** | Threat model, every vulnerability, remediation plans | Before launch, before enterprise sales, before SOC2 |
| 4 | **AI_AND_AGENT_ARCHITECTURE_BIBLE.md** | Prompt architecture, context system, agent roadmap | Before AI feature work |
| 5 | **ENGINEERING_DECISION_RECORDS.md** | Why things are the way they are (and which decisions to reverse) | When questioning a design |
| 6 | **TECHNICAL_DEBT_AND_REFACTORING_BIBLE.md** | Debt inventory, scores, refactoring roadmap | Before scheduling any sprint |
| 7 | **PRODUCT_AND_FEATURE_BIBLE.md** | Feature audit + full PRDs for the future product | Product planning |
| 8 | **STARTUP_READINESS_BIBLE.md** | Launch/YC/enterprise-procurement gap analysis | Pre-launch, pre-fundraise |
| 9 | **PRODUCTION_AND_SCALING_BIBLE.md** | Path from Render free tier to millions of users | Before scaling milestones |
| 10 | **CLAUDE_CODE_EXECUTION_BIBLE.md** | Executable task breakdown with acceptance criteria | When implementing anything |

Dependency flow: 2→3→4 describe reality; 5→6 critique it; 7→8 design the future; 9 scales it; 10 turns all of it into work items.

---

## 6. Implementation Order & Critical Path

**Phase 0 — Stop the bleeding (must precede any public launch)**
1. Security P0 fixes: session-token hashing, remove browser-cookie auth path from default config, tenant scoping of `bot_config`, rate-limit decorator ordering bug (SEC-01…SEC-07 in Security Bible).
2. Test harness + CI (TASK-001/002 in Execution Bible). Nothing else lands without this.

**Phase 1 — Foundation for a real company**
3. Multi-tenancy data model (`org_id` on every collection) — the single largest structural change; everything else compounds on it.
4. Extract `server.py` monolith into routers/services (TD-01).
5. Observability: structured logs to a drain, Sentry, request IDs.

**Phase 2 — Product expansion**
6. Meeting/Voice intelligence, Email copilot, Manager dashboard (Product Bible §4–§8).
7. Billing (Stripe), onboarding, admin controls.

**Phase 3 — Scale** (Production Bible): queue-backed jobs, caching, read replicas, SLOs.

**Critical path**: multi-tenancy → billing → enterprise controls. Every week of delay on `org_id` makes the migration more expensive.

---

## 7. Risk Register (top 10)

| ID | Risk | Severity | Likelihood | Owner doc |
|---|---|---|---|---|
| R1 | Browser-cookie D365 auth path violates Microsoft ToS & enterprise security policy; discovery by a customer's IT dept kills the deal and the reputation | Critical | High | SECURITY §4.3 |
| R2 | Single global `bot_config` (webhook URL, cookies) shared across ALL users — cross-tenant data leakage by design | Critical | Certain (at 2nd customer) | SECURITY §5 |
| R3 | Zero automated tests + no CI → any refactor is a gamble | High | Certain | TECH_DEBT §2 |
| R4 | Groq JSON-mode-by-prompt (no schema enforcement) → silent workflow misfires, prompt injection can trigger D365 writes | High | Medium | AI BIBLE §6, SECURITY §6 |
| R5 | In-process `asyncio.create_task` background jobs die on deploy/restart with jobs stuck "running" | High | High | PRODUCTION §4 |
| R6 | Session tokens stored in plaintext in MongoDB | High | Medium | SECURITY §4.1 |
| R7 | Render free tier: cold starts, no SLA, ephemeral disk (loses log files) | Medium | Certain | PRODUCTION §2 |
| R8 | Hard dependency on one model provider (Groq) with no fallback | Medium | Medium | AI BIBLE §8 |
| R9 | Lenovo-specific assumptions baked in (column aliases, subtype) block second customer | Medium | High | PRODUCT §2 |
| R10 | `slowapi` rate limits keyed on spoofable `X-Forwarded-For` | Medium | Medium | SECURITY §7 |

---

## 8. Engineering Principles (adopted going forward)

1. **Tenant isolation is non-negotiable.** Every query carries `org_id`. No global config documents.
2. **The AI proposes; deterministic code disposes.** LLM output is a *proposal* validated by schema + business rules before any side effect (D365 write, email send).
3. **Fail loudly at startup, gracefully at runtime.** (Already partially practiced: `SECRET_KEY` and `CORS_ORIGINS` fail-hard are good patterns — extend them.)
4. **No silent fallbacks for security controls.** `payload_crypto`'s "plaintext mode when key unset" is acceptable for dev only and must be refused in prod.
5. **Every background job is resumable.** Jobs live in a queue with leases, not in process memory.
6. **Prompts are versioned artifacts** with eval suites, not text files edited ad hoc.
7. **Docs and ADRs updated in the same PR as the change.**

## 9. Coding Standards (current + target)

- **Python**: black + isort + flake8 (already in requirements; not enforced — add CI gate). Type hints required on all new code; adopt mypy strict for new modules. Pydantic v2 models for all request/response bodies (mostly followed).
- **JS/React**: currently plain JS — migrate new code to TypeScript. No `axios` + `fetch` mix (both are present; standardize on the `lib/api.js` fetch wrapper).
- **API convention**: the codebase has TWO response shapes — bare objects (older routes) and `{success, data, error}` envelopes (newer routes). Standardize on the envelope; see TECH_DEBT TD-07.
- **Naming**: MongoDB collections snake_case plural (followed). Route files by domain after monolith split: `routes/auth.py`, `routes/chat.py`, etc.

---

## 10. Future Vision (18 months)

From "D365 activity logger" to **the memory layer for enterprise sales teams**: every call, meeting, email, and sheet a rep touches is captured, summarized, structured, and written to CRM automatically — and the accumulated interaction graph powers manager dashboards, deal-risk signals, and an agent that drafts follow-ups and proposals. Multi-CRM (Salesforce, HubSpot) follows the D365 wedge. Full narrative: PRODUCT_AND_FEATURE_BIBLE §1.

## 11. Execution Strategy

Work is executed by Claude Code (Opus) against **CLAUDE_CODE_EXECUTION_BIBLE.md**, which decomposes Phases 0–3 into atomic tasks with acceptance criteria, test plans, and rollback instructions. Humans review PRs; no task merges without its listed tests passing in CI. Order of execution follows §6 above; security P0s (SEC-01…SEC-07) are exempt from feature-freeze rules and always jump the queue.
