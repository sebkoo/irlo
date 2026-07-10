#!/usr/bin/env bash
# PostToolUse hook: format + lint + related tests for the file just edited.
# FAIL-OPEN by design — a missing tool or a lint error must never block the
# edit loop; CI is the enforcing harness. Exit 0 always.
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

repo_root="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"

case "$file" in
  "$repo_root"/server/*.ts | "$repo_root"/packages/*.ts | "$repo_root"/server/*.js | "$repo_root"/packages/*.js)
    command -v pnpm >/dev/null 2>&1 || exit 0
    pkg="$repo_root/server"
    case "$file" in "$repo_root"/packages/contracts/*) pkg="$repo_root/packages/contracts" ;; esac
    (
      cd "$pkg" || exit 0
      pnpm exec prettier --write "$file" >/dev/null 2>&1
      pnpm exec eslint --fix "$file" >/dev/null 2>&1
      case "$file" in
        *.test.ts | */src/*) pnpm exec vitest related "$file" --run >/dev/null 2>&1 ;;
      esac
    ) || true
    ;;
  "$repo_root"/apps/ios/*.swift)
    command -v swiftformat >/dev/null 2>&1 && swiftformat "$file" >/dev/null 2>&1
    command -v swiftlint >/dev/null 2>&1 && (cd "$repo_root/apps/ios" && swiftlint lint --quiet "$file" >&2) || true
    ;;
esac

exit 0
