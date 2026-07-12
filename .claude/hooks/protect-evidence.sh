#!/usr/bin/env bash
# PreToolUse guard: LICENSE and docs/naming/ are immutable evidence
# (see CLAUDE.md "Never do"). .claude/settings*.json (tracked and local)
# is the harness constitution (hooks + permissions) — edits require the
# same explicit my-say-so, so a permission/hook change can't slip in as
# a side effect of an unrelated task. .claude/hooks/ is self-protected
# for the same reason: an editable enforcement mechanism defeats the
# constitution it protects. Exit 2 blocks the tool call and returns
# stderr to Claude; anything else fails open.
set -u

payload=$(cat)
file=$(printf '%s' "$payload" | python3 -c '
import json, sys
try:
    print(json.load(sys.stdin).get("tool_input", {}).get("file_path", ""))
except Exception:
    pass
' 2>/dev/null) || exit 0
[ -n "$file" ] || exit 0

case "$file" in
  */LICENSE | */docs/naming/*)
    echo "Blocked: $file is protected. LICENSE and docs/naming/ are immutable evidence (CLAUDE.md 'Never do'). Ask the user if a change is truly required." >&2
    exit 2
    ;;
  */.claude/settings*.json)
    echo "Blocked: $file is the harness constitution (hooks + permissions), tracked or local. Ask the user for explicit go-ahead before editing it." >&2
    exit 2
    ;;
  */.claude/hooks/*)
    echo "Blocked: $file is inside the hook guard's own directory. Ask the user for explicit go-ahead before editing enforcement scripts." >&2
    exit 2
    ;;
esac

exit 0
