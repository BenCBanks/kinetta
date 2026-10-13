#!/usr/bin/env bash
# Kinetta's test suite (made-up data, a throwaway copy only). Expects the app at $KINETTA_URL (default :8798), started
# by docker compose project $KINETTA_PROJECT (default "kinettatest") with GEMINI_API_KEY set to any placeholder, and the
# demo data loaded (dev/demo/seed.py, then dev/screenshots/stage.py). .github/workflows/tests.yml does all of that.
# Locally:
#   GEMINI_API_KEY=placeholder KINETTA_PORT=8798 docker compose -p kinettatest up -d --build
#   python3 dev/demo/gen_gpx.py /tmp/gpx 120 && KINETTA_URL=http://localhost:8798 python3 dev/demo/seed.py /tmp/gpx
#   KINETTA_URL=http://localhost:8798 python3 dev/screenshots/stage.py /tmp/gpx
#   dev/tests/run.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
export KINETTA_URL="${KINETTA_URL:-http://localhost:8798}"
P="${KINETTA_PROJECT:-kinettatest}"

echo "== syntax"
python3 -m py_compile app/*.py dev/demo/*.py dev/screenshots/*.py dev/tests/*.py
for f in app/static/*.js dev/screenshots/take.js; do node --check "$f"; done

echo "== native sync recovery (stand-in HealthKit, no health data)"
node dev/tests/test_native_sync.js
node dev/tests/test_ui_state.js

echo "== API"
cd dev/tests
for t in test_cooking test_social test_search test_share test_fixes test_notify test_block test_fulldays test_plans test_cookchat test_weights test_account test_hardening test_photos test_lifts; do python3 "$t.py"; done
cd ../..

echo "== in the app container"
docker compose -p "$P" exec -T app python - < dev/tests/incontainer.py
echo "== all passed"
