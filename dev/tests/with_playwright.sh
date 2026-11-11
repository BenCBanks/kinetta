#!/usr/bin/env bash
set -euo pipefail

if [[ $# -eq 0 ]]; then
  echo "Usage: with_playwright.sh <command> [args...]" >&2
  exit 2
fi

readonly IMAGE='mcr.microsoft.com/playwright:v1.63.0-noble'
readonly PLAYWRIGHT_VERSION='1.63.0'
readonly WORKSPACE="$(pwd -P)"
readonly DOCKER_BIN="$(readlink -f "$(command -v docker)")"

COMPOSE_PLUGIN=''
for candidate in \
  /usr/lib/docker/cli-plugins/docker-compose \
  /usr/libexec/docker/cli-plugins/docker-compose \
  /usr/local/libexec/docker/cli-plugins/docker-compose \
  /usr/local/lib/docker/cli-plugins/docker-compose \
  "$HOME/.docker/cli-plugins/docker-compose"; do
  if [[ -x "$candidate" ]]; then COMPOSE_PLUGIN="$candidate"; break; fi
done

if [[ ! -x "$DOCKER_BIN" ]]; then
  echo 'Docker CLI is unavailable on the runner.' >&2
  exit 127
fi
if [[ ! -S /var/run/docker.sock ]]; then
  echo 'Docker socket is unavailable on the runner.' >&2
  exit 1
fi
if [[ -z "$COMPOSE_PLUGIN" ]]; then
  echo 'Docker Compose CLI plugin is unavailable on the runner.' >&2
  exit 127
fi
if [[ ! -f "$WORKSPACE/dev/tests/browser/node_modules/playwright/package.json" ]]; then
  echo 'Install dev/tests/browser dependencies before using the Playwright container.' >&2
  exit 1
fi

run_args=(
  run --rm --network host
  --volume "$WORKSPACE:$WORKSPACE:rw"
  --volume /tmp:/tmp:rw
  --volume /var/run/docker.sock:/var/run/docker.sock
  --volume "$DOCKER_BIN:/usr/bin/docker:ro"
  --volume "$COMPOSE_PLUGIN:/tmp/docker-compose-plugin:ro"
  --workdir "$WORKSPACE"
  --env NODE_PATH=dev/tests/browser/node_modules
  --env PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
)

# Forward only browser-fixture settings. In particular, runner credentials and GEMINI_API_KEY never enter the container.
for name in \
  COMPOSE_FILE FEATURE_UI_SESSION KINETTA_ACCESSIBILITY_OUTPUT KINETTA_JOURNEY_SHOTS \
  KINETTA_PORT KINETTA_PROJECT KINETTA_SPACING_CLOCK KINETTA_SPACING_REPORT \
  KINETTA_SPACING_SCREENS KINETTA_SPACING_SHOTS KINETTA_URL TZ; do
  if [[ -v "$name" ]]; then run_args+=(--env "$name"); fi
done

docker "${run_args[@]}" "$IMAGE" bash -euc '
  git config --global --add safe.directory "$PWD"
  mkdir -p /usr/local/lib/docker/cli-plugins
  cp /tmp/docker-compose-plugin /usr/local/lib/docker/cli-plugins/docker-compose
  for command in node npm python3 git docker; do
    command -v "$command" >/dev/null || { echo "Required container command missing: $command" >&2; exit 127; }
  done
  docker compose version >/dev/null
  package_version=$(node -p "require(\"./dev/tests/browser/node_modules/playwright/package.json\").version")
  if [[ "$package_version" != "$1" ]]; then
    echo "Playwright package/image mismatch: package $package_version, image $1" >&2
    exit 1
  fi
  exec "${@:2}"
' with-playwright "$PLAYWRIGHT_VERSION" "$@"
