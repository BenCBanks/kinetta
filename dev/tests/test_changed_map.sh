#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
mapfile -t files < <(git ls-files app/static)
dev/tests/changed.sh --check-files "${files[@]}" >/dev/null
if dev/tests/changed.sh --check-files app/static/new-unmapped-screen.js >/dev/null 2>&1; then
  echo "An unmapped app/static path passed the changed-screen gate." >&2
  exit 1
fi
echo "Changed-screen mapping covers all tracked app/static files and rejects unknown paths."
