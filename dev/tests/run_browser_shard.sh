#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: run_browser_shard.sh 1|2|3|4" >&2
  exit 2
fi

case "$1" in
  1)
    node dev/tests/interval_voice_ui.cjs
    node dev/tests/navigation_ui.cjs
    node dev/tests/asset_cache_ui.cjs
    python3 dev/tests/explore_fixture.py
    node dev/tests/guide_ui.cjs
    node dev/tests/progress_ui.cjs
    node dev/tests/fitness_ui.cjs
    node dev/tests/heatmap_ui.cjs
    node dev/tests/profile_card_ui.cjs
    node dev/tests/nutrition_ui.cjs
    ;;
  2)
    node dev/tests/track_home_ui.cjs
    node dev/tests/top_chips_ui.cjs
    node dev/tests/track_ready_map_ui.cjs
    node dev/tests/activity_home_ui.cjs
    node dev/tests/food_entry_ui.cjs
    node dev/tests/food_removal_ui.cjs
    python3 dev/tests/food_memory_fixture.py
    node dev/tests/food_memory_ui.cjs
    node dev/tests/plan_ui.cjs
    node dev/tests/activity_detail_ui.cjs
    node dev/tests/notification_edit_ui.cjs
    node dev/tests/lift_compact_ui.cjs
    node dev/tests/lift_ui.cjs
    node dev/tests/recipes_compact_ui.cjs
    ;;
  3)
    node dev/tests/friends_ui.cjs
    node dev/tests/back_navigation_ui.cjs
    node dev/tests/personal_notifications_ui.cjs
    node dev/tests/notification_settings_ui.cjs
    node dev/tests/recaps_ui.cjs
    python3 dev/tests/insights_fixture.py
    node dev/tests/insights_ui.cjs
    node dev/tests/goals_ui.cjs
    ;;
  4)
    python3 dev/tests/weight_progress_fixture.py
    PHASE=after node dev/tests/weight_progress_ui.cjs
    PHASE=after W=330 ROOT=24 node dev/tests/weight_progress_ui.cjs
    node dev/tests/weight_progress_actions.cjs
    node dev/tests/weight_progress_journeys.cjs
    node dev/tests/weight_undo_ui.cjs
    python3 dev/tests/inline_reactions_fixture.py
    PHASE=after node dev/tests/inline_reactions_ui.cjs
    node dev/tests/inline_reactions_actions.cjs
    node dev/tests/shell_ui.cjs
    node dev/tests/password_visibility_ui.cjs
    python3 dev/tests/signup_uniqueness_fixture.py
    node dev/tests/signup_uniqueness_ui.cjs
    node dev/tests/welcome_polish_ui.cjs
    node dev/tests/community_ui.cjs
    python3 dev/tests/admin_features_fixture.py
    node dev/tests/admin_features_ui.cjs
    python3 dev/tests/feature_collection_fixture.py
    node dev/tests/feature_collection_ui.cjs
    export KINETTA_JOURNEY_DEADLINE_MS=$(( $(date +%s%3N) + 300000 ))
    timeout --kill-after=5s 300s bash -e -c '
      python3 dev/tests/journeys_prepare.py
      node dev/tests/journeys.cjs
      KINETTA_JOURNEY_CASE=activity-detail-back KINETTA_JOURNEY_THEME=dark KINETTA_JOURNEY_REPORT="/tmp/$KINETTA_PROJECT-journeys-dark-report.json" node dev/tests/journeys.cjs
      node dev/tests/links.cjs
    '
    ;;
  *)
    echo "Unknown browser shard: $1" >&2
    exit 2
    ;;
esac
