#!/bin/bash
# Smoke test the rd-console deployment on LXC 105.
set -u

echo "=== Container state ==="
cd /opt/rustdesk
docker compose ps
echo ""

echo "=== Container logs (last 40 lines) ==="
docker compose logs --tail=40 rustdesk-api
echo ""

echo "=== /health ==="
curl -sS http://127.0.0.1:21114/health
echo ""

echo "=== Login as admin ==="
curl -sS -o /tmp/login.json -w "HTTP %{http_code}\n" \
    -X POST http://127.0.0.1:21114/api/auth/login \
    -H 'Content-Type: application/json' \
    -d '{"username":"admin","password":"Admin2026!"}'
cat /tmp/login.json
echo ""

TOKEN=$(grep -o '"access_token":"[^"]*"' /tmp/login.json | cut -d'"' -f4)
if [ -n "$TOKEN" ]; then
    echo "=== /api/auth/me (with token) ==="
    curl -sS http://127.0.0.1:21114/api/auth/me \
        -H "Authorization: Bearer $TOKEN"
    echo ""

    echo "=== /admin/api/users ==="
    curl -sS http://127.0.0.1:21114/admin/api/users \
        -H "Authorization: Bearer $TOKEN"
    echo ""
fi

echo "=== Frontend root (first 6 lines) ==="
curl -sS http://127.0.0.1:21114/ | head -6

echo ""
echo "=== Frontend /login (SPA fallback, first 3 lines) ==="
curl -sS http://127.0.0.1:21114/login | head -3
