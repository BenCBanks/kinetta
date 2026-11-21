#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
python3 dev/tests/ui_contracts.py --validate
core_contracts="$(python3 dev/tests/ui_contracts.py --tests-for app/static/pages.js)"
core_dispatch="$(dev/tests/changed.sh --check-files app/static/pages.js)"
for expected in activity_home_ui.cjs me_card_ui.cjs activity_detail_ui.cjs progress_ui.cjs fitness_ui.cjs track_home_ui.cjs tracking_ui.cjs; do
  [[ "$(printf '%s\n' "$core_contracts" | grep -Fx "$expected" || true)" == "$expected" ]] || { echo "pages.js does not schedule its $expected screen contract." >&2; exit 1; }
  [[ "$core_dispatch" == *"contract test -> $expected"* ]] || { echo "The changed-screen runner would omit $expected for pages.js." >&2; exit 1; }
done
bad_manifest="$(mktemp)"
trap 'rm -f "${probe:-}" "$bad_manifest"' EXIT
cat > "$bad_manifest" <<'JSON'
{"contracts":[{"screen":"Broken test map","sources":["app/static/pages.js"],"tests":["missing_screen_contract_ui.cjs"],"assertions":["visible copy"]}]}
JSON
if python3 dev/tests/ui_contracts.py --validate --manifest "$bad_manifest" >/dev/null 2>&1; then
  echo "A mapped but missing screen contract test passed validation." >&2
  exit 1
fi
mapfile -t files < <(git ls-files app/static)
dev/tests/changed.sh --check-files "${files[@]}" >/dev/null
python3 - <<'PY'
from pathlib import Path
root=Path('app/static')
retired=('lift-ui.css','track-home.css')
for name in retired:
    assert not (root/name).exists(), f'{name} is retained only as a dead stylesheet'
for path in root.rglob('*'):
    if path.suffix not in {'.html','.js','.css'} or not path.is_file():
        continue
    text=path.read_text(errors='ignore')
    for name in retired:
        assert name not in text, f'{path} still refers to retired stylesheet {name}'
PY
if dev/tests/changed.sh --check-files app/static/new-unmapped-screen.js >/dev/null 2>&1; then
  echo "An unmapped app/static path passed the changed-screen gate." >&2
  exit 1
fi
for mapping in 'explore.js:hints' 'username-availability.css:welcome' 'cards.css:cards' 'milestones.js:progress' 'progress-routes.js:progress' 'fonts/source-serif-4.woff2:core' 'standalone.css:standalone'; do
  path="app/static/${mapping%%:*}"; group="${mapping#*:}"
  output="$(dev/tests/changed.sh --check-files "$path")"
  [[ "$output" == *"-> $group"* ]] || { echo "$path did not select $group." >&2; exit 1; }
done
caption_map="$(CHANGED_BASE=origin/main dev/tests/changed.sh --check-files app/static/challenges.js app/static/native.js app/static/share-art.js)"
if [[ "$caption_map" == *"app/static/native.js -> challenge-share"* ]]; then
  for path in app/static/challenges.js app/static/native.js app/static/share-art.js; do
    [[ "$caption_map" == *"$path -> challenge-share"* ]] || { echo "Caption-only handoff did not use focused changed-screen coverage for $path." >&2; exit 1; }
  done
  for broad in '-> core' '-> social' '-> progress'; do
    [[ "$caption_map" != *"$broad"* ]] || { echo "Caption-only handoff selected unrelated broad suite $broad." >&2; exit 1; }
  done
fi
if [[ -n "${GITHUB_BASE_REF:-}" ]]; then
  base_ref="origin/$GITHUB_BASE_REF"
  if git rev-parse --verify "$base_ref" >/dev/null 2>&1; then
    detail_files="$(git diff --name-only --no-renames "$base_ref...HEAD" -- app/static | sort)"
    if [[ "$detail_files" == $'app/static/activity-detail.css\napp/static/style.css' ]]; then
      detail_patch="$(git diff --unified=0 "$base_ref...HEAD" -- app/static/activity-detail.css app/static/style.css)"
      # This focused mapping applies only to the mechanical reaction-CSS move.
      if grep -Fq 'detail-social:has(.emoji-reactions)' <<< "$detail_patch" && grep -Fq 't-soc:has(.activity-reactions)' <<< "$detail_patch"; then
        detail_map="$(CHANGED_BASE="$base_ref" dev/tests/changed.sh --check-files app/static/activity-detail.css app/static/style.css)"
        [[ "$detail_map" == *"app/static/activity-detail.css -> activity-detail"* && "$detail_map" == *"app/static/style.css -> activity-detail"* ]] || { echo "Detail-only reaction CSS uses its focused Activity Detail mapping: $detail_map" >&2; exit 1; }
      fi
    fi
    login_files="$(git diff --name-only --no-renames "$base_ref...HEAD" -- app/static | sort)"
    if [[ "$login_files" == $'app/static/index.html\napp/static/login.css\napp/static/style.css' ]]; then
      login_patch="$(git diff --unified=0 "$base_ref...HEAD" -- app/static/login.css app/static/style.css app/static/index.html)"
      if grep -Fq '+.login-recovery {' <<< "$login_patch" && grep -Fq -- '-.login-recovery, .enrollment-email-links' <<< "$login_patch"; then
        login_map="$(CHANGED_BASE="$base_ref" dev/tests/changed.sh --check-files app/static/index.html app/static/login.css app/static/style.css)"
        for path in app/static/index.html app/static/login.css app/static/style.css; do
          [[ "$login_map" == *"$path -> welcome"* ]] || { echo "Login-only CSS move uses focused sign-in coverage for $path: $login_map" >&2; exit 1; }
        done
        [[ "$login_map" != *'-> core'* ]] || { echo "Login-only CSS move selected unrelated core coverage: $login_map" >&2; exit 1; }
      fi
    fi
    me_tools_files="$(git diff --name-only --no-renames "$base_ref...HEAD" -- app/static | sort)"
    if [[ "$me_tools_files" == $'app/static/profile.css\napp/static/style.css' ]]; then
      me_tools_patch="$(git diff --unified=0 "$base_ref...HEAD" -- app/static/profile.css app/static/style.css)"
      if grep -Fq '+.me-tools,.me-help-tools {' <<< "$me_tools_patch" && grep -Fq -- '-.me-tools,.me-help-tools {' <<< "$me_tools_patch"; then
        me_tools_map="$(CHANGED_BASE="$base_ref" dev/tests/changed.sh --check-files app/static/profile.css app/static/style.css)"
        for path in app/static/profile.css app/static/style.css; do
          [[ "$me_tools_map" == *"$path -> profile"* ]] || { echo "Me-tools-only CSS move uses focused profile coverage for $path: $me_tools_map" >&2; exit 1; }
        done
        [[ "$me_tools_map" != *'-> core'* ]] || { echo "Me-tools-only CSS move selected unrelated core coverage: $me_tools_map" >&2; exit 1; }
      fi
    fi
    food_css_files="$(git diff --name-only --no-renames "$base_ref...HEAD" -- app/static | sort)"
    if [[ "$food_css_files" == $'app/static/food.css\napp/static/index.html\napp/static/style.css' ]]; then
      food_css_patch="$(git diff --unified=0 "$base_ref...HEAD" -- app/static/food.css app/static/index.html app/static/style.css)"
      food_style_removed="$(git diff --unified=0 "$base_ref...HEAD" -- app/static/style.css | grep -E '^-[^-]' | sed 's/^-//' || true)"
      food_file_added="$(git diff --unified=0 "$base_ref...HEAD" -- app/static/food.css | grep -E '^[+][^+]' | sed 's/^+//' || true)"
      if [[ -n "$food_style_removed" && "$food_style_removed" == "$food_file_added" ]] && grep -Fq '+<link rel="stylesheet" href="/static/food.css?v=__ASSET_HASH__">' <<< "$food_css_patch"; then
        food_css_map="$(CHANGED_BASE="$base_ref" dev/tests/changed.sh --check-files app/static/food.css app/static/index.html app/static/style.css)"
        for path in app/static/food.css app/static/index.html app/static/style.css; do
          [[ "$food_css_map" == *"$path -> food"* ]] || { echo "Pure Food CSS extraction should use Food-only coverage for $path: $food_css_map" >&2; exit 1; }
        done
        [[ "$food_css_map" != *'-> core'* ]] || { echo "Pure Food CSS extraction selected unrelated core coverage: $food_css_map" >&2; exit 1; }
      fi
    fi
    activity_import_files="$(git diff --name-only --no-renames "$base_ref...HEAD" -- app/static | sort)"
    if [[ "$activity_import_files" == $'app/static/activity-import.css\napp/static/index.html\napp/static/style.css' ]]; then
      activity_import_patch="$(git diff --unified=0 "$base_ref...HEAD" -- app/static/activity-import.css app/static/index.html app/static/style.css)"
      activity_style_removed="$(git diff --unified=0 "$base_ref...HEAD" -- app/static/style.css | grep -E '^-[^-]' | sed 's/^-//' || true)"
      activity_file_added="$(git diff --unified=0 "$base_ref...HEAD" -- app/static/activity-import.css | grep -E '^[+][^+]' | sed 's/^+//' || true)"
      if [[ -n "$activity_style_removed" && "$activity_style_removed" == "$activity_file_added" ]] && grep -Fq '+<link rel="stylesheet" href="/static/activity-import.css?v=__ASSET_HASH__">' <<< "$activity_import_patch"; then
        activity_import_map="$(CHANGED_BASE="$base_ref" dev/tests/changed.sh --check-files app/static/activity-import.css app/static/index.html app/static/style.css)"
        for path in app/static/activity-import.css app/static/index.html app/static/style.css; do
          [[ "$activity_import_map" == *"$path -> track"* ]] || { echo "Pure Activity import CSS extraction should use Track-only coverage for $path: $activity_import_map" >&2; exit 1; }
        done
        [[ "$activity_import_map" != *'-> core'* ]] || { echo "Activity import CSS extraction selected unrelated core coverage: $activity_import_map" >&2; exit 1; }
      fi
    fi
    detail_map="$(CHANGED_BASE="$base_ref" dev/tests/changed.sh --check-files app/static/activity-detail.css app/static/style.css)"
    if [[ "$detail_map" == *"app/static/activity-detail.css -> activity-detail"* ]]; then
      [[ "$detail_map" == *"app/static/style.css -> activity-detail"* ]] || { echo "Detail-only reaction CSS lost its focused Activity Detail mapping: $detail_map" >&2; exit 1; }
    else
      [[ "$detail_map" == *"app/static/activity-detail.css -> social"* && "$detail_map" == *"app/static/style.css -> core"* ]] || { echo "Combined Activity Detail CSS did not select its broader Social mapping: $detail_map" >&2; exit 1; }
    fi
  elif [[ "$(git rev-parse --is-shallow-repository)" == true ]]; then
    echo "Skipping stacked-base diff assertion in shallow backend checkout; changed-screen-map checks the full PR diff."
  else
    echo "Expected base ref $base_ref is missing from a complete checkout." >&2
    exit 1
  fi
fi
native_fallback="$(CHANGED_BASE=HEAD dev/tests/changed.sh --check-files app/static/native.js)"
[[ "$native_fallback" == *"app/static/native.js -> core"* ]] || { echo "A general Native bridge change lost its broad core mapping." >&2; exit 1; }
probe="$(mktemp app/static/.changed-map-untracked-probe.XXXXXX)"
if output="$(CHANGED_BASE=HEAD dev/tests/changed.sh --check-map 2>&1)"; then
  echo "An untracked app/static path was invisible to the changed-screen gate." >&2
  exit 1
fi
[[ "$output" == *"$probe"* ]] || { echo "The changed-screen gate missed an untracked path: $output" >&2; exit 1; }
rm -f "$probe" "$bad_manifest"; trap - EXIT
echo "Changed-screen map covers tracked paths/scenes and runs its mapped copy/selector contracts; missing tests and unknown/untracked screens fail."
