# Production & Scaling Bible

> How Sales Copilot runs in production today, how it will break under load, and the concrete path from "works on Railway" to a scalable, observable, multi-instance system.
>
> Companion documents: [ARCHITECTURE_BIBLE.md](./ARCHITECTURE_BIBLE.md), [ENTERPRISE_SECURITY_BIBLE.md](./ENTERPRISE_SECURITY_BIBLE.md), [TECHNICAL_DEBT_AND_REFACTORING_BIBLE.md](./TECHNICAL_DEBT_AND_REFACTORING_BIBLE.md)

---

## 1. Current Production Topology

```
                ┌─────────────────────────────┐
                │   Railway / Render          │
                │                             │
   Browser ────▶│  Frontend service           │
                │  (CRA static build served   │
                │   by `serve` / static host) │
                │                             │
                │  Backend service            │
   /api/* ─────▶│  uvicorn server:app         │
                │  (single process)           │
                └──────────┬──────────────────┘
                           │
          ┌────────────────┼───────────────────────────┐
          ▼                ▼                           ▼
   MongoDB Atlas    Anthropic API              Microsoft Graph /
   (MONGO_URL)      (ANTHROPIC_API_KEY)        Dynamics 365 Web API
                           │
                           ▼
                    n8n webhook (optional)
```

Key properties of the current deployment:

| Property | Current state |
|---|---|
| Backend processes | 1 uvicorn process, no workers flag |
| Horizontal scaling | Not safe (see §3) |
| Database | MongoDB via Motor (async), single `AsyncIOMotorClient` |
| Static assets | CRA build output |
| TLS | Terminated by platform (Railway/Render) |
| Background work | `asyncio.create_task` inside the API process |
| Scheduled work | None (reminders are computed on-read) |
| Observability | `log_config.py` structured-ish logging to stdout only |

---

## 2. What Works Today

- **Async I/O end to end.** FastAPI + Motor + httpx means the single process can multiplex many concurrent requests; the architecture is not thread-starved.
- **Stateless-ish API.** Session tokens are stored in MongoDB, not in process memory, so a restart does not log everyone out.
- **Platform-managed TLS and deploys.** Railway/Render handle certificates, build, restart-on-crash.
- **Health endpoint.** `GET /api/` can be used as a liveness probe.

---

## 3. Single-Instance Assumptions (Blockers to Horizontal Scaling)

These are the things that will break the moment a second backend instance is started. Fix all of them before setting replicas > 1.

### 3.1 In-memory OAuth state
`microsoft_auth.py` keeps pending OAuth flows in a module-level dict. With two instances, the callback can land on the instance that never issued the state → login fails ~50% of the time.
**Fix:** persist OAuth state in MongoDB with a TTL index, or encode it in a signed cookie.

### 3.2 In-memory rate limiting
Signup/login rate limiting uses per-process dicts. Two instances → double the allowed request rate, and limits reset on every deploy.
**Fix:** move counters to MongoDB with TTL, or introduce Redis (Upstash) for atomic `INCR` + `EXPIRE`.

### 3.3 Background tasks tied to the request process
Excel/activity-sheet processing runs via `asyncio.create_task` in the API process. If the instance is redeployed mid-processing, the job silently dies and the upload record is stuck in `processing`.
**Fix (incremental):** on startup, sweep for `status: "processing"` records older than N minutes and mark them `failed`. **Fix (proper):** move to a queue/worker model (see §6).

### 3.4 Playwright browser automation in-process
`d365_browser.py` launches Chromium inside the API container. This consumes hundreds of MB per launch, competes with API traffic for CPU, and does not exist on all base images.
**Fix:** isolate into its own service or remove (Playwright flows are largely superseded by the D365 Web API client).

---

## 4. Capacity Model

Rough envelope for the current single instance (assume 512MB–1GB RAM, shared CPU):

| Workload | Bottleneck | Estimated ceiling |
|---|---|---|
| Auth/CRUD API calls | MongoDB round-trips | ~200–500 req/s (fine for any realistic sales-team size) |
| AI chat requests | Anthropic API latency (2–20s per call) + no streaming | ~50 concurrent chats before UX degrades |
| Excel uploads | CPU (openpyxl parse) + Claude calls per row batch | A few concurrent uploads |
| Playwright flows | RAM | 1–2 concurrent, then OOM risk |

Interpretation: **the product will not fall over from user count** at startup scale (tens to low hundreds of sellers). The real risks are (a) long AI calls holding connections without streaming, (b) memory spikes from Playwright/openpyxl, and (c) redeploys killing in-flight background jobs.

---

## 5. MongoDB Production Checklist

The application currently creates **no indexes**. Every `find` on `user_id` is a collection scan. Required indexes:

```js
db.users.createIndex({ email: 1 }, { unique: true })
db.sessions.createIndex({ session_token: 1 }, { unique: true })
db.sessions.createIndex({ expires_at: 1 }, { expireAfterSeconds: 0 })  // TTL: auto-delete expired sessions
db.tasks.createIndex({ user_id: 1, status: 1 })
db.meetings.createIndex({ user_id: 1, start_time: 1 })
db.chat_messages.createIndex({ user_id: 1, session_id: 1, timestamp: 1 })
db.knowledge_base.createIndex({ user_id: 1 })
db.activity_uploads.createIndex({ user_id: 1, uploaded_at: -1 })
db.email_verifications.createIndex({ expires_at: 1 }, { expireAfterSeconds: 0 })
db.password_resets.createIndex({ expires_at: 1 }, { expireAfterSeconds: 0 })
```

Also:
- **Connection string:** ensure `retryWrites=true` and a sane `maxPoolSize` (Motor default 100 is fine for one instance; lower it if memory-constrained).
- **Backups:** Atlas continuous backup or at minimum daily snapshots. There is currently no documented backup/restore procedure.
- **Chat history growth:** `chat_messages` grows unbounded. Add a retention policy (e.g., cap per-session history or TTL old sessions) before it becomes the largest collection.

---

## 6. Target Architecture (Scale-Ready)

```
   Browser ──▶ CDN/static host (frontend build)
                    │  /api/*
                    ▼
              Load balancer
              ┌─────┴─────┐
              ▼           ▼
         API pod 1    API pod 2      (stateless: no in-memory auth state,
              │           │           no in-process background jobs)
              └─────┬─────┘
                    ▼
        ┌───────────┼──────────────┐
        ▼           ▼              ▼
     MongoDB     Redis          Job queue ──▶ Worker pod(s)
     (indexed)   (rate limits,  (Excel processing,
                  OAuth state,    D365 sync, email send)
                  cache)
```

Migration order (each step is independently shippable):
1. Add MongoDB indexes + session TTL (no code risk).
2. Move OAuth state and rate limits out of process memory.
3. Add a startup sweep for orphaned `processing` uploads.
4. Extract Excel/AI batch processing behind a queue (even a Mongo-backed poll loop is acceptable at this scale).
5. Remove or isolate Playwright.
6. Enable `uvicorn --workers N`, then platform replicas.

---

## 7. Observability

Current state: stdout logs only, no metrics, no tracing, no error aggregation.

Minimum viable observability stack:

| Concern | Recommendation |
|---|---|
| Error tracking | Sentry (FastAPI + React SDKs). Highest value-per-hour of anything in this document. |
| Request logging | Keep `log_config.py`, add request ID middleware so one user action can be traced across log lines. |
| AI call telemetry | Log per-call: model, latency, input/output token counts, user_id hash. Anthropic costs are the #1 variable cost — this is also your billing meter. |
| Uptime | External ping on `GET /api/` every minute. |
| Alerting | Alert on: error rate spike, p95 latency > 5s on non-AI endpoints, Anthropic 429/5xx streak, Mongo connection failures. |

---

## 8. Deploy & Release Practices

- **Environments:** currently prod-only. Add a staging environment pointing at a separate Mongo database and a sandbox D365 org before making risky changes.
- **Migrations:** there is no migration tooling; schema changes are implicit (Mongo). Adopt the convention: any code that reads a new field must tolerate its absence (this is already mostly true) and any index change goes into a versioned `scripts/` file.
- **Secrets:** all via platform env vars — good. Rotate `ANTHROPIC_API_KEY` and SMTP credentials on any team member departure since there is no per-key scoping.
- **Rollbacks:** platform-level (redeploy previous image). Safe because there are no coupled DB migrations — keep it that way.
- **Zero-downtime concern:** in-flight AI chat requests (up to ~60s) are killed on redeploy. Acceptable now; a graceful-drain window is the fix later.

---

## 9. Cost Model

| Line item | Driver | Control lever |
|---|---|---|
| Anthropic API | Chat messages × context size; Excel rows × batch calls | Trim system prompt + KB injection size; cache KB summaries; cap chat history window (already capped at recent messages) |
| MongoDB Atlas | Storage growth (chat_messages dominates) | Retention policy |
| Railway/Render | Instance size (RAM driven by Playwright/openpyxl spikes) | Remove Playwright → can downsize |
| SMTP | Negligible | — |

The AI spend is effectively unmetered per user today. Before any pricing/packaging decision, add per-user token accounting (log-based is fine) so unit economics are measurable.

---

## 10. Production Readiness Scorecard

| Area | Grade | Blocking issue |
|---|---|---|
| Availability (single instance) | B− | Redeploys kill background jobs |
| Horizontal scalability | F | §3 items |
| Data durability | C | No documented backups, no indexes |
| Observability | D | No error tracking or metrics |
| Security hardening | C− | See ENTERPRISE_SECURITY_BIBLE.md |
| Cost control | C | No AI usage metering |

**Bottom line:** the system is adequate for a pilot with a friendly customer. Before a paid, SLA-bearing deployment: add indexes, Sentry, backups, and the §3 fixes — roughly a focused week of work.
