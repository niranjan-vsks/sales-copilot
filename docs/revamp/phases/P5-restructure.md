# P5 — Restructure

**Goal:** split the ~2,250-line `backend/server.py` into modules with **zero behaviour change**, so the later phases and new connectors stop piling into one file.

**Recommended model:** Sonnet 5.5.
**Dependencies:** P1–P4 DONE (no other phase in flight — this touches everything in the backend).
**Parallel-safe with:** nothing.
**Branch:** `revamp/p5-restructure`
**Closes:** D01, B27 (delete stale `render.yaml` after confirming nothing references it).

---

## Target layout

```
backend/
  server.py              # thin entrypoint: from app.main import app  (Railway start command unchanged: uvicorn server:app)
  app/
    main.py              # FastAPI(), middleware (CORS, limiter), include_router(...), startup/shutdown, /healthz, /api/version, dev SPA mount
    core/config.py       # env reads (at call time where they were call-time before)
    core/db.py           # Mongo client, db, kb singletons; get_db()
    core/security.py     # get_current_user, require_auth, require_admin, _cookie_sec, limiter
    models.py            # Pydantic request models moved verbatim
    routers/auth.py      # /auth/* (incl. signup router include)
    routers/workflows.py # /workflows/*
    routers/chat.py      # /chat, /chat/history
    routers/crm.py       # /crm/*, /d365/*, /config, /config/activity-types
    routers/files.py     # /files/*, /accounts/search
    routers/excel.py     # /excel/*
    routers/sheets.py    # /activity-sheets/*
    routers/admin.py     # /team, /settings, /monitoring/*, /internal/*
    routers/notify.py    # /notifications/*, /calendar/*, /user/preferences
    jobs.py              # _run_activity_sheet_job, _run_batch_job, _safe_task
    startup.py           # indexes, seeds, bootstrap
```
Existing top-level modules (`crm/`, `llm/`, `agent/`, `microsoft_auth.py`, ...) stay where they are.

## Rules
- Move code verbatim. Allowed edits: imports, module-qualified references, `db` access via `core.db`. No renames of route functions, no signature changes, no logic edits.
- Tests that monkeypatch `server.db` / `server.kb` must be updated to patch `app.core.db` — adjust `tests/conftest.py` once; keep a compatibility alias `server.db`/`server.kb` re-exported from `server.py` so external scripts keep working.

## Tasks
- **P5.T1 — Route snapshot test (write first, on the old code):** `tests/backend/test_routes_snapshot.py` dumps sorted `(methods, path, endpoint name)` for `app.routes` into `tests/backend/routes_snapshot.json`, committed. After the move, the test must produce an identical list.
- **P5.T2 — Move**, module by module, running `pytest` after each module.
- **P5.T3 — Middleware order:** the CORS, rate limiter and exception handler registration order must match the old file. Verify the decorator order on rate-limited routes stays as P1 fixed it (the 429 test must still pass).
- **P5.T4 — Delete `render.yaml`** after `git grep -n render.yaml` shows no references (update README "Deployment" mention if any).

## Gate
Full G1–G7. G4 = the **complete** click-path list from P1, P2, P3, P4 (regression), not only a subset. G7 prod smoke covers every page.

## Definition of done
- [ ] Route snapshot identical; all tests green; full regression click paths green locally and smoke green in prod
- [ ] STATE.md, HANDOFF.md updated (new file map in HANDOFF); P5 DONE
