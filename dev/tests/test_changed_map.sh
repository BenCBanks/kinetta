#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
mapfile -t files < <(git ls-files app/static)
dev/tests/changed.sh --check-files "${files[@]}" >/dev/null
if dev/tests/changed.sh --check-files app/static/new-unmapped-screen.js >/dev/null 2>&1; then
  echo "An unmapped app/static path passed the changed-screen gate." >&2
  exit 1
fi
for mapping in 'explore.js:guide' 'username-availability.css:welcome' 'cards.css:cards' 'milestones.js:progress' 'fonts/source-serif-4.woff2:core' 'standalone.css:standalone'; do
  path="app/static/${mapping%%:*}"; group="${mapping#*:}"
  output="$(dev/tests/changed.sh --check-files "$path")"
  [[ "$output" == *"-> $group"* ]] || { echo "$path did not select $group." >&2; exit 1; }
done
probe="$(mktemp app/static/.changed-map-untracked-probe.XXXXXX)"
trap 'rm -f "$probe"' EXIT
if output="$(CHANGED_BASE=HEAD dev/tests/changed.sh --check-map 2>&1)"; then
  echo "An untracked app/static path was invisible to the changed-screen gate." >&2
  exit 1
fi
[[ "$output" == *"$probe"* ]] || { echo "The changed-screen gate missed an untracked path: $output" >&2; exit 1; }
rm -f "$probe"; trap - EXIT
echo "Changed-screen map covers tracked paths/scenes, selects the right groups and catches unknown or untracked screens."
