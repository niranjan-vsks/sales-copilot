# HANDOFF

Rules: [DOCTRINE.md §6](DOCTRINE.md). Overwrite "Current handoff" at the end of every session. Append one line to "Handoff log".

---

## Current handoff

**From:** Claude (Opus 5.5), spec session, 2026-10-09
**Phase:** none in progress — specs only
**Branch:** `main`

**Done this session**
- Audited the full D365 write path, auth, CORS, rate limiting, jobs and chat. Findings in [AUDIT.md](AUDIT.md) (B01–B28, D01–D06).
- Verified external constraints (legacy flow URL retirement 2025-11-30; Dataverse MCP needs tenant consent; "HTTP with Microsoft Entra ID (preauthorized)" needs none).
- Wrote the architecture contracts, doctrine, phase specs P0–P7, flow build guide, kickoff prompts.

**Next step (exact)**
1. User says `BULLSEYE P0` in a new Opus session using the P0 kickoff in [KICKOFF.md](KICKOFF.md).
2. That session does P0 agent tasks T1–T5, then prepares the user checklist U1–U6 here.

**Open questions for the user**
- Is the GitHub repo public? (Specs assume yes and keep tenant data out of git.)
- Which Railway branch auto-deploys? (P0 U1)
- Logical names of the client's new filter and new field. (P0 U5)

**Scope requests:** none.
**Gate results:** n/a.

**Repo notes for agents**
- Root `CLAUDE.md` and `AGENT.md` are Jetro tool content (untracked) — ignore them for this project. `AGENTS.md` (local only; `.gitignore` excludes it on purpose) points here. Agents in a fresh worktree will not have it, so the kickoff prompt is the entry point.
- On 2026-10-08 the user's main checkout was switched to branch `backup/pre-clean-main-2026-08-11` (old history + `docs/*BIBLE.md` files). Backend code there is identical to `main`; a few frontend files differ. **All revamp work branches from `origin/main`.** Run DOCTRINE §0 step 2 and never commit revamp work onto a `backup/*` branch.
- Untracked folders and files from older work: the `docs/*BIBLE.md` bibles, `sales-copilot/`, `AUDIT_REPORT.md`, `CHECKLIST_AUDIT.md`, `LENOVO_SALES_COPILOT_QA.md` predate the revamp — do not edit, do not commit.
- `test_scripts/` is the user's git-ignored Playwright suite (POM style). Use it for G4/G7; do not commit it.

---

## Handoff log
- 2026-10-09 — Opus 5.5 — specs written; awaiting BULLSEYE P0.
