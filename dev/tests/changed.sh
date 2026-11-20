#!/usr/bin/env bash
# Run CI browser checks for changed app screens against the already-seeded fit-worktree server.
set -euo pipefail
cd "$(dirname "$0")/../.."
BASE="${CHANGED_BASE:-origin/main}"
group_order="core assets food social challenge-share activity-detail challenges track lift plan progress profile admin welcome hints community cards standalone"

caption_handoff_only() {
  local files expected patch edits line
  expected=$'app/static/challenges.js\napp/static/native.js\napp/static/share-art.js'
  files="$(git diff --name-only --no-renames "$BASE...HEAD" -- app/static | sort)"
  [[ "$files" == "$expected" ]] || return 1

  patch="$(git diff --unified=0 "$BASE...HEAD" -- app/static/native.js)"
  mapfile -t edits < <(grep -E '^[+-][^+-]' <<< "$patch" || true)
  [[ ${#edits[@]} -eq 2 && "${edits[0]}" == '-  N.shareActivityPicture = (image, destination, url = null) => P.KinettaActivityShare.share({image, destination, ...(url ? {url} : {})});' && "${edits[1]}" == '+  N.shareActivityPicture = (image, destination, url = null, caption = null) => P.KinettaActivityShare.share({image, destination, ...(url ? {url} : {}), ...(caption ? {caption} : {})});' ]] || return 1

  patch="$(git diff --unified=0 "$BASE...HEAD" -- app/static/share-art.js)"
  mapfile -t edits < <(grep -E '^[+-][^+-]' <<< "$patch" || true)
  [[ ${#edits[@]} -eq 6 ]] || return 1
  for line in "${edits[@]}"; do [[ "$line" =~ (deliver\(|Native\.shareActivityPicture|navigator\.share) ]] || return 1; done

  patch="$(git diff --unified=0 "$BASE...HEAD" -- app/static/challenges.js)"
  mapfile -t edits < <(grep -E '^[+-][^+-]' <<< "$patch" || true)
  [[ ${#edits[@]} -eq 5 ]] || return 1
  for line in "${edits[@]}"; do [[ "$line" =~ (invitationCaption|ShareArt\.deliver|return\{create,createForm) ]] || return 1; done
}
caption_only=0
if caption_handoff_only; then caption_only=1; fi

detail_reaction_css_only() {
  local files path patch edits line added removed
  files="$(git diff --name-only --no-renames "$BASE...HEAD" -- app/static | sort)"
  [[ "$files" == $'app/static/activity-detail.css\napp/static/style.css' ]] || return 1
  for path in app/static/activity-detail.css app/static/style.css; do
    patch="$(git diff --unified=0 "$BASE...HEAD" -- "$path")"
    mapfile -t edits < <(grep -E '^[+-][^+-]' <<< "$patch" || true)
    [[ ${#edits[@]} -eq 5 ]] || return 1
    added=0; removed=0
    for line in "${edits[@]}"; do
      [[ "$line" =~ (detail-social:has\(\.emoji-reactions\)|t-row:has\(\.activity-reactions\)|t-soc:has\(\.activity-reactions\)) ]] || return 1
      [[ "$line" == +* ]] && added=$((added + 1))
      [[ "$line" == -* ]] && removed=$((removed + 1))
    done
    [[ "$path" == app/static/style.css && $removed -eq 5 && $added -eq 0 ]] || [[ "$path" == app/static/activity-detail.css && $added -eq 5 && $removed -eq 0 ]] || return 1
  done
}
detail_reaction_only=0
if detail_reaction_css_only; then detail_reaction_only=1; fi

login_css_only() {
  local files index_patch style_patch login_patch selector
  files="$(git diff --name-only --no-renames "$BASE...HEAD" -- app/static | sort)"
  [[ "$files" == $'app/static/index.html\napp/static/login.css\napp/static/style.css' ]] || return 1
  index_patch="$(git diff --unified=0 "$BASE...HEAD" -- app/static/index.html)"
  [[ "$(grep -E '^[+-][^+-]' <<< "$index_patch" | sed 's/^[+-]//' )" == '<link rel="stylesheet" href="/static/login.css?v=__ASSET_HASH__">' ]] || return 1
  style_patch="$(git diff --unified=0 "$BASE...HEAD" -- app/static/style.css)"
  login_patch="$(git diff --unified=0 "$BASE...HEAD" -- app/static/login.css)"
  for selector in '.login-recovery {' '.login-recovery a {' '.login-recovery-status:empty' '.login-new {'; do grep -Fq "$selector" <<< "$login_patch" || return 1; done
  for selector in '-.login-recovery, .enrollment-email-links' '-.login-recovery a, .enrollment-email-links a' '-.login-recovery-status:empty, .resend-status:empty' '-.login-new {'; do grep -Fq -- "$selector" <<< "$style_patch" || return 1; done
}
login_css_only_change=0
if login_css_only; then login_css_only_change=1; fi

map_path() {
  local path="$1" patterns pattern group scenes
  # Only these exact caption-forwarding hunks can use focused Activity coverage.
  if [[ "$caption_only" == 1 && ( "$path" == app/static/challenges.js || "$path" == app/static/native.js || "$path" == app/static/share-art.js ) ]]; then
    printf 'challenge-share|Activity\n'; return 0
  fi
  # Only the exact moved reaction selectors use focused Activity Detail coverage.
  if [[ "$detail_reaction_only" == 1 && ( "$path" == app/static/style.css || "$path" == app/static/activity-detail.css ) ]]; then
    printf 'activity-detail|Activity detail\n'; return 0
  fi
  if [[ "$login_css_only_change" == 1 && ( "$path" == app/static/index.html || "$path" == app/static/login.css || "$path" == app/static/style.css ) ]]; then
    printf 'welcome|\n'; return 0
  fi
  while IFS=';' read -r patterns group scenes; do
    IFS=',' read -ra candidates <<< "$patterns"
    for pattern in "${candidates[@]}"; do
      if [[ "$path" == $pattern ]]; then printf '%s|%s\n' "$group" "$scenes"; return 0; fi
    done
  done <<'MAP'
app/static/app.js,app/static/pages.js,app/static/index.html,app/static/boot.js,app/static/style.css,app/static/theme.css,app/static/fonts/*,app/static/appearance.js,app/static/back-navigation.js,app/static/keyboard.js,app/static/native.js,app/static/refresh.js,app/static/haptics.js,app/static/kit.js;core;all
app/static/paint-gate.*;core;Home,Progress
app/static/food*.js,app/static/thread*.js,app/static/cook.js,app/static/recipe-import.js,app/static/food-entry.css,app/static/food-route.css,app/static/nutrition.css,app/static/recipes-ui.css,app/static/insights-ui.css,app/static/vendor/zxing.min.js;food;Nutrition day,Add food,Recipes and foods,Nutrition Insights
app/static/social.js,app/static/social-data.js,app/static/activity-detail.*,app/static/activity-home.css,app/static/friends-ui.*,app/static/contacts-ui.*,app/static/challenges.*,app/static/challenge-public.js,app/static/media.js;social;Activity,Activity detail,Friends,Groups,Group create,Group empty roster,Group full roster,Invite acceptance,Activity photo viewer,Activity full map,Sharing & privacy
app/static/challenge-summary.js;challenges;Activity
app/static/track*.js,app/static/track-home.css,app/static/track-route.css,app/static/intervals.js,app/static/segments.js,app/static/maps.*,app/static/vendor/leaflet.*,app/static/vendor/protomaps-leaflet.js;track;Track ready,Activity detail,Activity full map
app/static/lift*.js,app/static/lift-ui.css,app/static/lift-route.css;lift;Lifting with sets,Lifting blank sets
app/static/plan*.js,app/static/plan-ui.css,app/static/planner.js;plan;Me,Me Today plan,Track ready
app/static/discovery.js,app/static/heatmap-ui.css,app/static/milestones.*,app/static/recaps*,app/static/recap-editor.js,app/static/progress-routes.js,app/static/progress-route.css,app/static/share-art.js;progress;Progress,Fitness,Share progress
app/static/profile.*,app/static/notifications-ui.css,app/static/password-visibility.*,app/static/push-invitation.js,app/static/social-notifications.js;profile;Me,Settings,Notifications
app/static/settings-route.js;profile;Settings
app/static/admin*,app/static/feature-usage.js;admin;
app/static/welcome.js,app/static/onboarding.js,app/static/username-availability.*,app/static/email-account.*,app/static/login.css;welcome;
app/static/explore.js,app/static/guide-ui.css;hints;
app/static/community-terms.*;community;
app/static/cards.*,app/static/card-public.js,app/static/vendor/qrcode.js;cards;Me,Share card choices,Public link confirmation
app/static/standalone.css;standalone;
app/static/sw.js,app/static/manifest.webmanifest,app/static/favicon.svg,app/static/icon*,app/static/logo*,app/static/mark.svg,app/static/vendor/*LICENSE,app/static/vendor/*notices.txt;assets;
MAP
  return 1
}

check_paths() {
  local path mapped group scenes name contract_tests
  local scene_names=""
  for path in "$@"; do
    [[ "$path" == app/static/* ]] || continue
    if ! mapped="$(map_path "$path")"; then echo "No changed-screen browser mapping for $path" >&2; return 1; fi
    group="${mapped%%|*}"; scenes="${mapped#*|}"
    [[ " ${group_order:-core assets food social track lift plan progress profile admin welcome hints community cards standalone} " == *" $group "* ]] || { echo "No changed-screen dispatch for $path ($group)." >&2; return 1; }
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
  contract_tests="$(python3 dev/tests/ui_contracts.py --tests-for "$@")"
  if [[ -n "$contract_tests" ]]; then
    while IFS= read -r name; do [[ -z "$name" ]] || printf 'contract test -> %s\n' "$name"; done <<< "$contract_tests"
  fi
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
contract_output="$(python3 dev/tests/ui_contracts.py --tests-for "${paths[@]}")"
contract_tests=()
if [[ -n "$contract_output" ]]; then mapfile -t contract_tests <<< "$contract_output"; fi
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

declare -A ran_ui=()
run_ui() {
  [[ -z "${ran_ui[$1]:-}" ]] || return 0
  ran_ui["$1"]=1
  case "$1" in
    inline_reactions_ui.cjs) PHASE=after NODE_PATH="$browser" node "dev/tests/$1" ;;
    weight_progress_ui.cjs) PHASE=after NODE_PATH="$browser" node "dev/tests/$1" ;;
    *) NODE_PATH="$browser" node "dev/tests/$1" ;;
  esac
}
for group in $group_order; do
  [[ -n "${selected[$group]:-}" ]] || continue
  case "$group" in
    # lazy_route_ui covers Explore and logs in as a fictional user; seed it in Draft quick runs too.
    core) python3 dev/tests/explore_fixture.py ;;
    food) python3 dev/tests/food_memory_fixture.py ;;
    social) python3 dev/tests/inline_reactions_fixture.py ;;
    progress) python3 dev/tests/weight_progress_fixture.py ;;
    admin) python3 dev/tests/admin_features_fixture.py; python3 dev/tests/feature_collection_fixture.py ;;
    welcome) python3 dev/tests/signup_uniqueness_fixture.py ;;
    hints) python3 dev/tests/explore_fixture.py ;;
  esac
  tests=""
  case "$group" in
    core) tests="navigation_ui.cjs boot_ui.cjs shell_ui.cjs asset_cache_ui.cjs lazy_route_ui.cjs user_safe_errors_ui.cjs" ;;
    assets) tests="asset_cache_ui.cjs" ;;
    food) tests="food_entry_ui.cjs nutrition_ui.cjs nutrition_readout_ui.cjs food_memory_ui.cjs recipes_compact_ui.cjs insights_ui.cjs goals_ui.cjs" ;;
    social) tests="activity_home_ui.cjs test_weekly_recap.cjs activity_detail_ui.cjs edit_activity_ui.cjs media_routes_ui.cjs notification_edit_ui.cjs inline_reactions_ui.cjs inline_reactions_actions.cjs friends_ui.cjs groups_ui.cjs contacts_settings_ui.cjs contacts_ui.cjs back_navigation_ui.cjs" ;;
    activity-detail) tests="activity_detail_ui.cjs" ;;
    challenges) tests="activity_home_ui.cjs" ;;
    challenge-share) tests="activity_home_ui.cjs" ;;
    track) tests="track_home_ui.cjs track_review_recovery_ui.cjs top_chips_ui.cjs track_ready_map_ui.cjs interval_voice_ui.cjs map_ui.cjs tracking_ui.cjs edit_activity_ui.cjs map_feedback_ui.cjs" ;;
    lift) tests="lift_compact_ui.cjs lift_ui.cjs lift_lazy_route_ui.cjs" ;;
    plan) tests="plan_ui.cjs" ;;
    progress) tests="progress_ui.cjs fitness_ui.cjs heatmap_ui.cjs recaps_ui.cjs weight_progress_ui.cjs weight_progress_actions.cjs weight_progress_journeys.cjs weight_undo_ui.cjs profile_card_ui.cjs" ;;
    profile) tests="profile_card_ui.cjs me_card_ui.cjs personal_notifications_ui.cjs notification_settings_ui.cjs password_visibility_ui.cjs" ;;
    admin) tests="admin_features_ui.cjs feature_collection_ui.cjs"; node dev/tests/test_admin_logins.js; node dev/tests/test_admin_tools.js; node dev/tests/test_temporary_login.js ;;
    welcome) tests="signup_uniqueness_ui.cjs welcome_polish_ui.cjs" ;;
    hints) tests="explore_hints_ui.cjs" ;;
    cards) tests="profile_card_ui.cjs public_card_ui.cjs" ;;
    standalone) tests="garmin_connect_ui.cjs" ;;
    community) tests="community_ui.cjs" ;;
    *) echo "No changed-screen checks for group $group." >&2; exit 1 ;;
  esac
  for test in $tests; do run_ui "$test"; done
  if [[ "$group" == core ]]; then KINETTA_LOADING_SCREENS="Home,Progress,Nutrition day,Me" KINETTA_LOADING_THEMES="light,dark" NODE_PATH="$browser" node dev/tests/loading_audit.cjs; fi
done
for test in "${contract_tests[@]}"; do
  [[ -n "$test" ]] || continue
  echo "Running screen contract: $test"
  run_ui "$test"
done
echo "Native WebView layout remains a Ready-PR iPhone CI check for app/static changes (macOS Simulator)."
