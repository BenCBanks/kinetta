#!/usr/bin/env bash
# Owner-run weekly P0 gate. Freeze both source trees; no key in arguments/files.
set -euo pipefail
umask 077
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
REPORT=""; HISTORY=""; OPTIONS=()
while (($#)); do
  case "$1" in
    --installed-report) REPORT="$2"; shift 2 ;;
    --reuse-baseline) HISTORY="$2"; shift 2 ;;
    --dry-run|--offline-smoke) OPTIONS+=("$1"); shift ;;
    --resume|--retry-case|--budget-usd) OPTIONS+=("$1" "$2"); shift 2 ;;
    *) echo 'Use --installed-report FILE [--reuse-baseline FILE] [--dry-run|--offline-smoke] [--resume FILE] [--budget-usd USD]' >&2; exit 2 ;;
  esac
done
[[ -f "$REPORT" ]] || { echo 'Pass the installed live report.' >&2; exit 2; }
TEMP="$(mktemp -d)"
trap 'rm -rf "$TEMP"' EXIT
LIVE="$(git -C "$ROOT" rev-parse ba8e9500)"
git -C "$ROOT" archive "$LIVE" app | tar -x -C "$TEMP"
PREPARE=(--tree "$TEMP/app" --installed-report "$REPORT" --output-dir "$TEMP")
if [[ -n "$HISTORY" ]]; then PREPARE+=(--reuse-baseline "$HISTORY"); fi
python3 "$ROOT/dev/evals/kit_weekly_gate.py" "${PREPARE[@]}"
export KINETTA_KIT_BASELINE_TREE="$TEMP/app"
export KINETTA_KIT_BASELINE_PIN="$TEMP/pin.json"
unset KINETTA_KIT_BASELINE_CACHE
if [[ -f "$TEMP/baseline-cache.json" ]]; then export KINETTA_KIT_BASELINE_CACHE="$TEMP/baseline-cache.json"; fi
"$ROOT/dev/evals/run_kit_eval.sh" --baseline "$TEMP/app/coach_chat.py" --baseline-commit "$LIVE" \
  --candidate-commit "$(git -C "$ROOT" rev-parse HEAD)" --budget-usd 2.50 "${OPTIONS[@]}"
