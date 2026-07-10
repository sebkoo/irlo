#!/usr/bin/env bash
# PreToolUse guard: LICENSE and docs/naming/ are immutable evidence
# (see CLAUDE.md "Never do"). Exit 2 blocks the tool call and returns
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
esac

exit 0
