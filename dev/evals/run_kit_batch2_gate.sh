#!/usr/bin/env bash
# Owner-run only; preparation/dry-run never receives a provider key.
set -euo pipefail
umask 077
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
REPORT=""; OPTIONS=()
while (($#)); do
  case "$1" in
    --installed-report) REPORT="$2"; shift 2 ;;
    --dry-run|--offline-smoke) OPTIONS+=("$1"); shift ;;
    --resume|--retry-case|--budget-usd) OPTIONS+=("$1" "$2"); shift 2 ;;
    *) echo 'Use --installed-report FILE [--dry-run|--offline-smoke] [--resume FILE] [--retry-case ID] [--budget-usd USD]' >&2; exit 2 ;;
  esac
done
[[ -f "$REPORT" ]] || { echo 'Pass the private installed live report with --installed-report.' >&2; exit 2; }
LIVE="$(git -C "$ROOT" rev-parse ba8e9500)"
[[ "$LIVE" == ba8e9500049f25b2cb769d09a25d99fc4cb198c1 ]] || exit 2
TEMP="$(mktemp -d)"
trap 'rm -rf "$TEMP"' EXIT
git -C "$ROOT" archive "$LIVE" app | tar -x -C "$TEMP"
python3 "$ROOT/dev/evals/kit_batch2_pin.py" "$TEMP/app" "$REPORT" "$ROOT" > "$TEMP/pin.json"
export KINETTA_KIT_BASELINE_TREE="$TEMP/app"
export KINETTA_KIT_BASELINE_PIN="$TEMP/pin.json"
export KINETTA_KIT_BASELINE_COMMIT="$LIVE"
export KINETTA_KIT_BASELINE_REPORT_SHA256
KINETTA_KIT_BASELINE_REPORT_SHA256="$(sha256sum "$REPORT" | cut -d' ' -f1)"
"$ROOT/dev/evals/run_kit_eval.sh" --batch2 --baseline "$TEMP/app/coach_chat.py" \
  --baseline-commit "$LIVE" --candidate-commit "$(git -C "$ROOT" rev-parse HEAD)" \
  --budget-usd 2.50 "${OPTIONS[@]}"
