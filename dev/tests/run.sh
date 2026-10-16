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

echo "== shared design tokens and contrast"
python3 dev/design/build_tokens.py --check
python3 dev/tests/test_design_manifest.py
python3 dev/design/build_content.py
python3 dev/tests/test_website_content.py
node dev/design/build_guide.js --check

echo "== syntax"
python3 -m py_compile app/*.py dev/demo/*.py dev/screenshots/*.py dev/tests/*.py
for f in app/static/*.js dev/screenshots/take.js; do node --check "$f"; done

echo "== native sync recovery (stand-in HealthKit, no health data)"
node dev/tests/test_track.js
node dev/tests/test_track_native.js
node dev/tests/test_native_sync.js
node dev/tests/test_native_resting.js
node dev/tests/test_social_gestures.js
node dev/tests/test_ui_state.js
node dev/tests/test_async_reads.js
node dev/tests/test_food_search.js
node dev/tests/test_food_remove.js
node dev/tests/test_feed_cache.js
node dev/tests/test_keyboard.js
node dev/tests/test_keyboard_nav.js

echo "== AI evaluation contracts (no model calls)"
python3 dev/evals/check.py

echo "== API"
cd dev/tests
for t in test_cooking test_meal_chat test_social test_search test_share test_fixes test_notify test_block test_fulldays test_plans test_cookchat test_weights test_account test_hardening test_photos test_lifts test_coach_tools test_profiles test_track test_health_details test_resting_energy; do python3 "$t.py"; done
cd ../..

echo "== in the app container"
docker compose -p "$P" exec -T app python - < dev/tests/incontainer.py
docker compose -p "$P" exec -T app python - < dev/tests/coach_incontainer.py
docker compose -p "$P" exec -T app python - < dev/tests/health_incontainer.py
docker compose -p "$P" exec -T app python - < dev/tests/resting_incontainer.py
docker compose -p "$P" exec -T app python - < dev/tests/native_push_incontainer.py
docker compose -p "$P" exec -T app python - < dev/tests/ai_access_incontainer.py
docker compose -p "$P" exec -T app python - < dev/tests/meal_chat_incontainer.py
docker compose -p "$P" exec -T app python - < dev/tests/test_admin_portal.py
docker compose -p "$P" exec -T app python - < dev/tests/test_photo_batches_corrections.py
echo "== all passed"
