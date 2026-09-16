#!/usr/bin/env bash
# Usage:
#   bash deploy.sh          — rebuild everything
#   bash deploy.sh frontend — rebuild frontend only
#   bash deploy.sh backend  — rebuild backend only
#   bash deploy.sh engine   — rebuild the translation engine only (slow: it
#                             reinstalls torch/ctranslate2, ~2GB of wheels)

set -euo pipefail

# Validate Docker is available
if ! command -v docker &> /dev/null; then
  echo "ERROR: Docker is not installed or not in PATH"
  exit 1
fi

if ! docker info &> /dev/null; then
  echo "ERROR: Docker daemon is not running"
  exit 1
fi

# Validate docker compose plugin
if ! docker compose version &> /dev/null; then
  echo "ERROR: Docker Compose plugin is not available"
  exit 1
fi

TARGET=${1:-all}

pull_latest() {
  echo "Pulling latest code..."
  if ! git pull; then
    echo "ERROR: Failed to pull latest code"
    exit 1
  fi
}

build() {
  local svc="$1"
  echo "Building $svc..."
  if ! docker compose up -d --build --no-deps "$svc"; then
    echo "ERROR: Failed to build $svc"
    exit 1
  fi
  echo "$svc updated."
}

# Start (without rebuilding) — for services a target depends on but isn't
# changing. The engine image is expensive to rebuild, so don't do it implicitly.
ensure_up() {
  local svc="$1"
  echo "Ensuring $svc is running..."
  if ! docker compose up -d --no-deps "$svc" > /dev/null; then
    echo "ERROR: Failed to start $svc"
    exit 1
  fi
}

# Check for .env file
if [ ! -f .env ]; then
  echo "WARNING: .env file not found. Using defaults from docker-compose.yml"
  echo "This may not work in production. Create .env from .env.example"
fi

pull_latest

case "$TARGET" in
  frontend)
    ensure_up translate-engine
    ensure_up backend
    build frontend
    ;;
  backend)
    ensure_up translate-engine
    build backend
    ;;
  engine)
    build translate-engine
    ;;
  all)
    build translate-engine
    build backend
    build frontend
    ;;
  *)
    echo "Usage: bash deploy.sh [frontend|backend|engine|all]"
    exit 1
    ;;
esac

echo "Done."
echo ""
echo "Services status:"
docker compose ps
