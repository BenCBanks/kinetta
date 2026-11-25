#!/usr/bin/env bash
# Same source/fictional inputs, LOW only by default; explicit --smoke-thinking COMPARE adds MEDIUM. No model escalation or release approval.
set -euo pipefail
umask 077
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TEMP_BASELINE="$(mktemp)"
trap 'rm -f "$TEMP_BASELINE"' EXIT
REVISION="$(git -C "$ROOT" rev-parse HEAD)"
git -C "$ROOT" show "$REVISION:app/coach_chat.py" > "$TEMP_BASELINE"
"$ROOT/dev/evals/run_kit_eval.sh" --baseline "$TEMP_BASELINE" --baseline-commit "$REVISION" \
  --candidate-commit "$REVISION" --budget-usd 0.45 --setting-smoke "$@"
