#!/usr/bin/env bash
# Owner-run integrated batch vs the approved live baseline; no model settings change.
set -euo pipefail
umask 077
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
[[ "$(git -C "$ROOT" branch --show-current)" == kit-coach-batch ]] || {
  echo 'Run from the kit-coach-batch worktree.' >&2; exit 2;
}
BASELINE_FILE="$(mktemp)"
trap 'rm -f "$BASELINE_FILE"' EXIT
LIVE_REV="$(git -C "$ROOT" rev-parse f6e7bbf8)"
git -C "$ROOT" show "$LIVE_REV:app/coach_chat.py" > "$BASELINE_FILE"
"$ROOT/dev/evals/run_kit_eval.sh" --baseline "$BASELINE_FILE" --baseline-commit "$LIVE_REV" \
  --candidate-commit "$(git -C "$ROOT" rev-parse HEAD)" --budget-usd 2.50 "$@"
