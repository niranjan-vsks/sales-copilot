# P6 — Hardening

**Goal:** close the remaining security findings and add the operational layer that keeps the app running like clockwork: retries that survive restarts, health monitoring, failure alerts, and a committed regression suite.

**Recommended model:** Sonnet 5.5 (Opus for the outbox design review if unsure).
**Dependencies:** P5 DONE.
**Branch:** `revamp/p6-hardening`
**Closes:** B13 (signup/OTP limits), B17, B18, B23, B24, D02, D03 (for touched endpoints).

---

## Tasks

### P6.T1 — Admin bootstrap (B17)
Replace the every-boot promotion with: promote only when `authorized_users` has **zero** admins, and only the earliest user by `created_at` across both auth methods; log it once. Test: existing admin present → no promotion.

### P6.T2 — Secrets at rest (B18)
Encrypt `telegram_bot_token` with the Fernet helper on write; decrypt on use; one-off migration at startup encrypts plaintext values (detect by absence of a `_enc` suffix field; store as `telegram_bot_token_enc`, unset the old field). Never return tokens from any GET.

### P6.T3 — Account data scoping (B23, B24)
- `/excel/accounts/import` and `/excel/accounts` become user-scoped (`user_id` on write and read). Existing global `accounts` docs: leave in place but stop reading them for non-admins; `/accounts/search` legacy fallback queries `{"user_id": user.user_id}` only.
- Admin-only for any global write.

### P6.T4 — Auth endpoint limits (B13 remainder)
Rate limits: signup 5/hour/IP, verify-email 10/15min/IP, resend-otp 3/hour/IP. OTP verification: lock a pending verification after 5 wrong attempts (store an `attempts` counter in `pending_verifications`). Tests for each.

### P6.T5 — Durable outbox for CRM writes
- New collection `crm_outbox` (pre-approved): `{_id: execution_id, user_id, request, attempts, next_attempt_at, last_error_code, status: queued|done|dead}`.
- When `crm.service.log_activity` ends `failed` with a **retryable** code (`FLOW_UNREACHABLE`, `CRM_THROTTLED`), enqueue it. A background worker started in `startup.py` (single asyncio task, polls every 30s, `find_one_and_update` claim so two instances never take the same item) retries with backoff 1m, 5m, 30m, 2h (max 4 attempts), reusing the **same idempotency key** so retries cannot duplicate. After the last attempt → `dead` + alert.
- Execution status while queued: `failed` with `error_code` + `retry_scheduled_at`; UI shows "Retrying at HH:MM".

### P6.T6 — Health and alerts
- Every 15 minutes the worker runs `connector.health()` for the configured connection; stores `crm_connections.last_health`.
- On health false twice in a row, or a `dead` outbox item, send an alert to admins who configured Telegram (existing per-user Telegram config) and log at ERROR. De-duplicate alerts (one per hour per cause).
- Connections page: health history (last 10 checks), outbox counts (queued / dead) with a "Retry now" button for dead items (admin only).

### P6.T7 — Structured logging
Request-ID middleware (`X-Request-ID` in/out, generated if absent); every log line includes it; CRM calls log `execution_id`, connector, status code, duration. No PII beyond user_id; never log bodies containing notes at INFO.

### P6.T8 — Committed regression suite
- Move the click-path coverage into a **tracked** folder `e2e/` (Playwright, ESM, same style as `test_scripts/`), using only env-provided credentials (`E2E_EMAIL`, `E2E_PASSWORD`, `BASE_URL`, `API_URL`) — no secrets in files. Cover: login, dashboard log (fake flow), activity sheet, chat log, connections test, profile PATCH, admin pages load.
- `e2e/README.md`: how to run locally against the fake flow and how to run the read-only prod smoke (`npm run smoke`).
- Leave `test_scripts/` untouched (git-ignored, the user's).

### P6.T9 — Response contract for touched endpoints (D03)
Only endpoints modified in this phase move to `{success, data, error}`, with their frontend callers updated in the same commit.

## Gate
Full G1–G7. G6 security review must cover the whole backend once (not only the diff): list every route with its auth dependency in HANDOFF.md.

## Definition of done
- [ ] Tasks ticked; tests green; e2e suite green locally; prod smoke green
- [ ] Simulated outage test: stop the fake flow → writes queue → start it → items confirm without duplicates
- [ ] STATE.md, HANDOFF.md updated; P6 DONE
