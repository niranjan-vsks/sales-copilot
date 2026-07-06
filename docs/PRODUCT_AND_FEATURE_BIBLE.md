# PRODUCT & FEATURE BIBLE

> What Sales Copilot is, what it does today, and the full product roadmap with PRDs for the company it should become.
> Companions: AI BIBLE (how the intelligence works), STARTUP_READINESS (go-to-market gaps), EXECUTION (build tasks).

---

## 1. Product Thesis

**Problem**: CRM data quality dies at the point of entry. Sales reps are measured on selling, not on logging; entering activities into Dynamics 365 is slow, clunky, and feels like unpaid admin work. So reps don't log — or log late and thin — and every downstream system (forecasting, manager visibility, deal-risk analysis, marketing attribution) inherits garbage data.

**Insight**: the winning move is not "a better CRM form." It's **removing the human from data entry** by meeting reps where they already are (chat, pasted notes, spreadsheets, calendars) and turning their natural artifacts into structured CRM records automatically.

**Wedge**: frictionless D365 activity capture via four surfaces (chat, activity sheets, batch rules, quick-log), including a Power Automate path that works even when IT won't grant OAuth consent.

**Durable asset (the moat)**: as reps log through Sales Copilot, the product accumulates a structured, summarized **interaction memory** (`activity_sheet_log`, `workflow_executions`, `app_knowledge_base`). That memory — not the logging UI — is the long-term defensibility: it powers retrieval, manager insight, deal-risk signals, and a proactive agent no standalone CRM add-on can match.

**One-liner**: *Sales Copilot is the memory and capture layer for enterprise sales teams — it turns every meeting, note, and spreadsheet into clean CRM data, then turns that data into intelligence.*

---

## 2. Current Product Audit

### What works (shipped)
| Feature | Value | Notes / limits |
|---|---|---|
| AI Chat logging | Log activities in natural language | 8B model, no confirm step, no schema enforcement (AI BIBLE §2) |
| Activity Sheets (paste/upload) | Bulk-log messy tables; AI-summarizes notes; dedup by serial | The strongest feature; Lenovo-specific aliases hardcoded (TD-05) |
| Batch Rules | Reusable templates across an account list | Solid; overlaps conceptually with sheets |
| Quick-log (Dashboard) | One-off manual entry + stats | Baseline |
| D365 fallback chain | Works without IT OAuth consent | Tier 3 (browser cookies) is a liability (SEC-09) |
| Activities timeline | Merges live D365 + local fallback | Good resilience pattern |
| Account lists / File mgmt | Per-user account data + fuzzy match | Legacy global `accounts` still lingers (TD-10) |
| Auth (email+OTP, MS OAuth) | Both self-serve and SSO | Sound model; token storage gaps (SEC-01/08) |
| Admin (team, connections, monitoring) | Basic operator controls | Single-tenant assumptions throughout |
| Telegram notifications | Execution alerts | Nice-to-have |

### What's stubbed / missing
- Workflow tiles (`sync_emails`, `search_leads`, `update_calendar`, `process_files`, `send_alert`) return `coming_soon` (EDR-14) — roadmap shown as product.
- No billing, no onboarding flow, no multi-tenancy, no reporting/analytics for managers, no mobile.
- No integrations beyond D365/Microsoft (no Salesforce/HubSpot, no Slack, no Gong/Zoom).

### Positioning today
A single-team (Lenovo-origin) D365 activity logger with an unusually good bulk-sheet importer and a pragmatic IT-bypass connection story. The product is one structural change (multi-tenancy) and one narrative shift (capture → memory) away from being a company.

---

## 3. The Moat: Interaction Memory

Today `activity_sheet_log` + `workflow_executions` + `app_knowledge_base` already capture *what happened with whom, when, and a clean summary*. Three moves turn this exhaust into the core asset:
1. **Scope & retain** it per org (currently global/shallow — AI BIBLE §4).
2. **Make it retrievable** (semantic + structured search): "when did we last talk to Acme and about what?"
3. **Make it generative**: draft follow-ups, brief reps before meetings, flag deals going quiet.

Every roadmap feature below either feeds this memory or spends it.

---

## 4. PRD — Meeting & Voice Intelligence (feeds memory)
**Problem**: the richest interaction data (what was actually said in a meeting) never reaches the CRM.
**Solution**: calendar-aware capture. Detect meetings via Microsoft Graph; ingest transcripts (Teams/Zoom) or a recorder; auto-summarize into a CRM activity with attendees, topics, next steps, and sentiment; propose the D365 write for one-click confirm.
**Scope v1**: Graph calendar detection → "log this meeting?" with a draft summary from the invite + attendees; manual transcript paste → structured summary.
**Success**: % of calendar meetings that become logged activities; rep edits per proposal (proxy for quality).
**Depends on**: confirmation UX (AI BIBLE §6.3), memory store (§3), org scoping.

## 5. PRD — Proactive Capture Agent (spends + feeds memory)
**Problem**: even one-click logging requires the rep to initiate.
**Solution**: an agent that watches signals (calendar end, email sent/received, sheet uploaded) and proactively proposes logs and follow-ups. Inverts pull → push.
**Scope v1**: post-meeting nudge with pre-drafted summary; end-of-day "here are 5 activities we detected, confirm all."
**Success**: activities captured with zero rep-initiated actions; DAU driven by proactive nudges.
**Depends on**: tool-calling agent (AI BIBLE §8), durable jobs (TD-03), Graph scopes.

## 6. PRD — Email Copilot (feeds memory, draft-only)
**Problem**: email is where deals actually move; none of it is structured in CRM.
**Solution**: Graph mail integration → auto-log key emails as activities; draft follow-ups grounded in interaction memory. Human always sends (propose-don't-dispose, SEC-16).
**Scope v1**: log outbound/inbound emails tied to an account; "draft a follow-up" using recent interaction context.
**Success**: emails logged/week; drafts used vs discarded.

## 7. PRD — Manager Intelligence Dashboard (spends memory)
**Problem**: managers have no trustworthy activity data, so no real visibility.
**Solution**: because capture is now frictionless, the data is finally good enough to power dashboards: activity coverage per rep/account, deals going quiet (no interaction in N days), engagement trends, coaching signals.
**Scope v1**: activity coverage + "quiet deals" alert, per team, org-scoped.
**Success**: manager WAU; actions taken from alerts.
**Depends on**: `org_id`, a reporting read-model (EDR-02), roles beyond admin/user.

## 8. PRD — Multi-CRM (expands TAM beyond the wedge)
**Problem**: the D365 wedge caps the market to Dynamics shops.
**Solution**: abstract the write layer (already partially forced by the fallback chain) behind a `CRMProvider` interface; add Salesforce then HubSpot.
**Scope v1**: `CRMProvider` interface extracted from `d365_write` service (TD-06); Salesforce activity write.
**Success**: first non-D365 customer live.

## 9. PRD — Onboarding & Connection Wizard (unlocks self-serve)
**Problem**: connecting D365 today is admin-driven and fragile (three tiers, global config).
**Solution**: a guided per-org wizard: choose OAuth (with admin-consent deep link) or Power Automate (with a generated flow template); test connection; upload first account list; log first activity. Replaces the need for tier-3 cookie replay (EDR-03).
**Success**: time-to-first-logged-activity; self-serve activation rate.
**Depends on**: org scoping, per-org connections (SEC-12).

---

## 10. Feature Prioritization (RICE-style, directional)

| Feature | Reach | Impact | Confidence | Effort | Priority |
|---|---|---|---|---|---|
| Multi-tenancy + connection wizard (§9) | All | Very High | High | High | **P0 (enabling)** |
| Confirmation UX + AI hardening (AI §6) | All | High | High | Low | **P0** |
| Meeting intelligence v1 (§4) | High | Very High | Med | High | P1 |
| Manager dashboard v1 (§7) | Med (buyers!) | Very High | Med | Med | P1 |
| Proactive agent v1 (§5) | High | High | Med | High | P2 |
| Email copilot v1 (§6) | High | High | Med | High | P2 |
| Multi-CRM / Salesforce (§8) | New TAM | High | Low | High | P2 |

**Sequencing logic**: nothing multi-tenant ships until §9's enabling work lands. Then chase the *buyer* (manager dashboard) in parallel with the *retention* feature (meeting intelligence), because managers sign checks and reps drive daily usage.

---

## 11. Metrics Framework

**North Star**: *activities auto-captured per active rep per week* (measures the core value: friction removed).
**Input metrics**: time-to-first-activity, % meetings logged, AI-proposal acceptance rate, sheet rows processed.
**Business metrics**: WAU/MAU (reps + managers), activation, retention cohorts, net revenue retention.
**Quality metrics**: rep edits per AI proposal, D365 write success rate across fallback tiers, parse-failure rate.

---

## 12. 18-Month Product Vision

Quarter-by-quarter theme:
- **Q1**: multi-tenant foundation + connection wizard + AI hardening + confirmation UX (turn the beta into a product multiple orgs can safely use).
- **Q2**: meeting intelligence + manager dashboard (capture the buyer and the retention loop).
- **Q3**: proactive agent + email copilot (push model; interaction memory becomes generative).
- **Q4**: multi-CRM (Salesforce) + reporting depth (break past the D365 TAM ceiling).

End state: not a "D365 logger" but the **capture-and-memory layer** every sales org runs on top of whatever CRM they already own.
