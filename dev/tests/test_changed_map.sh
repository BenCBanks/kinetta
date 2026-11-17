#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
python3 dev/tests/ui_contracts.py --validate
core_contracts="$(python3 dev/tests/ui_contracts.py --tests-for app/static/pages.js)"
for expected in activity_home_ui.cjs me_card_ui.cjs activity_detail_ui.cjs progress_ui.cjs fitness_ui.cjs track_home_ui.cjs tracking_ui.cjs; do
  [[ "$(printf '%s\n' "$core_contracts" | grep -Fx "$expected" || true)" == "$expected" ]] || { echo "pages.js does not schedule its $expected screen contract." >&2; exit 1; }
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
probe="$(mktemp app/static/.changed-map-untracked-probe.XXXXXX)"
if output="$(CHANGED_BASE=HEAD dev/tests/changed.sh --check-map 2>&1)"; then
  echo "An untracked app/static path was invisible to the changed-screen gate." >&2
  exit 1
fi
[[ "$output" == *"$probe"* ]] || { echo "The changed-screen gate missed an untracked path: $output" >&2; exit 1; }
rm -f "$probe" "$bad_manifest"; trap - EXIT
echo "Changed-screen map covers tracked paths/scenes and runs its mapped copy/selector contracts; missing tests and unknown/untracked screens fail."
