#!/usr/bin/env bash
# Run CI browser checks for changed app screens against the already-seeded fit-worktree server.
set -euo pipefail
cd "$(dirname "$0")/../.."
BASE="${CHANGED_BASE:-origin/main}"
group_order="core assets food social track lift plan progress profile admin welcome guide community cards standalone"

map_path() {
  local path="$1" patterns pattern group scenes
  while IFS=';' read -r patterns group scenes; do
    IFS=',' read -ra candidates <<< "$patterns"
    for pattern in "${candidates[@]}"; do
      if [[ "$path" == $pattern ]]; then printf '%s|%s\n' "$group" "$scenes"; return 0; fi
    done
  done <<'MAP'
app/static/app.js,app/static/pages.js,app/static/index.html,app/static/boot.js,app/static/style.css,app/static/theme.css,app/static/fonts/*,app/static/appearance.js,app/static/back-navigation.js,app/static/keyboard.js,app/static/native.js,app/static/refresh.js,app/static/haptics.js,app/static/kit.js;core;all
app/static/food*.js,app/static/thread*.js,app/static/cook.js,app/static/recipe-import.js,app/static/food-entry.css,app/static/nutrition.css,app/static/recipes-ui.css,app/static/insights-ui.css,app/static/vendor/zxing.min.js;food;Nutrition day,Add food,Recipes and foods,Nutrition Insights
app/static/social.js,app/static/social-data.js,app/static/activity-detail.*,app/static/activity-home.css,app/static/friends-ui.*,app/static/challenges.*,app/static/challenge-public.js,app/static/media.js;social;Activity,Activity detail,Friends,Activity photo viewer,Activity full map
app/static/track*.js,app/static/track-home.css,app/static/intervals.js,app/static/segments.js,app/static/maps.*,app/static/vendor/leaflet.*,app/static/vendor/protomaps-leaflet.js;track;Track ready,Activity detail,Activity full map
app/static/lift*.js,app/static/lift-ui.css;lift;Lifting with sets,Lifting blank sets
app/static/plan*.js,app/static/plan-ui.css,app/static/planner.js;plan;Me,Me Today plan,Track ready
app/static/discovery.js,app/static/heatmap-ui.css,app/static/milestones.*,app/static/recaps*;progress;Progress,Fitness,Share progress
app/static/profile.*,app/static/notifications-ui.css,app/static/password-visibility.*,app/static/push-invitation.js,app/static/social-notifications.js;profile;Me,Settings,Notifications
app/static/admin*,app/static/feature-usage.js;admin;
app/static/welcome.js,app/static/onboarding.js,app/static/username-availability.*;welcome;
app/static/explore.js,app/static/guide-ui.css;guide;
app/static/community-terms.*;community;
app/static/cards.*,app/static/card-public.js,app/static/vendor/qrcode.js;cards;Me,Public link confirmation
app/static/standalone.css;standalone;
app/static/sw.js,app/static/manifest.webmanifest,app/static/favicon.svg,app/static/icon*,app/static/logo*,app/static/mark.svg,app/static/vendor/*LICENSE,app/static/vendor/*notices.txt;assets;
MAP
  return 1
}

check_paths() {
  local path mapped group scenes name
  local scene_names=""
  for path in "$@"; do
    [[ "$path" == app/static/* ]] || continue
    if ! mapped="$(map_path "$path")"; then echo "No changed-screen browser mapping for $path" >&2; return 1; fi
    group="${mapped%%|*}"; scenes="${mapped#*|}"
    [[ " ${group_order:-core assets food social track lift plan progress profile admin welcome guide community cards standalone} " == *" $group "* ]] || { echo "No changed-screen dispatch for $path ($group)." >&2; return 1; }
    if [[ -n "$scenes" && "$scenes" != all ]]; then
      IFS=',' read -ra names <<< "$scenes"
      for name in "${names[@]}"; do [[ ",$scene_names," == *",$name,"* ]] || scene_names="${scene_names:+$scene_names,}$name"; done
    fi
    printf '%s -> %s\n' "$path" "$group"
  done
  [[ -z "$scene_names" ]] || node - "$scene_names" <<'NODE'
const requested=process.argv[2].split(',');
const known=new Set(require('./dev/tests/spacing_screens.cjs').scenes({detail:{run:1},lift:{live:2,fresh_live:3}}).map(scene=>scene.name));
const missing=requested.filter(name=>!known.has(name));
if(missing.length){console.error('Unknown spacing scenes: '+missing.join(', '));process.exit(1);}
NODE
}

case "${1:-}" in
  --check-files) shift; check_paths "$@"; exit ;;
  --check-map) [[ $# -eq 1 ]] || { echo "Usage: changed.sh --check-map" >&2; exit 2; } ;;
  "") ;;
  *) echo "Usage: changed.sh [--check-map|--check-files path ...]" >&2; exit 2 ;;
esac
git rev-parse --verify "$BASE" >/dev/null || { echo "Missing $BASE; fetch origin main before checking changed screens." >&2; exit 2; }
changed="$( { git diff --name-only --no-renames "$BASE...HEAD"; git diff --name-only --no-renames HEAD; git diff --name-only --cached --no-renames; git ls-files --others --exclude-standard; } | sort -u )"
[[ -n "$changed" ]] || { echo "No changes from $BASE."; exit 0; }
mapfile -t paths <<< "$changed"
if [[ "${1:-}" == --check-map ]]; then check_paths "${paths[@]}"; echo "Changed app/static paths are mapped."; exit 0; fi

declare -A selected=() seen_scene=()
scenes=""; all_scenes=0; has_static=0
for path in "${paths[@]}"; do
  [[ "$path" == app/static/* ]] || continue
  has_static=1
  mapped="$(map_path "$path")" || { echo "No changed-screen browser mapping for $path" >&2; exit 1; }
  group="${mapped%%|*}"; group_scenes="${mapped#*|}"
  selected["$group"]=1
  if [[ "$group_scenes" == all ]]; then all_scenes=1
  elif [[ -n "$group_scenes" ]]; then
    IFS=',' read -ra scene_list <<< "$group_scenes"
    for scene in "${scene_list[@]}"; do
      [[ -n "${seen_scene[$scene]:-}" ]] && continue
      seen_scene["$scene"]=1; scenes="${scenes:+$scenes,}$scene"
    done
  fi
done
[[ $has_static == 1 ]] || { echo "No changed app/static screens; browser checks skipped."; exit 0; }

export KINETTA_URL="${KINETTA_URL:-http://localhost:8798}"
export KINETTA_PROJECT="${KINETTA_PROJECT:-kinettatest}"
export TZ="${TZ:-America/New_York}"
browser="${PLAYWRIGHT_NODE_MODULES:-$PWD/dev/tests/browser/node_modules}"
if ! NODE_PATH="$browser" node -e "require('playwright')" >/dev/null 2>&1; then npm ci --prefix "${browser%/node_modules}"; fi
if [[ -n "${PLAYWRIGHT_BROWSERS_PATH:-}" ]]; then "$browser/.bin/playwright" install chromium; else "$browser/.bin/playwright" install --with-deps chromium; fi

if [[ $all_scenes == 1 || -n "$scenes" ]]; then
  audit_tmp="$(mktemp -d /tmp/kinetta-changed-screens.XXXXXX)"
  trap 'result=$?; if [[ $result -eq 0 ]]; then rm -rf "$audit_tmp"; else echo "Changed-screen spacing evidence: $audit_tmp" >&2; fi; exit "$result"' EXIT
  export KINETTA_SPACING_FIXTURES="$audit_tmp/fixtures.json"
  export KINETTA_SPACING_REPORT="$audit_tmp/report.json"
  python3 dev/tests/spacing_prepare.py
  node dev/tests/test_spacing_geometry.cjs
  NODE_PATH="$browser" node dev/tests/test_spacing_dom.cjs
  if [[ $all_scenes == 1 ]]; then
    unset KINETTA_SPACING_SCREENS
    NODE_PATH="$browser" node dev/tests/spacing_audit.cjs
  else
    KINETTA_SPACING_SCREENS="$scenes" NODE_PATH="$browser" node dev/tests/spacing_audit.cjs
  fi
fi

run_ui() {
  case "$1" in
    inline_reactions_ui.cjs) PHASE=after NODE_PATH="$browser" node "dev/tests/$1" ;;
    weight_progress_ui.cjs) PHASE=after NODE_PATH="$browser" node "dev/tests/$1" ;;
    *) NODE_PATH="$browser" node "dev/tests/$1" ;;
  esac
}
for group in $group_order; do
  [[ -n "${selected[$group]:-}" ]] || continue
  case "$group" in
    food) python3 dev/tests/food_memory_fixture.py ;;
    social) python3 dev/tests/inline_reactions_fixture.py ;;
    progress) python3 dev/tests/weight_progress_fixture.py ;;
    admin) python3 dev/tests/admin_features_fixture.py; python3 dev/tests/feature_collection_fixture.py ;;
    welcome) python3 dev/tests/signup_uniqueness_fixture.py ;;
    guide) python3 dev/tests/explore_fixture.py ;;
  esac
  tests=""
  case "$group" in
    core) tests="navigation_ui.cjs boot_ui.cjs shell_ui.cjs asset_cache_ui.cjs" ;;
    assets) tests="asset_cache_ui.cjs" ;;
    food) tests="food_entry_ui.cjs nutrition_ui.cjs food_memory_ui.cjs recipes_compact_ui.cjs insights_ui.cjs goals_ui.cjs" ;;
    social) tests="activity_home_ui.cjs activity_detail_ui.cjs notification_edit_ui.cjs inline_reactions_ui.cjs inline_reactions_actions.cjs friends_ui.cjs back_navigation_ui.cjs" ;;
    track) tests="track_home_ui.cjs top_chips_ui.cjs track_ready_map_ui.cjs interval_voice_ui.cjs map_ui.cjs tracking_ui.cjs edit_activity_ui.cjs map_feedback_ui.cjs" ;;
    lift) tests="lift_compact_ui.cjs lift_ui.cjs" ;;
    plan) tests="plan_ui.cjs" ;;
    progress) tests="progress_ui.cjs fitness_ui.cjs heatmap_ui.cjs recaps_ui.cjs weight_progress_ui.cjs weight_progress_actions.cjs weight_progress_journeys.cjs weight_undo_ui.cjs profile_card_ui.cjs" ;;
    profile) tests="profile_card_ui.cjs me_card_ui.cjs personal_notifications_ui.cjs notification_settings_ui.cjs password_visibility_ui.cjs" ;;
    admin) tests="admin_features_ui.cjs feature_collection_ui.cjs"; node dev/tests/test_admin_logins.js; node dev/tests/test_admin_tools.js; node dev/tests/test_temporary_login.js ;;
    welcome) tests="signup_uniqueness_ui.cjs welcome_polish_ui.cjs" ;;
    guide) tests="guide_ui.cjs" ;;
    cards) tests="profile_card_ui.cjs public_card_ui.cjs" ;;
    standalone) tests="garmin_connect_ui.cjs" ;;
    community) tests="community_ui.cjs" ;;
    *) echo "No changed-screen checks for group $group." >&2; exit 1 ;;
  esac
  for test in $tests; do run_ui "$test"; done
done
echo "Native WebView layout remains a Ready-PR iPhone CI check for app/static changes (macOS Simulator)."
