# /fix — Surgical Bug Fix

Follow the surgical fix protocol from CLAUDE.md. No shortcuts.

## Protocol

1. **Read the error** — paste or describe it. Do not guess.
2. **Find root cause** — read the actual file and line. State EXACTLY what is broken and why.
3. **Declare the fix** — which file(s), which lines, what change.
4. **Stop if >2 files** — explain why before touching anything.
5. **Fix only that** — nothing adjacent, no cleanup, no refactors.
6. **Verify** — re-read the fixed code and confirm it solves the stated root cause.

## Rules

- Working code is sacred. If it works, don't touch it.
- No speculative fixes. Evidence from actual code only.
- If the fix requires a new dependency — stop and ask first.
- If the fix changes an API route or MongoDB schema — stop and ask first.
