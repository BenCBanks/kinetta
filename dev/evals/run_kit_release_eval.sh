#!/usr/bin/env bash
# Standard release entry point: pinned fixtures, ten-case smoke first, no paid calls by default.
set -euo pipefail
umask 077
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HEAD="$(git -C "$ROOT" rev-parse HEAD)"
DIRECTORY="$HOME/pigserver/backup/2026-11-kit-eval-v2"
mkdir -p "$DIRECTORY"; chmod 700 "$DIRECTORY"
RECEIPT="$DIRECTORY/kit-offline-$HEAD.json"
STAGE=smoke; REPLAY=0; BUDGET=.80; OPTIONS=()
while (($#)); do
  case "$1" in
    --full) STAGE=full; shift ;;
    --budget-usd) BUDGET="$2"; shift 2 ;;
    --bootstrap-baseline) STAGE=baseline; shift ;;
    --replay) REPLAY=1; shift ;;
    --installed-report|--cache) OPTIONS+=("$1" "$2"); shift 2 ;;
    --dry-run) OPTIONS+=("$1"); shift ;;
    *) echo 'Use --installed-report FILE [--replay|--dry-run|--full] [--cache CAPTURE (repeatable)] [--budget-usd USD (max1.60)]' >&2; exit 2 ;;
  esac
done
if ((REPLAY)); then
  env -u GEMINI_API_KEY -u ANTHROPIC_API_KEY "$ROOT/dev/evals/run_kit_batch2_gate.sh" \
    "${OPTIONS[@]}" --economy-stage smoke --offline-smoke
  # A receipt is generated only after captured-answer replay and real-path stand-ins succeed.
  if [[ ! -e "$RECEIPT" ]]; then python3 "$ROOT/dev/evals/kit_eval_savings.py" --receipt "$RECEIPT" --write; fi
  echo "Offline replay passed on $HEAD; receipt $RECEIPT"
else
  "$ROOT/dev/evals/run_kit_batch2_gate.sh" "${OPTIONS[@]}" --economy-stage "$STAGE" \
    --offline-receipt "$RECEIPT" --budget-usd "$BUDGET"
fi
