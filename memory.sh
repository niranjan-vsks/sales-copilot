#!/usr/bin/env bash
# memory.sh — inject live git state before a Claude Code session
# Usage: bash memory.sh   (run from project root before starting Claude)

echo "============================================"
echo "  LIVE PROJECT STATE — Sales Copilot"
echo "============================================"
echo ""
echo "Branch:  $(git branch --show-current)"
echo "Remote:  $(git remote get-url origin 2>/dev/null || echo 'no remote configured')"
echo ""
echo "--- Last 5 commits ---"
git log --oneline -5
echo ""
echo "--- Working tree status ---"
git status --short
echo ""
echo "--- Staged changes (summary) ---"
git diff --cached --stat 2>/dev/null
if [ -z "$(git diff --cached --stat 2>/dev/null)" ]; then
  echo "(nothing staged)"
fi
echo ""
echo "--- Primer (current session state) ---"
if [ -f ".claude/primer.md" ]; then
  cat .claude/primer.md
else
  echo "primer.md not found"
fi
echo "============================================"
