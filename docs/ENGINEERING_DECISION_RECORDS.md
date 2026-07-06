# ENGINEERING DECISION RECORDS (ADRs)

> Why Sales Copilot is the way it is. Each record captures the context, the decision, the consequences, and — crucially — whether to **keep, revisit, or reverse** it.
> Reconstructed from the codebase (the decisions are inferred from the implementation). New decisions append here in the same format.

Status legend: **KEEP** (sound), **REVISIT** (re-evaluate at a milestone), **REVERSE** (actively unwind).

---

## EDR-01 — FastAPI monolith in a single `server.py`
**Status: KEEP the monolith, REVERSE the single file (→ TD-01)**
**Context**: solo/small-team velocity; one deployable is simplest.
**Decision**: all routes, models, jobs, and SPA serving in one FastAPI app in one file.
**Consequences**: fast early, but at ~2,250 lines the file is now a merge-conflict magnet and onboarding wall. The *monolith* is still correct; the *single file* is not. Split into routers/services (TD-01) while staying one deployable.

---

## EDR-02 — MongoDB (Atlas) as primary datastore
**Status: KEEP (REVISIT at reporting-heavy scale)**
**Context**: activity sheets, executions, and account rows have variable, evolving shapes; schema flexibility accelerated iteration.
**Decision**: MongoDB with Motor async driver; UUID string keys; `{_id:0}` projections.
**Consequences**: excellent fit for ingest and per-user documents. Weaknesses appear for cross-tenant analytics and relational reporting (manager dashboards). Revisit only when reporting needs outgrow aggregation pipelines; a Postgres read-model fed from Mongo is the likely answer, not a wholesale migration.

---

## EDR-03 — Three-tier D365 connection fallback (OAuth → Power Automate → browser cookies)
**Status: KEEP tiers 1–2, REVERSE tier 3 (→ SEC-09)**
**Context**: enterprise tenant admins refuse OAuth consent; the product needed to work without IT cooperation.
**Decision**: try OAuth, then a Power Automate webhook, then replay saved browser cookies in headless Chromium to extract a token.
**Consequences**: tiers 1–2 are legitimate and valuable — the Power Automate path is a real differentiator for IT-averse orgs. Tier 3 (cookie replay) is a Terms-of-Service and security liability that will kill enterprise deals on discovery (Risk R1). Reverse tier 3: disable by default, invest in frictionless OAuth admin-consent onboarding so it's never needed.

---

## EDR-04 — Global `bot_config` document for connection state
**Status: REVERSE (→ SEC-12 / TD-04)**
**Context**: single-team beta; "there is only one connection" was true at the time.
**Decision**: one document `_id:"config"` holds D365 URL, webhook, cookies, tokens, toggles.
**Consequences**: hard blocker to a second customer — shared connection = cross-tenant data exposure by design. Must become a per-org `connections` collection with `org_id`. This is the highest-leverage reversal in the codebase.

---

## EDR-05 — LLM emits an action envelope; deterministic code executes it
**Status: KEEP (STRENGTHEN → SEC-16/17)**
**Context**: needed natural-language logging without letting a model directly mutate a CRM.
**Decision**: chat model returns `{action, parameters, response}`; server dispatches to existing write paths.
**Consequences**: the right safety architecture ("propose, don't dispose"). Under-enforced today (JSON by convention, no schema, no business-rule gate). Keep the pattern; add structured-output validation and pre-write business rules.

---

## EDR-06 — Groq `llama-3.1-8b-instant` as the model
**Status: REVISIT (→ AI BIBLE §8)**
**Context**: speed and cost for a chat/parse loop.
**Decision**: single small, fast model for both chat parsing and notes summarization.
**Consequences**: great latency/cost; weak exactly where it's used most (date/entity extraction). Revisit with an eval suite: provider abstraction + per-task model choice; keep 8B where evals justify it.

---

## EDR-07 — Live app-state injected into the chat system prompt (`knowledge_base`)
**Status: KEEP (INVEST → AI BIBLE §4)**
**Context**: the model needs to know real connection/account state to be useful and honest.
**Decision**: compose a live context snapshot and prepend it to every chat prompt.
**Consequences**: genuine differentiator and the seed of the long-term memory moat. Deepen it from counts/status to actual interaction retrieval; scope it per org.

---

## EDR-08 — In-process background jobs via `asyncio.create_task`
**Status: REVERSE (→ TD-03)**
**Context**: simplest way to make sheet/batch execution non-blocking without infra.
**Decision**: fire-and-forget async tasks writing progress to Mongo.
**Consequences**: jobs die on deploy/restart and get stuck "running"; partial CRM writes; no resume. Move to a durable queue (arq/Redis) with idempotent, leased, resumable jobs.

---

## EDR-09 — Frontend field-level AES-GCM encryption (`lib/crypto.js` / `payload_crypto.py`)
**Status: KEEP (HARDEN → SEC-11)**
**Context**: extra protection for secrets (passwords, cookies, webhook URLs) beyond TLS, e.g. against logging middleboxes.
**Decision**: encrypt designated fields client-side, decrypt server-side; **plaintext fallback when key unset**.
**Consequences**: reasonable defense-in-depth, but the silent plaintext fallback is a security downgrade footgun. Keep the mechanism; in prod, refuse to run without the key. Never present it as a substitute for TLS or for at-rest encryption of stored tokens.

---

## EDR-10 — React CRA + craco + HashRouter, plain JavaScript
**Status: REVISIT (→ TD-09/13)**
**Context**: fast SPA bootstrap; HashRouter avoids static-host deep-link 404s.
**Decision**: CRA/craco, Tailwind + shadcn/Radix, HashRouter, JS (no TS).
**Consequences**: CRA is effectively unmaintained; HashRouter is redundant given the backend catch-all. Revisit: migrate to Vite, adopt TypeScript for new code, switch to BrowserRouter. Not urgent, but compounding.

---

## EDR-11 — Email+password (bcrypt) + Microsoft OAuth, custom session tokens
**Status: KEEP the model, REVERSE plaintext token storage (→ SEC-01)**
**Context**: needed both self-serve email accounts and enterprise Microsoft SSO.
**Decision**: bcrypt passwords, OTP signup, MSAL OAuth, opaque random session tokens stored in Mongo.
**Consequences**: sound auth model. The one defect: session tokens stored in plaintext (hash them). Also add deterministic admin seeding instead of first-user-wins.

---

## EDR-12 — Deterministic parsing/matching layer (no LLM for structure)
**Status: KEEP (→ AI BIBLE §5)**
**Context**: sheet/column/date/account parsing must be reliable and cheap.
**Decision**: hand-written delimiter detection, ~40 column aliases, fuzzy datetime, Jaccard account matching; LLM only for prose summarization.
**Consequences**: correct instinct — reliability and cost. The only debt is that customer-specific aliases are hardcoded (TD-05); make them per-org config, keep the deterministic approach.

---

## EDR-13 — Render free tier as host (Railway configs also present)
**Status: REVISIT + cleanup (→ TD-12, PRODUCTION §2)**
**Context**: zero-cost deployment for a beta.
**Decision**: `render.yaml` blueprint; leftover Railway `railway.json`/`Procfile`.
**Consequences**: cold starts, no SLA, ephemeral disk (log loss), single worker. Fine for beta; pick one platform (delete the other's config) and move to a paid tier with Redis before onboarding paying customers.

---

## EDR-14 — n8n/workflow surfaces shipped as `coming_soon` stubs
**Status: REVISIT (product honesty)**
**Context**: signal roadmap breadth (email sync, lead search, calendar, alerts).
**Decision**: expose workflow types in the UI that return `coming_soon` via `n8n_client`.
**Consequences**: risks over-promising in demos. Either build them (PRODUCT §4+) or clearly label as roadmap; don't present non-functional tiles as features to prospects.

---

## Template for new ADRs
```
## EDR-NN — <title>
**Status: KEEP | REVISIT | REVERSE**
**Context**: <forces at play>
**Decision**: <what was chosen>
**Consequences**: <trade-offs; what to do next>
```
