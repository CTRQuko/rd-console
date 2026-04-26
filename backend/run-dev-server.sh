#!/usr/bin/env bash
# Local dev backend for the design-system-v3 frontend (Vite on :5173).
#
# Differences vs run-e2e-server.sh:
# - Persists the DB at backend/data/rd_console.dev.db (NOT wiped on each
#   start) so the user stays logged in across restarts.
# - Bootstraps a known admin (admin/adminadmin) on first launch only —
#   if a User row already exists, the env password is ignored.
#
# Run from the repo root:
#   bash backend/run-dev-server.sh

set -euo pipefail

cd "$(dirname "$0")"

mkdir -p data

export RD_DB_PATH="${RD_DB_PATH:-$(pwd)/data/rd_console.dev.db}"
export RD_ADMIN_USERNAME="${RD_ADMIN_USERNAME:-admin}"
export RD_ADMIN_PASSWORD="${RD_ADMIN_PASSWORD:-adminadmin}"
export RD_DISABLE_FRONTEND="true"
export RD_SECRET_KEY="${RD_SECRET_KEY:-dev-local-secret-must-be-32-chars-or-more}"
export RD_ENVIRONMENT="dev"

# CORS for the Vite dev server. Add more origins as you spin up extra
# tabs / hosts.
export RD_CORS_ORIGINS='["http://localhost:5173","http://127.0.0.1:5173"]'

if [ -x ".venv/bin/uvicorn" ]; then
  UVICORN=".venv/bin/uvicorn"
elif [ -x ".venv/Scripts/uvicorn" ]; then
  UVICORN=".venv/Scripts/uvicorn"
elif [ -x ".venv/Scripts/uvicorn.exe" ]; then
  UVICORN=".venv/Scripts/uvicorn.exe"
else
  UVICORN="uvicorn"
fi

echo "→ DB:    $RD_DB_PATH"
echo "→ Admin: $RD_ADMIN_USERNAME / $RD_ADMIN_PASSWORD (only on first run)"
echo "→ Bind:  http://127.0.0.1:8080"
echo

# --reload-dir app/ keeps watchfiles off .venv/, otherwise it triggers
# an endless reload loop whenever pip install touches site-packages.
exec "$UVICORN" app.main:app --host 127.0.0.1 --port 8080 \
  --reload --reload-dir app 2>&1
