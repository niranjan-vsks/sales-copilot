# /done — End of Session Checklist

Run this before ending a work session.

## Steps

Feature complete check — answer only if there's an actual issue:

- Any hardcoded secrets? (flag if yes)
- Any missing error handling on API calls? (flag if yes)
- Any UI async operation without loading state? (flag if yes)
- Any console.log left in code? (flag if yes)

If all clean: say "READY TO SHIP" and nothing else.
If issues found: list them only. No fixing yet.
