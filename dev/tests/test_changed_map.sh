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
