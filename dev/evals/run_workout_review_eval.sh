#!/usr/bin/env bash
# Starts a fresh test app/database, injects the key only into the evaluator process,
# copies private output back before teardown, and always removes the Compose project.
set -euo pipefail
umask 077

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
THINKING=LOW
DRY_RUN=0
CASES=40
while (($#)); do
  case "$1" in
    --cases)
      (($# >= 2)) || { echo "--cases requires 20 or 40" >&2; exit 2; }
      CASES="$2"
      shift 2
      ;;
    --thinking)
      (($# >= 2)) || { echo "Usage: $0 [--thinking LOW|MEDIUM] [--cases 20|40] [--dry-run]" >&2; exit 2; }
      THINKING="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --help|-h)
      echo "Usage: $0 [--thinking LOW|MEDIUM] [--cases 20|40] [--dry-run]"
      exit 0
      ;;
    *)
      echo "Usage: $0 [--thinking LOW|MEDIUM] [--cases 20|40] [--dry-run]" >&2
      exit 2
      ;;
  esac
done
[[ "$THINKING" == LOW || "$THINKING" == MEDIUM ]] || {
  echo "Thinking must be LOW or MEDIUM." >&2
  exit 2
}
[[ "$CASES" == 20 || "$CASES" == 40 ]] || { echo "Cases must be 20 or 40." >&2; exit 2; }
SOURCE_COMMIT="$(git -C "$ROOT" rev-parse HEAD)"
if ! git -C "$ROOT" diff --quiet HEAD -- app dev/evals dev/tests/workout_review_fixtures.py; then
  echo "Commit the evaluated source before capturing gate evidence." >&2
  exit 2
fi
if ((DRY_RUN == 0)); then
  [[ -n "${GEMINI_API_KEY:-}" ]] && printenv GEMINI_API_KEY >/dev/null 2>&1 || {
    echo "Export GEMINI_API_KEY in the environment; the key is never accepted as an argument." >&2
    exit 2
  }
fi

OUTPUT_DIR="$HOME/pigserver/backup/2026-11-kit-eval-v2"
mkdir -p "$OUTPUT_DIR"
chmod 700 "$OUTPUT_DIR"
OUTPUT="$OUTPUT_DIR/workout-review-$(date -u +%Y%m%dT%H%M%SZ)-$$.jsonl"
[[ ! -e "$OUTPUT" ]] || { echo "Refusing to overwrite an existing evaluation capture." >&2; exit 2; }
PROJECT="kt-wreval-$$"
CONTAINER_OUTPUT_DIR="/tmp/kinetta-wreval-$$"
CONTAINER_OUTPUT="$CONTAINER_OUTPUT_DIR/$(basename "$OUTPUT")"
COMPOSE=(docker compose --env-file /dev/null -f docker-compose.yml -f dev/tests/journeys-compose.yml -p "$PROJECT")
compose() { "${COMPOSE[@]}" "$@"; }
APP_STARTED=0
cleanup() {
  local status=$?
  trap - EXIT
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

# The production image excludes dev/. Copy only this runner and its fictional fixtures.
compose exec -T -u 0 app mkdir -p /srv/dev/evals /srv/dev/tests
compose cp "$ROOT/dev/evals/workout_review_eval.py" app:/srv/dev/evals/workout_review_eval.py
compose cp "$ROOT/dev/tests/workout_review_fixtures.py" app:/srv/dev/tests/workout_review_fixtures.py
compose exec -T app mkdir -m 700 -p "$CONTAINER_OUTPUT_DIR"

if ((DRY_RUN == 1)); then
  # The evaluator runs its full selected-case expected-pass/distinctness preflight
  # before creating this dry-run header; paid and dry runs share that check.
  compose exec -T app python /srv/dev/evals/workout_review_eval.py \
    --thinking "$THINKING" --cases "$CASES" --source-commit "$SOURCE_COMMIT" --output "$CONTAINER_OUTPUT" --dry-run
else
  compose exec -T -e GEMINI_API_KEY \
    -e KINETTA_WORKOUT_REVIEW_EVAL_ISOLATED=1 \
    -e KINETTA_AI_ENABLED=1 \
    -e KINETTA_KIT_ENABLED=1 \
    app python /srv/dev/evals/workout_review_eval.py \
    --thinking "$THINKING" --cases "$CASES" --source-commit "$SOURCE_COMMIT" --output "$CONTAINER_OUTPUT" --accept-paid-calls
fi
