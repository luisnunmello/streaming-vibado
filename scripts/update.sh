#!/usr/bin/env bash
# Update the app from git and restart it (Docker deployment).
#
#   ./scripts/update.sh              pull, rebuild, restart
#   ./scripts/update.sh --rollback   go back to the image that was running before the last update
#
# Note: restarting ends the current broadcast. Viewers reconnect by themselves;
# the streamer has to press "Start streaming" again.
set -euo pipefail
cd "$(dirname "$0")/.."

IMAGE="streaming-app"
SERVICE="streaming"

wait_healthy() {
  echo "Waiting for the container to become healthy..."
  for _ in $(seq 1 30); do
    status=$(docker inspect --format '{{.State.Health.Status}}' "$SERVICE" 2>/dev/null || echo "missing")
    if [ "$status" = "healthy" ]; then
      echo "Healthy."
      return 0
    fi
    sleep 2
  done
  return 1
}

if [ "${1:-}" = "--rollback" ]; then
  if ! docker image inspect "$IMAGE:previous" >/dev/null 2>&1; then
    echo "No previous image to roll back to." >&2
    exit 1
  fi
  docker tag "$IMAGE:previous" "$IMAGE:latest"
  docker compose up -d --no-build
  wait_healthy || { docker compose logs --tail 50 "$SERVICE"; exit 1; }
  echo "Rolled back."
  exit 0
fi

if ! git rev-parse --abbrev-ref '@{u}' >/dev/null 2>&1; then
  echo "This branch has no upstream. Set one first, e.g.: git branch --set-upstream-to=origin/main" >&2
  exit 1
fi

echo "Current version: $(git rev-parse --short HEAD)"
git pull --ff-only
echo "New version:     $(git rev-parse --short HEAD)"

# Keep the running image around so a bad update can be undone with --rollback.
docker tag "$IMAGE:latest" "$IMAGE:previous" 2>/dev/null || true

docker compose build --pull
docker compose up -d --remove-orphans

if wait_healthy; then
  docker image prune -f >/dev/null
  echo "Updated to $(git rev-parse --short HEAD)."
else
  echo "The new version did not become healthy. Last logs:" >&2
  docker compose logs --tail 50 "$SERVICE" >&2
  echo "Run ./scripts/update.sh --rollback to restore the previous version." >&2
  exit 1
fi
