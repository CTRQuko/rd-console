#!/bin/bash
# rd-console deploy — memory-constrained variant.
#
# Builds the runtime image from backend source + a pre-built frontend
# tarball fetched from a GitHub Release asset. Use this on LXCs that
# cannot run `npm run build` (the vite build peaks over their RAM
# cgroup limit and gets OOM-killed with exit 137).
#
# Required env:
#   DIST_URL   URL to a tar.gz that expands to a top-level `dist/` dir.
#              Typically a GitHub release asset.
# Optional env:
#   SRC_REF    Git ref of rd-console to fetch (default: main).
#   IMAGE      Image tag to produce (default: rd-console:latest).

set -euo pipefail

BUILD_DIR=/opt/rustdesk/build
SRC_REF="${SRC_REF:-main}"
IMAGE="${IMAGE:-rd-console:latest}"
DIST_URL="${DIST_URL:?DIST_URL is required (tar.gz with top-level dist/)}"

echo "=== 1. Fresh source checkout ($SRC_REF) ==="
mkdir -p "$BUILD_DIR"
cd "$BUILD_DIR"
find . -mindepth 1 -maxdepth 1 -exec rm -rf {} +
curl -fsSL "https://github.com/CTRQuko/rd-console/archive/refs/heads/${SRC_REF}.tar.gz" \
    | tar xz --strip-components=1

echo ""
echo "=== 2. Fetch prebuilt frontend from $DIST_URL ==="
curl -fsSL "$DIST_URL" -o /tmp/frontend-dist.tar.gz
mkdir -p frontend-dist
tar xzf /tmp/frontend-dist.tar.gz -C frontend-dist --strip-components=1
echo "dist contents:"
ls frontend-dist | head -5

echo ""
echo "=== 3. Build runtime image ($IMAGE) ==="
docker build -f Dockerfile.prebuilt -t "$IMAGE" -t rd-console:0.2.0 "$BUILD_DIR"
docker images rd-console

echo ""
echo "=== 4. Done. docker compose up -d from /opt/rustdesk to deploy. ==="
