# /start — Session Orientation

Load full project context and orient for this session.

## Steps

1. Read `CLAUDE.md` — stack, routes, design system, rules
2. Read `memory/MEMORY.md` — what we're building, key decisions, current phase
3. Read `memory/bullseye-trigger.md` — build order and phase checklist
4. Run `git status` and `git log --oneline -10` — see what's been done
5. Check `memory/project-context.md` for API routes and page specs if needed

## Output

After loading context, report:
- Current branch
- Last 3 commits (one line each)
- What phase we're in (based on git history + memory)
- What the next task is
- Any uncommitted changes to be aware of

Keep the report under 10 lines. No fluff.
