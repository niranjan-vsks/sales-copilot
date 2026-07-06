# STARTUP READINESS BIBLE

> Gap analysis: what stands between "working single-team beta" and (a) a public launch, (b) a YC-grade fundable startup, (c) surviving an enterprise procurement review.
> Each gap maps to Security/Debt/Product docs and to EXECUTION tasks. Statuses: **Blocked** (must fix), **Weak** (works but fails scrutiny), **OK**.

---

## 1. Readiness Scorecard

| Dimension | Status | Blocking issue |
|---|---|---|
| Product core (capture works end-to-end) | **OK** | — |
| Multi-tenancy | **Blocked** | Global `bot_config`, no `org_id` (SEC-12) |
| Security posture | **Blocked** | Cookie-replay auth path (SEC-09), plaintext tokens (SEC-01/08) |
| Legal/ToS exposure | **Blocked** | Tier-3 browser automation vs Microsoft ToS |
| Testing/CI | **Blocked** | Zero tests (TD-02) |
| Billing/monetization | **Blocked** | None exists |
| Reliability/ops | **Weak** | Free tier, in-process jobs, no monitoring (R5/R7) |
| Onboarding | **Weak** | Admin-driven connection setup; no self-serve path |
| Privacy/compliance | **Weak** | No policy, DPA, subprocessor list, delete/export (SEC-26/27) |
| Team/roles | **Weak** | admin/user only; no org concept |
| Analytics/metrics | **Weak** | No product analytics; monitoring is ops-only |
| Docs/support | **Weak** | No user docs, no support channel |

---

## 2. Launch Readiness (public/self-serve beta)

**Must-do before anyone outside the founding team's orbit signs up:**
1. **Tenant isolation** — `org_id` everywhere + per-org connections (SEC-12; EXECUTION TASK-011/012). Non-negotiable: today a second org would share the first org's CRM connection.
2. **Kill tier-3 by default** — cookie-replay path disabled in prod config (SEC-09).
3. **Session/CSRF hardening** — hashed tokens, cookie flags, CSRF (SEC-01/03/07).
4. **Deterministic admin seeding** — no first-signup-wins (SEC-05).
5. **AI write-guard** — schema validation + business-rule gate + confirm UX before D365 writes from chat (SEC-16/17).
6. **Test harness + CI** — the safety net for all of the above (TD-02).
7. **Job durability minimum** — startup reaper for stuck jobs; queue can follow (TD-03 interim).
8. **Paid hosting tier** — cold starts and ephemeral logs are not launchable (R7).
9. **Basics of trust**: privacy policy, terms, subprocessor list (Groq disclosure!), support email.

Anything not on this list (TS migration, multi-CRM, dashboards) is explicitly *not* a launch blocker.

---

## 3. Fundability Readiness (YC-grade narrative)

**What's strong already:**
- Real, painful, universally-acknowledged problem (CRM data entry) with a clear wedge.
- Working product with a genuinely clever distribution insight: the Power Automate path sells into orgs whose IT would never approve a new OAuth app — that's a go-to-market moat disguised as a hack.
- Early moat thesis (interaction memory) that compounds with usage (PRODUCT §3).
- Evidence of real-world grounding (built inside an actual enterprise sales team's workflow — the Lenovo specificity is *proof of intimacy with the user*, even though it's also debt).

**What's missing for the narrative:**
| Gap | Fix |
|---|---|
| No usage metrics at all | Instrument the North Star (activities auto-captured/rep/week) + activation funnel now — investors will ask for the graph, and it needs history |
| Single-customer shape | Land 2–3 design partners on the multi-tenant build; de-Lenovo the config (TD-05) |
| No pricing | Per-seat SaaS with an org minimum; manager dashboard is the plan-tier lever (PRODUCT §7) |
| "Is this a feature of Copilot for Sales?" objection | Answer: Microsoft's own tooling requires the IT buy-in this product routes around; and the memory layer is CRM-agnostic (§8 multi-CRM). Write this positioning down and rehearse it |
| Founder/verbal story ≠ repo story | These docs are the bridge; keep them current |

---

## 4. Enterprise Procurement Readiness

What a security questionnaire / vendor review will probe, and today's honest answer:

| Question | Today | Required |
|---|---|---|
| "Do you store credentials to our CRM?" | Yes — incl. session cookies, plaintext tokens, in a shared document | Per-org encrypted credential records, KMS-wrapped, documented rotation |
| "Does your product automate user browser sessions?" | Yes (tier 3) | **No.** Remove/gate it. This single answer can end a deal |
| "Sub-processors?" | Undocumented (Groq, Atlas, Render, SMTP, Telegram, Microsoft) | Published list + DPAs |
| "Data deletion/export?" | Not implemented | SEC-26 endpoints + retention policy |
| "Tenant isolation?" | None | `org_id` + isolation test suite |
| "SOC 2?" | No | Type II when first enterprise deal demands; start evidence collection early (access reviews, change mgmt = the CI/PR discipline from TD-02) |
| "SSO/SCIM?" | Microsoft OAuth exists; no SCIM | OAuth suffices early; SCIM at enterprise tier |
| "Audit logs?" | `workflow_executions` is close | Formalize immutable, tenant-scoped, exportable audit trail |
| "Uptime SLA / status page?" | None | Paid infra + monitoring + status page (PRODUCTION §5) |

**Strategic note**: the enterprise buyer is also the persona most likely to *appreciate* the Power Automate path (tier 2) — it uses their own sanctioned automation tooling. Lead with tier 2 in security conversations; never volunteer that tier 3 ever existed.

---

## 5. Monetization Plan (currently: nothing)

- **Model**: per-seat monthly, org-level billing. Rep seat (capture) cheaper than manager seat (dashboard). Free trial per org, not per user.
- **Build**: Stripe (checkout + customer portal + webhooks), `org_id`-keyed subscription state, seat enforcement middleware. ~2 tasks in EXECUTION (TASK-021/022) once multi-tenancy lands. Do not build billing before `org_id` — it would all be rework.
- **Pricing posture for design partners**: paid pilots (even small) — free pilots produce no procurement signal and no urgency.

---

## 6. Operational Readiness

- **Support**: a shared inbox + in-app "report issue" is enough at this stage; log it into the knowledge base event stream.
- **Incident response**: a one-page runbook (who restarts what, how to rotate which secret, how to disable AI or a connection tier per org via config) — write it when the runbook's subjects exist (PRODUCTION §5).
- **Analytics**: PostHog (or similar) wired to the North Star + funnel events; ship with the multi-tenant release so cohorts are clean from day one.
- **Docs**: three user docs cover 90% of need: "Connect your D365," "Activity sheet format guide," "What the AI can and can't do."

---

## 7. The Critical Path, Restated

```
Tests+CI ──▶ Security P0s ──▶ org_id multi-tenancy ──▶ per-org connections/wizard
                                        │
                                        ├──▶ Billing (Stripe)
                                        ├──▶ Design partners (2–3 paid pilots)
                                        └──▶ Metrics instrumentation
                                                    │
                                                    ▼
                                        Launch narrative + fundraise
```

Every item above is decomposed with acceptance criteria in CLAUDE_CODE_EXECUTION_BIBLE. The single most expensive thing this company can do is delay `org_id` — all revenue, all partners, and all compliance work stack on top of it.
