#!/bin/bash
# Smoke test: kingmo888-compatible /api/login for the native RustDesk client.
#
# Verifies:
#   - POST /api/login with admin creds returns 200 + kingmo888-shaped body
#   - Bad password returns 401 + emits ADDRESS_BOOK audit row? NO — LOGIN_FAILED
#   - Token minted here composes with /api/ab/get (the whole point of aliasing)
#   - POST /api/currentUser with the legacy token echoes the user identity
#   - POST /api/logout returns 200 (stateless)
#   - Endpoint is NOT gated by X-RD-Secret (Flutter clients don't send it)
set -euo pipefail

RDC_DB=/opt/rustdesk/data/rdc/rd_console.sqlite3
API=http://127.0.0.1:21114

# shellcheck disable=SC1091
. /opt/rustdesk/rdc.env
USER="$RD_ADMIN_USERNAME"
PASS="$RD_ADMIN_PASSWORD"

fail() { echo "❌ $*"; exit 1; }

echo "=== 1. POST /api/login (kingmo888 shape) ==="
LOGIN=$(curl -sf -X POST "$API/api/login" \
    -H 'Content-Type: application/json' \
    -d "{\"username\":\"$USER\",\"password\":\"$PASS\",\"id\":\"smoke-client\",\"uuid\":\"smoke-uuid\"}")
echo "$LOGIN"
echo "$LOGIN" | grep -q '"type":"access_token"' || fail "missing type field"
echo "$LOGIN" | grep -q '"user":{' || fail "missing user object"

TOKEN=$(echo "$LOGIN" | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p')
[ -n "$TOKEN" ] || fail "no access_token in login response"

echo ""
echo "=== 2. Bad password → 401 ==="
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/api/login" \
    -H 'Content-Type: application/json' \
    -d "{\"username\":\"$USER\",\"password\":\"WRONG\"}")
[ "$CODE" = "401" ] || fail "bad-password expected 401 got $CODE"

echo ""
echo "=== 3. Legacy token reads /api/ab/get ==="
AB=$(curl -sf -X POST "$API/api/ab/get" \
    -H "Authorization: Bearer $TOKEN" \
    -H 'Content-Type: application/json' \
    -d '{"id":"anything"}')
echo "$AB"
echo "$AB" | grep -q '"data"' || fail "legacy token did not unlock /api/ab/get"

echo ""
echo "=== 4. /api/currentUser echoes identity ==="
ME=$(curl -sf -X POST "$API/api/currentUser" \
    -H "Authorization: Bearer $TOKEN")
echo "$ME"
echo "$ME" | grep -q "\"name\":\"$USER\"" || fail "currentUser returned wrong identity"

echo ""
echo "=== 5. /api/logout returns 200 ==="
curl -sf -X POST "$API/api/logout" \
    -H 'Content-Type: application/json' \
    -d '{"id":"smoke-client","uuid":"smoke-uuid"}' >/dev/null

echo ""
echo "=== 6. /api/login is NOT gated by X-RD-Secret ==="
# Even without the header, login must work. (heartbeat WOULD 401 here when
# client_shared_secret is set — login is intentionally exempt.)
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/api/login" \
    -H 'Content-Type: application/json' \
    -d "{\"username\":\"$USER\",\"password\":\"$PASS\"}")
[ "$CODE" = "200" ] || fail "login without X-RD-Secret expected 200 got $CODE"

echo ""
echo "=== 7. LOGIN audit row stamped with payload=legacy ==="
LEGACY_LOGINS=$(sqlite3 "$RDC_DB" \
    "SELECT COUNT(*) FROM audit_logs WHERE action='LOGIN' AND payload='legacy';")
[ "$LEGACY_LOGINS" -ge 1 ] || fail "expected ≥1 legacy LOGIN audit row, got $LEGACY_LOGINS"

echo ""
echo "✅ legacy login smoke PASSED"
