#!/usr/bin/env bash
# Starts a fresh test app/database, injects the key only into the evaluator process,
# writes private output under pigserver/backup, and always tears down the Compose project.
set -euo pipefail
umask 077

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
THINKING=LOW
while (($#)); do
  case "$1" in
    --thinking)
      (($# >= 2)) || { echo "Usage: $0 [--thinking LOW|MEDIUM]" >&2; exit 2; }
      THINKING="$2"
      shift 2
      ;;
    --help|-h)
      echo "Usage: $0 [--thinking LOW|MEDIUM]"
      exit 0
      ;;
    *)
      echo "Usage: $0 [--thinking LOW|MEDIUM]" >&2
      exit 2
      ;;
  esac
done
[[ "$THINKING" == LOW || "$THINKING" == MEDIUM ]] || {
  echo "Thinking must be LOW or MEDIUM." >&2
  exit 2
}
[[ -n "${GEMINI_API_KEY:-}" ]] && printenv GEMINI_API_KEY >/dev/null 2>&1 || {
  echo "Export GEMINI_API_KEY in the environment; the key is never accepted as an argument." >&2
  exit 2
}

OUTPUT_DIR="$HOME/pigserver/backup/2026-11-kit-eval-v2"
mkdir -p "$OUTPUT_DIR"
chmod 700 "$OUTPUT_DIR"
OUTPUT="$OUTPUT_DIR/workout-review-$(date -u +%Y%m%dT%H%M%SZ)-$$.jsonl"
PROJECT="kt-wreval-$$"
COMPOSE=(docker compose --env-file /dev/null -f docker-compose.yml -f dev/tests/journeys-compose.yml -p "$PROJECT")
compose() { "${COMPOSE[@]}" "$@"; }
cleanup() { compose down --volumes --remove-orphans >/dev/null 2>&1 || true; }
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

cd "$ROOT"
running="$(docker ps --filter 'name=^kt-.*-app-1$' --format '{{.Names}}' | wc -l)"
if ((running >= 4)); then
  echo "Four disposable Kinetta test servers are already running; stop one before this evaluation." >&2
  exit 3
fi

# The app server starts without provider access or credentials. The key and opt-in
# flags are supplied only to the one-shot Python evaluator below.
if ! env -u GEMINI_API_KEY -u ANTHROPIC_API_KEY \
    KINETTA_AI_ENABLED=0 KINETTA_PORT=0 \
    "${COMPOSE[@]}" up -d --build app; then
  echo "Could not start the disposable evaluator app/database." >&2
  exit 1
fi

ready=0
for _ in $(seq 1 60); do
  if compose exec -T app python -c 'from app import db; c=db.connect(); c.execute("SELECT 1 FROM profile LIMIT 0"); c.close()' >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done
if ((ready == 0)); then
  echo "Disposable evaluator database did not become ready." >&2
  exit 1
fi

compose exec -T \
  -e GEMINI_API_KEY \
  -e KINETTA_WORKOUT_REVIEW_EVAL_ISOLATED=1 \
  -e KINETTA_AI_ENABLED=1 \
  -e KINETTA_KIT_ENABLED=1 \
  app python dev/evals/workout_review_eval.py \
  --thinking "$THINKING" --output "$OUTPUT" --accept-paid-calls
