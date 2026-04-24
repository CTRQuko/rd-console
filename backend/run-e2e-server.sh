#!/usr/bin/env bash
# Fresh, isolated FastAPI backend for the Playwright E2E smoke suite.
#
# - Wipes /tmp/rdc-e2e.db on each run so no state leaks between runs.
# - Bootstraps a known admin (admin / e2e-password-1234) — used by the
#   auth setup spec to mint a storage state for the tests.
# - Disables the SPA mount because Playwright drives the Vite dev server
#   directly on :5173.

set -euo pipefail

DB_PATH="${RD_DB_PATH:-/tmp/rdc-e2e.db}"
rm -f "$DB_PATH"

export RD_DB_PATH="$DB_PATH"
export RD_ADMIN_USERNAME="admin"
export RD_ADMIN_PASSWORD="e2e-password-1234"
export RD_DISABLE_FRONTEND="true"
export RD_SECRET_KEY="${RD_SECRET_KEY:-e2e-secret-key-must-be-32-chars-or-more}"
export RD_ENVIRONMENT="dev"

cd "$(dirname "$0")"

# Pick the venv's uvicorn if present; fall back to whatever is on PATH so
# the script works in CI too.
if [ -x ".venv/bin/uvicorn" ]; then
  UVICORN=".venv/bin/uvicorn"
elif [ -x ".venv/Scripts/uvicorn" ]; then
  # Windows-style venv layout (Git Bash / MSYS).
  UVICORN=".venv/Scripts/uvicorn"
else
  UVICORN="uvicorn"
fi

exec "$UVICORN" app.main:app --host 127.0.0.1 --port 8080 2>&1
