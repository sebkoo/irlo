#!/usr/bin/env bash
# PreToolUse guard (Bash matcher): blocks shell commands that write to or
# delete .claude/settings*.json or .claude/hooks/* — protect-evidence.sh
# only sees Edit/Write/MultiEdit tool calls, so a Bash heredoc/tee/cp/
# sed -i/rm targeting the same paths would otherwise bypass it entirely.
# Found and closed 2026-07-12 before it was used against a real
# unauthorized edit — a session run proposed writing settings.json via
# Bash under its own claimed authorization and was stopped by the human
# operator, who pointed out that an agent using a loophole is exactly what
# this guard exists to prevent, whatever the stated justification.
#
# Best-effort, pattern-based: it cannot catch every possible obfuscation
# (base64, a script invoking another interpreter, etc.) any more than the
# cat/ls allow-rules can fully rule out redirection — see PERMISSIONS.md's
# own caveat on that. It raises the bar past casual or incidental bypass;
# it is not a sandboxing guarantee. Exit 2 blocks the tool call and
# returns stderr to Claude; anything else fails open.
#
# v2 (2026-07-12): the mutation-signature check must match command NAMES,
# not arbitrary substrings — a naive `case "$command" in *dd\ *)` matched
# "dd" inside "add", so a plain `git add .claude/settings.json ...` (a
# read of the working tree, a legitimate operation this guard should never
# touch) was blocked. Same risk existed for `rm` inside "confirm"/"term"/
# "perform" and `cp`/`tee` inside longer words. Fixed with grep -E word
# boundaries: a non-alnum/underscore (or string start/end) on both sides
# of the command-name token. BSD grep (macOS default `grep -E`) doesn't
# support \b, hence the explicit [^A-Za-z0-9_] character-class boundaries
# instead of \b — this must stay portable to both BSD and GNU grep.
#
# Pipe-test examples (run from the repo root):
#   # blocks: redirection into settings.json
#   echo '{"tool_input":{"command":"echo hi > .claude/settings.json"}}' \
#     | .claude/hooks/protect-constitution-bash.sh; echo "exit=$?"   # expect 2
#
#   # blocks: cp onto a file under .claude/hooks/
#   echo '{"tool_input":{"command":"cp x.sh .claude/hooks/protect-evidence.sh"}}' \
#     | .claude/hooks/protect-constitution-bash.sh; echo "exit=$?"   # expect 2
#
#   # passes: mentions a protected path but has no write/delete signature
#   echo '{"tool_input":{"command":"ls .claude/hooks/"}}' \
#     | .claude/hooks/protect-constitution-bash.sh; echo "exit=$?"   # expect 0
#
#   # passes: unrelated command entirely
#   echo '{"tool_input":{"command":"echo hello > /tmp/foo.txt"}}' \
#     | .claude/hooks/protect-constitution-bash.sh; echo "exit=$?"   # expect 0
#
#   # passes (regression, 2026-07-12): staging protected paths is not
#   # writing to them — "add" must not fuzzy-match the "dd" command name
#   echo '{"tool_input":{"command":"git add .claude/settings.json .claude/hooks/protect-constitution-bash.sh"}}' \
#     | .claude/hooks/protect-constitution-bash.sh; echo "exit=$?"   # expect 0
#
#   # passes (regression, 2026-07-12): "rm" must not fuzzy-match inside
#   # ordinary words like "confirm"
#   echo '{"tool_input":{"command":"git commit -m \"confirm rebase plan\""}}' \
#     | .claude/hooks/protect-constitution-bash.sh; echo "exit=$?"   # expect 0
set -u

payload=$(cat)
command=$(printf '%s' "$payload" | python3 -c '
import json, sys
try:
    print(json.load(sys.stdin).get("tool_input", {}).get("command", ""))
except Exception:
    pass
' 2>/dev/null) || exit 0
[ -n "$command" ] || exit 0

# Only look at commands that mention a protected path at all.
case "$command" in
  *.claude/settings*.json* | *.claude/hooks/*)
    ;;
  *)
    exit 0
    ;;
esac

# Among those, block anything with a write/delete signature: redirection,
# or one of the mutating command NAMES as a whole token (word-boundary via
# character classes, not case-glob substring matching — see v2 note above).
if printf '%s' "$command" | grep -Eq '>|(^|[^A-Za-z0-9_])(cp|mv|rm|dd|tee|install|rsync|truncate)([^A-Za-z0-9_]|$)|sed[[:space:]]+-i|perl[[:space:]]+-i'; then
  echo "Blocked: this Bash command appears to write to or delete a protected constitution path (.claude/settings*.json or .claude/hooks/). Constitution edits are proposed as diffs and applied by the human operator directly, not executed by the agent through any tool — see PERMISSIONS.md." >&2
  exit 2
fi

exit 0
