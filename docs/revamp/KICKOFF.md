# Kickoff prompts

Paste one into a **new** session opened at the repo root. Replace nothing unless marked `<...>`.

---

## 1. Generic phase kickoff (Claude Sonnet/Opus, Codex/GPT — any agent)

```
BULLSEYE P<n>

You are building phase P<n> of the Loop Copilot revamp in this repository.

Before writing any code, read these files completely, in order:
1. docs/revamp/README.md
2. docs/revamp/DOCTRINE.md   (binding process rules — follow them exactly)
3. docs/revamp/STATE.md      (source of truth for progress)
4. docs/revamp/HANDOFF.md    (last session's handoff and exact next step)
5. docs/revamp/phases/P<n>-*.md  (your spec)
6. The sections of docs/revamp/ARCHITECTURE.md and docs/revamp/AUDIT.md that your spec cites.

Ignore root CLAUDE.md and AGENT.md (unrelated Jetro tool content).

Then:
- Run the DOCTRINE §0 start-of-session protocol. If any dependency phase is not DONE in STATE.md, stop and tell me.
- Create your branch/worktree exactly as DOCTRINE §5 says.
- Mark P<n> IN PROGRESS in STATE.md, add your task list, commit.
- Build task by task. Touch only the files in your spec's Files table. Tick STATE.md after each task and commit.
- Run the full Audit Gate G1–G7 (DOCTRINE §4): static checks, pytest, integration wiring audit, local click-path E2E with Playwright (use the CLI suite in test_scripts/ first, Playwright MCP only when needed), data audit, diff security audit, then merge to main, push, and verify the Railway deploy (/api/version commit matches, healthz, prod smoke).
- Never write to the live D365 tenant unless I explicitly approve a canary in this session.
- If anything in DOCTRINE §8 happens, stop, update HANDOFF.md and STATE.md, and ask me.
- Finish by writing HANDOFF.md "Current handoff", updating STATE.md (phase DONE, findings closed, log line), committing and pushing.

Then report back in under 15 lines: what shipped, gate results, prod verification, anything I must do.
```

---

## 2. Session A — P1 then P2 (Sonnet 5.5)

```
BULLSEYE P1, then P2

Use the generic kickoff procedure in docs/revamp/KICKOFF.md section 1 for phase P1.
When P1 is DONE (all gates green, deployed, verified, STATE.md updated), immediately start P2
with the same procedure — only if STATE.md shows P0 and P1 DONE and P2's external inputs exist
(docs/revamp/private/field_map.json and a working generic flow). If they are missing, stop and tell me.

You are running in parallel with another session building P3 (Model Layer). Do not edit any
file P3 owns (backend/ai_chat.py, backend/llm/, backend/prompts/, backend/activity_sheet_processor.py).
Use a git worktree: git worktree add ../loop-p1 -b revamp/p1-truthful-logging origin/main
```

## 3. Session B — P3 then P4 (Sonnet 5.5)

```
BULLSEYE P3, then P4

Use the generic kickoff procedure in docs/revamp/KICKOFF.md section 1 for phase P3.
You are running in parallel with another session building P1 and P2. Do not edit server.py or
any file outside P3's Files table. Use a git worktree:
git worktree add ../loop-p3 -b revamp/p3-model-layer origin/main

When P3 is DONE, check STATE.md. Start P4 only when P2 is DONE. If P2 is not DONE yet,
write in HANDOFF.md that P4 is waiting on P2, and stop.
```

## 4. P0 kickoff (Opus 5.5 recommended)

```
BULLSEYE P0

Use the generic kickoff procedure in docs/revamp/KICKOFF.md section 1 for phase P0.
P0 mixes agent tasks (T1–T6) and user tasks (U1–U6). Do the agent tasks first. Ask me before
connecting to the production database, even read-only. Then give me the U1–U6 checklist in plain
steps, wait for my results, and complete the outputs (private/D365_SCHEMA.md, private/field_map.json,
STATE.md root cause). Walk me through FLOW_BUILD_GUIDE.md when I build the flow.
```

## 5. Resume after compaction or a crashed session

```
Resume the Loop Copilot revamp. Read docs/revamp/DOCTRINE.md, then docs/revamp/STATE.md and
docs/revamp/HANDOFF.md. Run `git status`, `git branch --show-current`, `git log --oneline -10`.
Reconcile them with STATE.md (DOCTRINE §0 step 2). Then continue exactly from HANDOFF.md
"Next step". Do not redo ticked tasks. My original go-word for this phase still applies.
```

## 6. Codex-specific note
Codex reads `AGENTS.md` at the repo root automatically. It exists only in the main checkout (git-ignored on purpose), so in a worktree rely on this prompt. Paste prompt 1 with the phase number. Do not run Codex on a phase another agent has `IN PROGRESS` in STATE.md.
