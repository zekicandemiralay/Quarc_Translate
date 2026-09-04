#!/usr/bin/env bash
# Usage:
#   bash deploy.sh          — rebuild everything
#   bash deploy.sh frontend — rebuild frontend only
#   bash deploy.sh backend  — rebuild backend only
#   bash deploy.sh engine   — rebuild the translation engine only (slow: it
#                             reinstalls torch/ctranslate2, ~2GB of wheels)

set -e

TARGET=${1:-all}

pull_latest() {
  echo "Pulling latest code..."
  git pull
}

build() {
  local svc=$1
  echo "Building $svc..."
  docker compose up -d --build --no-deps "$svc"
  echo "$svc updated."
}

# Start (without rebuilding) — for services a target depends on but isn't
# changing. The engine image is expensive to rebuild, so don't do it implicitly.
ensure_up() {
  docker compose up -d --no-deps "$1" >/dev/null
}

pull_latest

case "$TARGET" in
  frontend) build frontend ;;
  backend)  ensure_up translate-engine; build backend ;;
  engine)   build translate-engine ;;
  all)      build translate-engine; build backend; build frontend ;;
  *)        echo "Usage: bash deploy.sh [frontend|backend|engine|all]"; exit 1 ;;
esac

echo "Done."
