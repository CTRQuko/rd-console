#!/bin/bash
# rd-console deploy script — runs inside LXC 105.
# Downloads the main branch from GitHub, builds the Docker image, updates
# docker-compose.yml to swap kingmo888/rustdesk-api-server for rd-console.

set -euo pipefail

BUILD_DIR=/opt/rustdesk/build
COMPOSE_DIR=/opt/rustdesk
IMAGE=rd-console:0.1.0

echo "=== 1. Fresh source checkout from GitHub ==="
mkdir -p "$BUILD_DIR"
cd "$BUILD_DIR"
find . -mindepth 1 -maxdepth 1 -exec rm -rf {} +
curl -fsSL https://github.com/CTRQuko/rd-console/archive/refs/heads/main.tar.gz \
    | tar xz --strip-components=1
ls | head -20

echo ""
echo "=== 2. Build Docker image ($IMAGE) ==="
docker build -t "$IMAGE" -t rd-console:latest "$BUILD_DIR"
docker images rd-console

echo ""
echo "=== 3. Done. Run 'docker compose up -d' from $COMPOSE_DIR to deploy. ==="
