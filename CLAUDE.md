# Sales AI Copilot — Claude Code Reference

## WHAT WE ARE BUILDING

A web dashboard for Cisco sales reps to automate CRM tasks via
button clicks or AI chat. Single-tenant beta, multi-tenant later.

## FINAL APPROVED STACK — DO NOT DEVIATE

| Layer        | Technology                                     |
| ------------ | ---------------------------------------------- |
| Frontend     | React 19, Tailwind, shadcn/ui, Framer Motion   |
| Backend      | FastAPI, Motor (async MongoDB)                 |
| Auth         | Microsoft Entra ID (MSAL Python)               |
| AI Chat      | Groq + Llama 3.1 8B (free tier)                |
| D365         | Direct Dataverse REST API                      |
| Database     | MongoDB Atlas M0                               |
| Hosting      | Render (frontend static + backend web service) |
| Phase 2 only | N8N on Oracle Cloud VM                         |

## REPO STRUCTURE

```
Moltbot-habit/
├── backend/
│   ├── server.py           # FastAPI main app
│   ├── microsoft_auth.py   # MSAL auth + token management
│   ├── d365_client.py      # Dataverse REST API client
│   ├── ai_chat.py          # Groq intent routing
│   └── requirements.txt
├── frontend/
│   └── src/
│       ├── pages/          # DashboardPage, ChatPage, ActivitiesPage, admin/*
│       └── components/     # Navigation + shared UI
├── deploy/
│   ├── render.yaml
│   └── .env.example
└── .claude/
    ├── CLAUDE.md           # This file
    └── commands/
```

## ENVIRONMENT VARIABLES (use os.getenv() / process.env ONLY)

```
MONGO_URL                   # Atlas M0 connection string
DB_NAME=sales_copilot
AZURE_CLIENT_ID             # Microsoft Entra ID
AZURE_CLIENT_SECRET
AZURE_TENANT_ID
AZURE_REDIRECT_URI          # https://<render-url>/api/auth/microsoft/callback
D365_ORG_URL                # https://lenovo-nitro-prod.crm.dynamics.com
GROQ_API_KEY
TOKEN_ENCRYPTION_KEY
SECRET_KEY
INTERNAL_KEY
REACT_APP_BACKEND_URL       # frontend env var
```

## API RESPONSE CONTRACT — EVERY endpoint returns this shape

```json
{ "success": true, "data": {}, "error": null }
```

## DESIGN SYSTEM (enforce without exception)

- Background: #0f0f10 | Card: #141416 | Text: #F2F3F5
- Muted: #9CA3AF | Border: #1f2022
- Accent: #FF4500 | Success: #22c55e | Error: #ef4444
- Fonts: Space Grotesk (headings), Fira Sans (body)
- NO emojis — lucide-react icons only
- NO transition:all — specify property explicitly
- NO text-center in body content
- All UI components from src/components/ui/ (shadcn/ui)

## PAGES TO BUILD

| Route              | Component       | Status          |
| ------------------ | --------------- | --------------- |
| /login             | LoginPage       | MS SSO button   |
| /                  | DashboardPage   | 6 cards, 1 live |
| /chat              | ChatPage        | Groq chat       |
| /activities        | ActivitiesPage  | D365 history    |
| /admin/team        | TeamPage        |                 |
| /admin/connections | ConnectionsPage |                 |
| /admin/monitoring  | MonitoringPage  |                 |

## WORKFLOW CARDS

1. Log D365 Activity — LIVE (fully wired beta)
2. Send Email Chain — Coming Soon
3. Find Leads — Coming Soon
4. Schedule Meeting — Coming Soon
5. Draft Follow-up — Coming Soon
6. [Placeholder] — Coming Soon

## BUILD PHASES

- Phase 2: microsoft_auth.py + LoginPage
- Phase 3: d365_client.py + ai_chat.py (Groq)
- Phase 4: All frontend pages
- Phase 5: render.yaml + deploy config

## SURGICAL FIX RULES

When fixing a bug:

1. Read the error. Identify root cause with evidence from the actual code.
2. State EXACTLY which lines/function are broken and WHY.
3. Fix ONLY that. Nothing adjacent.
4. If a fix requires touching more than 2 files — stop and explain why before proceeding.

## NON-NEGOTIABLES

- Input validation on every endpoint (Pydantic models)
- Loading + error states on every async UI operation
- try/catch on every API call — user-facing error messages
- No hardcoded secrets. Ever.
- Old OpenClaw/clawdbot/Emergent code is DELETED not commented out

## ACCOUNTABILITY (READ ONCE, APPLY ALWAYS)

BEFORE touching any file:

- Know which phase/feature this belongs to
- Know exactly which files you'll touch
- If the answer to "is this in the approved plan?" is no → stop and ask

WHEN fixing bugs:

- Root cause first. Evidence from actual code, not assumptions.
- Minimum viable fix. If you're touching more than 2 files for a bug fix,
  explain why before proceeding.
- Working code is sacred. If it works, don't touch it.

NEVER without asking:

- Add a dependency not in requirements.txt/package.json already
- Change a MongoDB collection name or schema
- Change an API route path
- Refactor working code while building a new feature

NO STATUS REPORTS for routine work.
Flag only when: blocked / ambiguous / about to do something risky.

## MAGIC WORD

Do not write a single line of application code until Niranjan says: BULLSEYE
In plan mode: read, analyze, ask questions only.

## SESSION PROTOCOL

### At session START:
Read `.claude/primer.md` immediately — it has the exact current phase, last completed work, and next step.

### At session END (when user says "done", wraps up, or closes a phase):
Rewrite `.claude/primer.md` completely with:
- Current phase + exact next action (specific files + functions)
- What was completed this session (bullet list)
- Files touched
- Any open blockers or pending decisions

This is non-negotiable. primer.md must always reflect reality, not history.

## MEMORY PROTOCOL — WHEN TO WRITE AND WHEN TO PRUNE

Memory files are not a log. They are a minimal, accurate model of current state.
Default behavior: **do not touch memory files** unless a trigger below fires.

### Write triggers (only update the named file):
| Trigger | File to update |
|---|---|
| A locked decision changes or a new one is made | `memory/decisions.md` |
| Niranjan explicitly corrects Claude's behavior | `memory/preferences.md` |
| A new stakeholder or meaningful contact appears | `memory/people.md` |
| Something meaningfully new learned about Niranjan | `memory/user.md` |
| Session ends | `.claude/primer.md` (always rewrite) |

### Prune rules (apply during the same edit that triggered the write):
- **Phase completes** → compress its detail block to a single ✅ line. Git history has the full record.
- **Blocker resolves** → delete it from primer.md on the next rewrite. Don't keep resolved blockers.
- **Fact already in code** → remove from memory. The codebase is the source of truth.
- **Same fact in two files** → keep in the specific file, delete from the general one.

### Never prune:
- The *why* behind any decision — removing reasoning causes the same debate to reopen.
- Any active preference or rule — a missing rule means repeating the same mistake.
- Credentials (tiny, high-value, not derivable from code).

### The test before writing anything to memory:
> "Would future-Claude be wrong or confused without this? And is it NOT already in the code or git history?"
> If no to either → don't write it.
