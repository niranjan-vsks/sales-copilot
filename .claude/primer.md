# Sales Copilot — Session Primer

> This file is rewritten at the end of every session. Always reflects current state.
> Last updated: 2026-03-15

---

## WHERE WE ARE

**Branch:** `02/Habit-Tracking`
**Current phase:** ALL PHASES COMPLETE — ready for beta deployment

## WHAT JUST GOT DONE

### Phase 3 — Backend modules
- `backend/d365_client.py` — full Dataverse REST client (test, list, create, update activities)
- `backend/ai_chat.py` — Groq + Llama 3.1 8B intent router, returns {workflow, params, clarification_needed, user_message}
- `backend/n8n_client.py` — graceful stub (returns coming_soon dict, no exceptions)
- `backend/server.py` — added `_execute_d365_activity` helper + D365 direct dispatch for "log-d365-activity"

### Phase 4 — Full frontend
- `frontend/src/lib/api.js` — centralized API client with credentials:include + 401 redirect
- `frontend/src/components/AuthGuard.js` — auth protection + requireAdmin support
- `frontend/src/layouts/TopNavLayout.js` — Dashboard + Chat nav layout
- `frontend/src/layouts/SidebarLayout.js` — Activities + Admin layout with 160px sidebar
- `frontend/src/pages/DashboardPage.js` — 6 workflow cards, 1 LIVE (D365 Logger Dialog), Recent Executions
- `frontend/src/pages/ChatPage.js` — AI chat with Groq, typing indicator, workflow execution cards
- `frontend/src/pages/ActivitiesPage.js` — D365 activity history + execution log + filters
- `frontend/src/pages/admin/ConnectionsPage.js` — M365 status, D365 test connection, dry run toggle
- `frontend/src/pages/admin/TeamPage.js` — member table, add/remove with dialogs
- `frontend/src/pages/admin/MonitoringPage.js` — Recharts charts + 15s auto-refresh executions table
- `frontend/src/App.js` — HashRouter with all routes, AuthGuard wrapping

### Phase 5 — Deployment
- `render.yaml` — Render Blueprint (backend web service + frontend static site)
- `deploy/.env.example` — all env vars documented with generation instructions

## OPEN BLOCKERS

None. All credentials confirmed in .env.

## DEPLOYMENT STEPS (NEXT)

1. Push branch to GitHub
2. Go to Render Dashboard → New → Blueprint → point to repo
3. Set secret env vars in Render dashboard (those marked `sync: false` in render.yaml)
4. First user to log in via Microsoft SSO becomes admin automatically (first-login provision)
5. Admin adds team members via /admin/team

## VERIFICATION CHECKLIST

1. `/login` → Microsoft button → OAuth → lands on Dashboard ✅
2. `/admin/connections` → [Test Connection] → {connected: true}
3. Dashboard → [Run] on D365 Activity card → fill form → Log Activity → check D365
4. `/chat` → "log a 30-min call with Acme Corp" → AI responds, workflow executes
5. `/activities` → rows appear after logging
6. `/admin/monitoring` → chart shows execution data, auto-refreshes every 15s

## FILES CHANGED THIS SESSION (Phase 2-5)

Backend: d365_client.py, ai_chat.py, n8n_client.py, server.py (D365 dispatch added)
Frontend: App.js, lib/api.js, components/AuthGuard.js, layouts/*, pages/* (all pages)
Deploy: render.yaml, deploy/.env.example
