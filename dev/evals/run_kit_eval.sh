#!/usr/bin/env bash
# Starts a fresh test app/database, injects the key only into the evaluator process,
# copies private output back before teardown, and always removes the Compose project.
set -euo pipefail
umask 077

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DRY_RUN=0
OFFLINE_SMOKE=0
SETTING_SMOKE=0
REUSE_LOW=""
GATE_RESUME=""
SMOKE_THINKING="LOW"
CACHE_TEMP=""
BASELINE=""; BASELINE_COMMIT=""; CANDIDATE_COMMIT=""; BUDGET="2.50"
usage() { echo "Usage: $0 --baseline FILE --baseline-commit SHA --candidate-commit SHA [--budget-usd USD (default 2.50)] [--dry-run|--offline-smoke] [--setting-smoke] [--resume FILE|--reuse-low FILE] [--smoke-thinking LOW|COMPARE]"; }
while (($#)); do
  case "$1" in
    --baseline|--baseline-commit|--candidate-commit|--budget-usd)
      (($# >= 2)) || { usage >&2; exit 2; }
      case "$1" in
        --baseline) BASELINE="$2" ;;
        --baseline-commit) BASELINE_COMMIT="$2" ;;
        --candidate-commit) CANDIDATE_COMMIT="$2" ;;
        --budget-usd) BUDGET="$2" ;;
      esac
      shift 2 ;;
    --setting-smoke) SETTING_SMOKE=1; shift ;;
    --reuse-low) REUSE_LOW="$2"; shift 2 ;;
    --resume) GATE_RESUME="$2"; shift 2 ;;
    --smoke-thinking) SMOKE_THINKING="$2"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    --offline-smoke) OFFLINE_SMOKE=1; shift ;;
    --help|-h) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
done
[[ -f "$BASELINE" && -n "$BASELINE_COMMIT" && -n "$CANDIDATE_COMMIT" && -n "$BUDGET" ]] || { usage >&2; exit 2; }
if [[ -n "$GATE_RESUME" && "$SETTING_SMOKE" == 1 ]]; then REUSE_LOW="$GATE_RESUME"; GATE_RESUME=""; fi
[[ -z "$GATE_RESUME" || -f "$GATE_RESUME" ]] || { echo "Resume capture does not exist" >&2; exit 2; }
[[ -z "$REUSE_LOW" || ( "$SETTING_SMOKE" == 1 && -f "$REUSE_LOW" ) ]] || { echo "LOW cache requires setting smoke and a real file" >&2; exit 2; }
((DRY_RUN + OFFLINE_SMOKE <= 1)) || { usage >&2; exit 2; }
BASELINE_COMMIT="$(git -C "$ROOT" rev-parse --verify "$BASELINE_COMMIT^{commit}")"
CANDIDATE_COMMIT="$(git -C "$ROOT" rev-parse --verify "$CANDIDATE_COMMIT^{commit}")"
[[ "$CANDIDATE_COMMIT" == "$(git -C "$ROOT" rev-parse HEAD)" ]] || { echo "Candidate must match this checkout's HEAD." >&2; exit 2; }
if ! git -C "$ROOT" diff --quiet HEAD -- app dev/evals; then
  echo "Commit the evaluated source first." >&2; exit 2
fi
python3 - "$BUDGET" <<'CHECK'
import math,sys
try: amount=float(sys.argv[1])
except ValueError: raise SystemExit('Budget must be positive and at most $2.50')
if not math.isfinite(amount) or not 0<amount<=2.50: raise SystemExit('Budget must be positive and at most $2.50')
CHECK
expected="$(git -C "$ROOT" show "$BASELINE_COMMIT:app/coach_chat.py" | sha256sum | cut -d' ' -f1)"
actual="$(sha256sum "$BASELINE" | cut -d' ' -f1)"
[[ "$expected" == "$actual" ]] || { echo "Baseline file does not match baseline commit's app/coach_chat.py." >&2; exit 2; }
if ((DRY_RUN == 0 && OFFLINE_SMOKE == 0)); then
  [[ -n "${GEMINI_API_KEY:-}" ]] && printenv GEMINI_API_KEY >/dev/null 2>&1 || {
    echo "Export GEMINI_API_KEY in the environment; never pass a key argument." >&2; exit 2
  }
fi

OUTPUT_DIR="$HOME/pigserver/backup/2026-11-kit-eval-v2"
mkdir -p "$OUTPUT_DIR"
chmod 700 "$OUTPUT_DIR"
OUTPUT="$OUTPUT_DIR/kit-gate-$(date -u +%Y%m%dT%H%M%SZ)-$$.json"
[[ ! -e "$OUTPUT" ]] || { echo "Refusing to overwrite an existing evaluation capture." >&2; exit 2; }
PROJECT="kt-kiteval-$$"
CONTAINER_OUTPUT_DIR="/tmp/kinetta-kiteval-$$"
CONTAINER_OUTPUT="$CONTAINER_OUTPUT_DIR/$(basename "$OUTPUT")"
COMPOSE=(docker compose --env-file /dev/null -f docker-compose.yml -f dev/tests/journeys-compose.yml -p "$PROJECT")
compose() { "${COMPOSE[@]}" "$@"; }
APP_STARTED=0
cleanup() {
  local status=$?
  trap - EXIT
  [[ -z "$CACHE_TEMP" ]] || rm -f "$CACHE_TEMP"
  if ((APP_STARTED == 1)) && compose exec -T app test -f "$CONTAINER_OUTPUT" >/dev/null 2>&1; then
    if compose cp "app:$CONTAINER_OUTPUT" "$OUTPUT" >/dev/null 2>&1; then
      chmod 600 "$OUTPUT"
      echo "Evaluation output copied to $OUTPUT" >&2
    elif ((status == 0)); then
      echo "Could not copy the private evaluation output back to the host." >&2
      status=1
    fi
  fi
  compose down --volumes --remove-orphans >/dev/null 2>&1 || true
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

cd "$ROOT"
running="$(docker ps --filter 'name=^kt-.*-app-1$' --format '{{.Names}}' | wc -l)"
if ((running >= 4)); then
  echo "Four disposable Kinetta test servers are already running; stop one before this evaluation." >&2
  exit 3
fi

# Never give the disposable app service provider credentials. Normal evaluation
# passes the exported key only to the one-shot evaluator process below.
if ! env -u GEMINI_API_KEY -u ANTHROPIC_API_KEY \
    KINETTA_AI_ENABLED=0 KINETTA_PORT=0 \
    "${COMPOSE[@]}" up -d --build app; then
  echo "Could not start the disposable evaluator app/database." >&2
  exit 1
fi
APP_STARTED=1

ready=0
for _ in $(seq 1 60); do
  if compose exec -T app python -c '
from app import db
with db.connect() as c:
    c.execute("SELECT 1")
' >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done
if ((ready == 0)); then
  echo "Disposable evaluator database did not become ready." >&2
  exit 1
fi

# The production image excludes dev/. Copy only the isolated evaluation sources.
compose exec -T -u 0 app mkdir -p /srv/dev/evals
for source in kit_eval.py kit_cases.py kit_weekly_fixtures.py kit_gate_cases.py kit_eval_support.py kit_gate_resume.py kit_setting_smoke.py test_kit_baseline_incontainer.py test_kit_smoke_budget_incontainer.py; do
  compose cp "$ROOT/dev/evals/$source" "app:/srv/dev/evals/$source"
done
compose cp "$BASELINE" app:/tmp/kit-eval-baseline-coach.py
compose exec -T app mkdir -m 700 -p "$CONTAINER_OUTPUT_DIR"
OPTIONS=(--gate --variant both --baseline /tmp/kit-eval-baseline-coach.py
  --baseline-commit "$BASELINE_COMMIT" --candidate-commit "$CANDIDATE_COMMIT"
  --budget-usd "$BUDGET" --output "$CONTAINER_OUTPUT")
if ((SETTING_SMOKE == 1)); then OPTIONS+=(--setting-smoke --smoke-thinking "$SMOKE_THINKING"); fi
if [[ -n "$GATE_RESUME" ]]; then
  compose cp "$GATE_RESUME" app:/tmp/kit-gate-resume.json
  OPTIONS+=(--resume /tmp/kit-gate-resume.json)
fi
if [[ -n "$REUSE_LOW" ]]; then
  CACHE_TEMP="$(mktemp)"
  rm -f "$CACHE_TEMP"
  python3 "$ROOT/dev/evals/kit_setting_smoke.py" --prepare-cache "$REUSE_LOW" --output "$CACHE_TEMP"
  compose cp "$CACHE_TEMP" app:/tmp/kit-low-cache.json
  OPTIONS+=(--baseline-results /tmp/kit-low-cache.json)
fi
if ((OFFLINE_SMOKE == 1 && SETTING_SMOKE == 1)); then
  compose cp "$ROOT/dev/evals/fixtures/kit-smoke3-nutrition.json" app:/tmp/kit-smoke3-fixtures.json
  compose exec -T -e PYTHONPATH=/srv -e KINETTA_KIT_EVAL_ISOLATED=1 app python /srv/dev/evals/test_kit_smoke_budget_incontainer.py
elif ((OFFLINE_SMOKE == 1)); then
  compose exec -T -e PYTHONPATH=/srv app python /srv/dev/evals/test_kit_baseline_incontainer.py \
    --baseline /tmp/kit-eval-baseline-coach.py --output "$CONTAINER_OUTPUT"
elif ((DRY_RUN == 1)); then
  compose exec -T -e PYTHONPATH=/srv app python /srv/dev/evals/kit_eval.py "${OPTIONS[@]}" --dry-run
else
  compose exec -T -e GEMINI_API_KEY -e PYTHONPATH=/srv \
    -e KINETTA_KIT_EVAL_ISOLATED=1 -e KINETTA_AI_ENABLED=1 -e KINETTA_KIT_ENABLED=1 \
    app python /srv/dev/evals/kit_eval.py "${OPTIONS[@]}" --accept-paid-calls
fi
