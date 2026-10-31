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
python3 dev/tests/test_ui_inventory.py
python3 dev/design/build_content.py
python3 dev/tests/test_website_content.py
python3 dev/tests/ai_fingerprints.py
node dev/design/build_guide.js --check

echo "== syntax"
python3 -m py_compile app/*.py dev/demo/*.py dev/screenshots/*.py dev/tests/*.py
for f in app/static/*.js dev/screenshots/take.js; do node --check "$f"; done

echo "== native sync recovery (stand-in HealthKit, no health data)"
python3 dev/tests/test_native_ui_lifecycle.py
node dev/tests/test_boot.js
node dev/tests/test_guide_visits.js

node dev/tests/test_progress_links.js
node dev/tests/test_energy_overview.js
node dev/tests/test_native_display.js
node --check dev/tests/navigation_ui.cjs
node --check dev/tests/boot_ui.cjs # real CSP/resource-failure checks run in the screenshot workflow
node dev/tests/test_enrollment_entry.js
node dev/tests/test_admin_logins.js
node dev/tests/test_admin_tools.js
node dev/tests/test_friend_management.js
node dev/tests/test_map_contract.js
node dev/tests/test_map_late_layers.js

node dev/tests/test_recaps.js
node --check dev/tests/recaps_ui.cjs
node dev/tests/test_milestones.js
node dev/tests/test_activity_milestone_loading.js
node dev/tests/test_activity_detail.js
node --check dev/tests/activity_detail_ui.cjs
node dev/tests/test_map_failure.js
node dev/tests/test_challenges.js
node dev/tests/test_join_context.js
node dev/tests/test_route_drafts.js
node dev/tests/test_segment_assistance_ui.js
node dev/tests/test_temporary_login.js
node dev/tests/test_plan_preparation.js
node --check dev/tests/plan_ui.cjs
node --check dev/tests/recipes_compact_ui.cjs
node dev/tests/test_track.js
node --check dev/tests/top_chips_ui.cjs
node dev/tests/test_track_review.js
node dev/tests/test_lift_summary.js
node dev/tests/test_lift_lifecycle.js
node --check dev/tests/lift_compact_ui.cjs
node --check dev/tests/lift_ui.cjs # rendered checks run in the screenshot workflow
node --check dev/tests/activity_ui.cjs
node --check dev/tests/edit_activity_ui.cjs # rendered checks run in the screenshot workflow
node --check dev/tests/tracking_ui.cjs
node --check dev/tests/track_ready_map_ui.cjs # rendered checks run in the screenshot workflow
node dev/tests/test_recipe_delete.js
node dev/tests/test_recipe_creation.js
node dev/tests/test_recipe_pending.js
node dev/tests/test_recipe_title_retry.js
node dev/tests/test_recipe_library_intent.js
node dev/tests/test_navigation_animation.js
node dev/tests/test_notification_rows.js
node dev/tests/test_personal_notifications_ui.js
node --check dev/tests/personal_notifications_ui.cjs
node --check dev/tests/me_card_ui.cjs # rendered checks run in the screenshot workflow
node --check dev/tests/progress_ui.cjs
node --check dev/tests/fitness_ui.cjs
node --check dev/tests/profile_card_ui.cjs # rendered checks run in the screenshot workflow
node --check dev/tests/public_card_ui.cjs
node --check dev/tests/goals_ui.cjs # rendered checks run in the screenshot workflow
node dev/tests/test_track_native.js
node dev/tests/test_recording_sharing.js
node dev/tests/test_activity_sharing.js
node dev/tests/test_stationary_summary.js
node dev/tests/test_map_fullscreen.js
node dev/tests/test_back_navigation.js
node dev/tests/test_back_navigation_dom.js
node dev/tests/test_friends_presentation.js
node --check dev/tests/friends_ui.cjs
node --check dev/tests/back_navigation_ui.cjs
node dev/tests/test_native_sync.js
node dev/tests/test_native_pictures.js
node dev/tests/test_share_photo.js
node dev/tests/test_push_invitation.js
node dev/tests/test_kit_chat_ui.js
node dev/tests/test_kit_memory_ui.js
node dev/tests/test_activity_sync_ui.js
python3 dev/tests/test_activity_food.py
python3 dev/tests/test_intervals.py
node dev/tests/test_interval_client.js
node --check dev/tests/interval_voice_ui.cjs
node dev/tests/test_combined_week_ui.js
node dev/tests/test_mileage_chart.js
node dev/tests/test_fitness_chart_controls.js
node dev/tests/test_prediction_help.js
python3 dev/tests/test_activity_chart.py

node dev/tests/test_workout_sync_status.js
node dev/tests/test_native_resting.js
node dev/tests/test_social_gestures.js
node dev/tests/test_reaction_picker.js
node dev/tests/test_social_data.js
node dev/tests/test_semantic_colours.js
node dev/tests/test_card_taps.js
node dev/tests/test_ui_state.js
node dev/tests/test_social_profiles_ui.js
node dev/tests/test_profile_layout.js
node dev/tests/test_onboarding.js
node dev/tests/test_welcome.js
node dev/tests/test_home_food.js
node dev/tests/test_yesterday_meal.js
node dev/tests/test_home_loading.js
node dev/tests/test_sheet_motion.js
node dev/tests/test_navigation.js
node dev/tests/test_settings_navigation.js
node dev/tests/test_ui_clarity.js
python3 dev/tests/test_food_thread_facts.py
python3 dev/tests/test_weekly_food_review.py
python3 dev/tests/test_recipe_link.py
node dev/tests/test_async_reads.js
node dev/tests/test_page_refresh.js
node dev/tests/test_food_refresh.js
node dev/tests/test_offline_queue.js
node dev/tests/test_client_uuid.js
node dev/tests/test_thread_outbox.js
node dev/tests/test_food_send_recovery.js
node dev/tests/test_food_chat_viewport.js
node dev/tests/test_food_review_strip.js
node --check dev/tests/food_entry_ui.cjs
node dev/tests/test_pending_food_nutrition.js
node dev/tests/test_thread_privacy.js
node dev/tests/test_quick_food_visit.js
node dev/tests/test_thread_nutrients.js
node dev/tests/test_extra_nutrients.js
node dev/tests/test_recent_nutrients.js
node dev/tests/test_shared_recipes.js
node dev/tests/test_health_food_client.js
node dev/tests/test_food_entry.js
node dev/tests/test_food_numbers_ui.js
node dev/tests/test_food_upload_undo.js
python3 dev/tests/test_food_number_parser.py
node dev/tests/test_meal_reminders_ui.js
python3 dev/tests/test_meal_reminder_times.py
node dev/tests/test_health_session.js
node dev/tests/test_weekly_food_review.js
node dev/tests/test_thread_sources.js
node dev/tests/test_food_search.js
node dev/tests/test_manual_food_form.js
node dev/tests/test_food_remove.js
node dev/tests/test_feed_cache.js
node dev/tests/test_keyboard.js
node dev/tests/test_keyboard_nav.js

echo "== AI evaluation contracts (no model calls)"
python3 dev/evals/check.py

echo "== API"
cd dev/tests
for t in test_food_thread_receipts test_expected_account test_food_history test_cooking test_unified_food test_meal_chat test_social test_search test_share test_fixes test_notify test_block test_fulldays test_plans test_cookchat test_weights test_account test_hardening test_photos test_lifts test_coach_tools test_profiles test_profile_layout test_profile_progress test_progress_overview test_chart_weeks test_track test_track_review test_interval_api test_phone_watch test_health_details test_add_map test_resting_energy test_onboarding test_food_thread test_food_thread_answers test_food_thread_log test_food_thread_phrasings test_food_thread_edit; do python3 "$t.py"; done
cd ../..

echo "== in the app container"
docker compose -p "$P" exec -T app python - < dev/tests/track_review_incontainer.py
docker compose -p "$P" exec -T app python - < dev/tests/friend_count_incontainer.py
docker compose -p "$P" exec -T app python - < dev/tests/retired_routes_incontainer.py
docker compose -p "$P" exec -T app python - < dev/tests/map_config_incontainer.py

docker compose -p "$P" exec -T app python - < dev/tests/recaps_incontainer.py
docker compose -p "$P" exec -T app python - < dev/tests/intervals_incontainer.py
docker compose -p "$P" exec -T app python - < dev/tests/incontainer.py
docker compose -p "$P" exec -T app python - < dev/tests/cook_clarification_incontainer.py
docker compose -p "$P" exec -T app python - < dev/tests/route_matching_incontainer.py
docker compose -p "$P" exec -T app python - < dev/tests/routes_segments_incontainer.py
docker compose -p "$P" exec -T app python - < dev/tests/route_paths_incontainer.py
docker compose -p "$P" exec -T app python - < dev/tests/segment_integrity_incontainer.py
docker compose -p "$P" exec -T app python - < dev/tests/route_sharing_incontainer.py
docker compose -p "$P" exec -T app python - < dev/tests/route_following_incontainer.py
docker compose -p "$P" exec -T app python - < dev/tests/race_predictions_incontainer.py
docker compose -p "$P" exec -T app python - < dev/tests/coach_incontainer.py
docker compose -p "$P" exec -T app python - < dev/tests/health_incontainer.py
docker compose -p "$P" exec -T app python - < dev/tests/resting_incontainer.py
docker compose -p "$P" exec -T app python - < dev/tests/garmin_connect_incontainer.py
docker compose -p "$P" exec -T app python - < dev/tests/native_push_incontainer.py
docker compose -p "$P" exec -T app python - < dev/tests/push_repair_incontainer.py
docker compose -p "$P" exec -T app python - < dev/tests/daily_goals_incontainer.py
docker compose -p "$P" exec -T app python - < dev/tests/ai_access_incontainer.py
docker compose -p "$P" exec -T app python - < dev/tests/meal_chat_incontainer.py
docker compose -p "$P" exec -T app python - < dev/tests/food_lookup_sizes_incontainer.py
docker compose -p "$P" exec -T app python - < dev/tests/test_admin_portal.py
docker compose -p "$P" exec -T app python - < dev/tests/test_account_email.py
docker compose -p "$P" exec -T app python - < dev/tests/test_signup.py
docker compose -p "$P" exec -T app python - < dev/tests/test_friend_links.py
docker compose -p "$P" exec -T app python - < dev/tests/test_admin_users.py

echo "== admin launch tools (fictional accounts, stand-in mail)"
docker compose -p "$P" exec -T app python - < dev/tests/test_admin_launch.py
docker compose -p "$P" exec -T app python - < dev/tests/test_admin_kit.py
docker compose -p "$P" exec -T app python - < dev/tests/test_request_log.py
docker compose -p "$P" exec -T app python - < dev/tests/test_devices.py
docker compose -p "$P" exec -T app python - < dev/tests/admin_usage_incontainer.py
docker compose -p "$P" exec -T app python - < dev/tests/reactions_incontainer.py
docker compose -p "$P" exec -T app python - < dev/tests/test_photo_batches_corrections.py
docker compose -p "$P" exec -T app python - < dev/tests/food_photo_context_incontainer.py
docker compose -p "$P" exec -T app python - < dev/tests/food_thread_incontainer.py
docker compose -p "$P" exec -T app python - < dev/tests/food_thread_facts_incontainer.py
docker compose -p "$P" exec -T app python - < dev/tests/food_thread_log_incontainer.py
docker compose -p "$P" exec -T app python - < dev/tests/food_thread_edit_incontainer.py
docker compose -p "$P" exec -T app python - < dev/tests/ai_budget_incontainer.py
docker compose -p "$P" exec -T app python - < dev/tests/ai_service_incontainer.py
docker compose -p "$P" exec -T app python - < dev/tests/food_thread_resolution_incontainer.py
docker compose -p "$P" exec -T app python - < dev/tests/food_chat_quality_incontainer.py
docker compose -p "$P" exec -T app python - < dev/tests/food_chat_understand_incontainer.py
docker compose -p "$P" exec -T app python - < dev/tests/food_entry_review_incontainer.py
docker compose -p "$P" exec -T app python - < dev/tests/pending_food_nutrition_incontainer.py
docker compose -p "$P" exec -T app python - < dev/tests/food_thread_resolution_sql.py
docker compose -p "$P" exec -T app python - < dev/tests/food_thread_receipts_incontainer.py
docker compose -p "$P" exec -T app python - < dev/tests/food_thread_kit_incontainer.py
docker compose -p "$P" exec -T app python - < dev/tests/food_thread_daily_incontainer.py
docker compose -p "$P" exec -T app python - < dev/tests/kit_incontainer.py
docker compose -p "$P" exec -T app python - < dev/tests/kit_visits_incontainer.py
docker compose -p "$P" exec -T app python - < dev/tests/kit_transport_incontainer.py
docker compose -p "$P" exec -T app python - < dev/tests/kit_release_incontainer.py
docker compose -p "$P" exec -T app python - < dev/tests/nutrition_copy_incontainer.py
docker compose -p "$P" exec -T app python - < dev/tests/nutrition_insights_incontainer.py
docker compose -p "$P" exec -T app python - < dev/tests/nutrition_checkin_incontainer.py
docker compose -p "$P" exec -T app python - < dev/tests/recipe_import_incontainer.py
docker compose -p "$P" exec -T app python - < dev/tests/recipe_review_incontainer.py
docker compose -p "$P" exec -T app python - < dev/tests/recipe_estimate_incontainer.py
docker compose -p "$P" exec -T app python - < dev/tests/recipe_imports_incontainer.py
docker compose -p "$P" exec -T app python - < dev/tests/recipe_portion_undo_incontainer.py
docker compose -p "$P" exec -T app python - < dev/tests/nutrients_source_incontainer.py
docker compose -p "$P" exec -T app python - < dev/tests/nutrients_api_incontainer.py
docker compose -p "$P" exec -T app python - < dev/tests/nutrients_pipeline_incontainer.py
docker compose -p "$P" exec -T app python - < dev/tests/nutrients_range_incontainer.py
docker compose -p "$P" exec -T app python - < dev/tests/weekly_food_review_incontainer.py
docker compose -p "$P" exec -T app python - < dev/tests/shared_recipes_incontainer.py
docker compose -p "$P" exec -T app python - < dev/tests/health_weights_incontainer.py
docker compose -p "$P" exec -T app python - < dev/tests/health_nutrition_incontainer.py
docker compose -p "$P" exec -T app python - < dev/tests/meal_reminders_incontainer.py
docker compose -p "$P" exec -T app python - < dev/tests/personal_notifications_incontainer.py
docker compose -p "$P" exec -T app python - < dev/tests/food_numbers_incontainer.py
docker compose -p "$P" exec -T app python - < dev/tests/food_upload_undo_incontainer.py

docker compose -p "$P" exec -T app python - < dev/tests/activity_food_incontainer.py
docker compose -p "$P" exec -T app python - < dev/tests/health_weight_review_incontainer.py
docker compose -p "$P" exec -T app python - < dev/tests/recipe_review_regressions_incontainer.py
echo "== separate recipe creation and explicit portions"
docker compose -p "$P" exec -T app python - < dev/tests/recipe_creation_incontainer.py
echo "== public card privacy, signup and requests"
docker compose -p "$P" exec -T app python - < dev/tests/cards_incontainer.py


echo "== stationary ride charts and HR sharing"
docker compose -p "$P" exec -T app python - < dev/tests/stationary_charts_incontainer.py
echo "== private milestones, silent imports and notification boundaries"
docker compose -p "$P" exec -T app python - < dev/tests/milestones_incontainer.py

echo "== aggregate challenge privacy and lifecycle"
docker compose -p "$P" exec -T app python - < dev/tests/challenges_incontainer.py

echo "== all passed"
