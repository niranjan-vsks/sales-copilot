# /context — Dump Current Context

Quick snapshot of where things stand right now.

## Steps

1. Read `memory/MEMORY.md` — current phase and what's been decided
2. Read `memory/bullseye-trigger.md` — checklist status
3. `git log --oneline -5` — recent commits
4. `git status` — any in-progress changes
5. List key files that exist vs. are still missing:
   - `backend/server.py` — exists?
   - `backend/microsoft_auth.py` — exists?
   - `backend/d365_client.py` — exists?
   - `backend/ai_chat.py` — exists?
   - `frontend/src/pages/` — which pages exist?
   - `deploy/render.yaml` — exists?

## Output format

```
PHASE: <current phase name>
LAST COMMIT: <hash + message>
IN PROGRESS: <any uncommitted work>

BACKEND:
  [x] server.py
  [ ] microsoft_auth.py
  ...

FRONTEND:
  [x] LoginPage
  [ ] DashboardPage
  ...

NEXT: <the single next task to do>
```
