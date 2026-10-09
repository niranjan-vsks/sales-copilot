# Execution Doctrine — read fully before touching code

This doctrine binds **every** agent on this revamp: Claude (Opus/Sonnet), Codex/GPT, or any other. It overrides your defaults. When this file and a phase spec disagree, the phase spec wins for scope and this file wins for process.

---

## 0. Start-of-session protocol (every session, including after a context compaction)

1. Read, in order: [README.md](README.md) → this file → [STATE.md](STATE.md) → [HANDOFF.md](HANDOFF.md) → the phase spec you were assigned → [ARCHITECTURE.md](ARCHITECTURE.md) sections it cites → [AUDIT.md](AUDIT.md) IDs it cites.
2. Run `git status`, `git log --oneline -5`, `git branch --show-current`. Compare with STATE.md. If they disagree, **STATE.md is wrong or another agent is mid-flight** — stop and reconcile before writing code (see §7).
3. Confirm the user's go-word for your phase: the user must have said **`BULLSEYE P<n>`** (or the kickoff prompt contains it). No go-word → read and plan only.
4. Check the phase's **Dependencies** line. If a dependency phase is not `DONE` in STATE.md, stop and tell the user.
5. Set your phase to `IN PROGRESS` in STATE.md with your agent name and branch, commit that one-line change (`chore(state): P<n> started`), then begin.

## 1. Scope discipline (the user's hardest rule)

- **Touch only the files listed in your phase spec's "Files" table.** Anything else: stop, write the reason in HANDOFF.md under "Scope requests", and ask the user.
- Working code is sacred. No drive-by refactors, renames, formatting sweeps or docstring additions outside the spec.
- Never change a MongoDB collection name, an existing field's meaning, or an existing API route path unless the spec says so explicitly.
- Never add a dependency that is not in the spec's "Dependencies" list (those lists are pre-approved by the user).
- Design system is fixed: bg `#0f0f10`, card `#141416`, text `#F2F3F5`, muted `#9CA3AF`, border `#1f2022`, accent `#FF4500`, success `#22c55e`, error `#ef4444`, amber `#f59e0b`; Space Grotesk headings, Fira Sans body; **no emojis** (lucide-react icons only); no `transition: all`; UI primitives from `frontend/src/components/ui/`.
- New API endpoints return `{ "success": bool, "data": {...}, "error": null | {"code": str, "message": str} }`.

## 2. Safety rules (non-negotiable)

1. **The repo is public.** Never commit: org URLs, flow URLs, secrets, tenant field names, customer data, real emails other than placeholders. Tenant specifics live in `docs/revamp/private/` (git-ignored) and in Mongo config. Before every commit run `git diff --cached` and check.
2. **Never write to the live D365 tenant** unless the user typed, in this session, explicit approval for a named canary (e.g. "approve canary P2"). Canary records use subject prefix `[LOOP-CANARY]` and are reported to the user so they can delete them. All other verification uses the fake flow (`tests/fakes/fake_flow.py`) or `dry_run`.
3. **Never point local runs at the production database.** Local backend runs use `DB_NAME=sales_copilot_dev` (see P0). If you cannot confirm the DB name, do not start the server.
4. Never print secrets in logs, test output, commits or chat. Never decrypt stored tokens except in code paths the spec defines.
5. Never force-push `main`. Never rewrite published history. Never delete branches you did not create.
6. Never bypass a customer's security controls (consent policies, DLP, MFA). In-tenant execution under the user's own identity via Microsoft-provided connectors is the sanctioned path.

## 3. Build loop per task

For each task in the phase spec, in order:
1. Re-read the task's acceptance criteria.
2. Write/adjust the test first when the task is testable at unit/integration level.
3. Implement the minimum change.
4. Run the fast gate (§4 G1–G2). Fix until green.
5. Tick the task in STATE.md (`[x] P<n>.T<k>`), commit with message `feat(p<n>): T<k> <summary>` or `fix(p<n>): ...`. Small commits; one task per commit where possible.

## 4. The Audit Gate — must be fully green before a phase is DONE

Run in this order. Record every command and its result summary in HANDOFF.md under "Gate results". A red item blocks the phase.

**G1 — Static**
- Backend: `python -m compileall -q backend` and `python -m flake8 backend --select=E9,F63,F7,F82` (syntax/undefined names only).
- Frontend (if touched): `cd frontend && npm run build` succeeds with no **new** warnings vs. baseline.

**G2 — Automated tests**
- `python -m pytest tests -q` → 0 failures, 0 errors. New code in the phase has tests as listed in the spec.

**G3 — Integration wiring audit** (manual reasoning + grep, written up)
For every endpoint the phase touched, write one line each in HANDOFF.md:
`<METHOD> <path> — frontend caller: <file:function> — request shape matches: yes/no — response shape consumed correctly: yes/no — DB collections read/written: <list> — indexes present: yes/no`.
Also grep for every old symbol you renamed/removed and confirm zero dangling references.

**G4 — Local click-path E2E**
Start the stack locally against the dev DB and the fake flow:
```
# terminal 1 — fake flow (P0 creates it)
python -m uvicorn tests.fakes.fake_flow:app --port 8765
# terminal 2 — backend
cd backend && APP_ENVIRONMENT=dev DB_NAME=sales_copilot_dev python -m uvicorn server:app --port 8000
# terminal 3 — frontend (dev mode served by backend after build, or CRA dev server)
cd frontend && npm start   # REACT_APP_BACKEND_URL=http://localhost:8000
```
Then walk every user click path the spec lists, using **Playwright CLI scripts first** (cheaper: `test_scripts/` suite at the main checkout, `npx playwright test <spec>`), and the Playwright MCP only for exploratory checks or when a script does not exist yet. For each path record: steps, expected, observed, screenshot path (save under `test_scripts/playwright-report/` or `docs/revamp/private/evidence/`). Check the browser console and network tab for errors on each page touched.

**G5 — Data audit**
Query the dev DB after G4 and confirm the documents written match the spec (status values, error codes, no `pending` leftovers, no duplicate rows). Paste the query and a redacted sample in HANDOFF.md.

**G6 — Security audit (diff-scoped)**
`git diff main...HEAD` review for: secrets/tenant data, auth checks on new endpoints (`require_auth`/`require_admin`), user scoping (`user_id` in every per-user query), input validation, injection (regex/`$where`/OData filter values must be escaped — single quotes doubled in OData), error messages not leaking internals, rate limits on new public endpoints.

**G7 — Deploy and production verification** (only after G1–G6 green; see §5)

A phase is `DONE` only when G1–G7 are green and STATE.md + HANDOFF.md are updated.

## 5. Git, merge and deploy

- Branch per phase: `revamp/p<n>-<slug>` from latest `origin/main`. Parallel sessions use separate **git worktrees**: `git worktree add ../loop-p<n> -b revamp/p<n>-<slug> origin/main`. Git-ignored assets (`test_scripts/`, `docs/revamp/private/`, `.env`) exist only in the main checkout: `C:\Users\NIRANJAN VSKS\OneDrive\Desktop\Niranjan_Stuff\Moltbot-habit` — reference them by absolute path from a worktree.
- To ship:
  1. `git fetch origin && git rebase origin/main` → rerun G1–G2 (and G4 if the rebase pulled in changes touching your files).
  2. `git checkout main && git pull --ff-only && git merge --ff-only revamp/p<n>-<slug>` (rebase again if not fast-forwardable). Never create merge commits on main that combine two unreviewed phases.
  3. `git push origin main`. If rejected, another agent shipped first: go back to step 1.
  4. Railway auto-deploys `main` (confirmed in P0 — if P0 found otherwise, follow STATE.md "Deploy procedure").
- **G7 production verification** (wait up to 10 minutes for the deploy, poll every 60s):
  - `curl -s https://api.loopcopilot.cc/healthz` → `{"status":"ok"}`
  - `curl -s https://api.loopcopilot.cc/api/version` → `commit` equals `git rev-parse HEAD` (endpoint added in P0).
  - `curl -sI https://www.loopcopilot.cc` → 200.
  - Prod smoke (read-only, no D365 writes): Playwright `test_scripts` smoke subset or MCP: login page renders, login with the test account from `test_scripts/.env`, dashboard loads, the pages the phase touched load with zero console errors.
  - If any fails: **roll back immediately** with `git revert <merge range>` + push (never force-push), mark the phase `BLOCKED` in STATE.md with the reason, and tell the user.
- `gh` CLI is not authenticated on this machine — do not depend on PRs. Plain git push is the ship mechanism.
- Commit messages end with the attribution trailer your harness requires (Claude sessions: `Co-Authored-By: Claude ...`).

## 6. State and handoff protocol (compaction-proof)

- [STATE.md](STATE.md) is the **single source of truth** for progress. Update it at every task tick, every gate result, and every status change — not only at the end. Commit STATE.md updates with the code they describe (or as `chore(state): ...`).
- [HANDOFF.md](HANDOFF.md) holds the **latest session's** handoff: what was done, what's next, gate results, open questions, scope requests. Overwrite the "Current handoff" section at the end of each session; append a one-line entry to "Handoff log".
- Write so that an agent with **zero conversation history** can resume from STATE.md + HANDOFF.md alone. Concise is fine; ambiguous is not.
- If your context is about to be compacted or the session is ending mid-task: immediately write HANDOFF.md "Current handoff" with the exact next step (file, function, command), commit, then continue.
- Claude sessions additionally keep the user's memory directory current (project state + decisions) when a phase completes.

## 7. Parallel-session rules

- Each phase spec declares **file ownership**. Two parallel sessions must never edit the same file. If you need a file owned by a concurrent phase, stop and record a scope request.
- STATE.md is shared: always `git pull --rebase` (or rebase on `origin/main`) before editing it; keep edits to your phase's rows and the log.
- If STATE.md shows another phase `IN PROGRESS` that you depend on, wait — do not implement its parts.

## 8. When to stop and ask the user

- A required external input is missing (flow URL, secret, tenant field names, approval for canary).
- A gate fails twice for reasons outside your phase's files.
- The spec is ambiguous in a way that changes behaviour for users.
- You would need to touch files outside your phase's table.
- Anything irreversible in production.

When you stop: update HANDOFF.md, set STATE.md status `BLOCKED: <reason>`, commit, and tell the user exactly what you need.

## 9. Definition of production-ready (applies to every phase's output)

- Every write path reports the truth (confirmed / unverified / failed with code) in UI, DB and logs.
- No unhandled exception reaches the user as a blank screen or a generic 500 without an error code.
- Every new endpoint authenticated, user-scoped, validated, rate-limited where public.
- Tests exist for the happy path, each error code the phase introduces, and idempotency where relevant.
- Click paths verified locally and the touched pages verified in production.
