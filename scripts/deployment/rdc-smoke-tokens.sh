#!/bin/bash
# Smoke test for PR #14 (Personal Access Tokens).
#
# Flow:
#   1. Login as admin via /api/auth/login → JWT.
#   2. POST /api/auth/tokens → get plaintext PAT (only time it's visible).
#   3. Hit /api/auth/me with PAT → 200 + "admin".
#   4. Hit /admin/api/devices with PAT → 200 (admin-role PAT reaches admin).
#   5. DELETE /api/auth/tokens/{id} with the JWT → 204.
#   6. Re-hit /api/auth/me with the revoked PAT → 401.
#   7. GET /api/auth/tokens → the token row shows revoked_at != null.
#
# Usage on LXC 105:
#   bash /opt/rustdesk/rdc-smoke-tokens.sh
set -euo pipefail

API=http://127.0.0.1:21114

# shellcheck disable=SC1091
. /opt/rustdesk/rdc.env
USER="$RD_ADMIN_USERNAME"
PASS="$RD_ADMIN_PASSWORD"

fail() { echo "❌ $*"; exit 1; }

echo "=== 1. Login ==="
JWT=$(curl -sf -X POST "$API/api/auth/login" \
    -H 'Content-Type: application/json' \
    -d "{\"username\":\"$USER\",\"password\":\"$PASS\"}" \
    | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p')
[ -n "$JWT" ] || fail "login failed"
echo "Got JWT (len=${#JWT})"

echo ""
echo "=== 2. Create PAT ==="
CREATE=$(curl -sf -X POST "$API/api/auth/tokens" \
    -H "Authorization: Bearer $JWT" \
    -H 'Content-Type: application/json' \
    -d '{"name":"smoke-test"}')
PAT=$(echo "$CREATE" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
TOKEN_ID=$(echo "$CREATE" | sed -n 's/.*"id":\([0-9]*\).*/\1/p')
[ -n "$PAT" ] || fail "no plaintext token in create response"
[ -n "$TOKEN_ID" ] || fail "no token id in create response"
case "$PAT" in
    rdcp_*) echo "Got PAT (prefix rdcp_, id=$TOKEN_ID)";;
    *) fail "PAT does not start with rdcp_ — got: $PAT";;
esac

echo ""
echo "=== 3. PAT authenticates /api/auth/me ==="
ME=$(curl -sf -w "\n%{http_code}" "$API/api/auth/me" \
    -H "Authorization: Bearer $PAT")
CODE=$(echo "$ME" | tail -1)
BODY=$(echo "$ME" | head -n -1)
[ "$CODE" = "200" ] || fail "/api/auth/me returned $CODE"
echo "$BODY" | grep -q "\"username\":\"$USER\"" || fail "wrong user in /me response: $BODY"
echo "✓ /me → 200 as $USER"

echo ""
echo "=== 4. Admin-role PAT reaches /admin/api/devices ==="
CODE=$(curl -s -o /dev/null -w "%{http_code}" "$API/admin/api/devices" \
    -H "Authorization: Bearer $PAT")
[ "$CODE" = "200" ] || fail "/admin/api/devices returned $CODE (expected 200)"
echo "✓ /admin/api/devices → 200"

echo ""
echo "=== 5. Revoke PAT ==="
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE \
    "$API/api/auth/tokens/$TOKEN_ID" \
    -H "Authorization: Bearer $JWT")
[ "$CODE" = "204" ] || fail "DELETE returned $CODE (expected 204)"
echo "✓ revoke → 204"

echo ""
echo "=== 6. Revoked PAT is rejected ==="
CODE=$(curl -s -o /dev/null -w "%{http_code}" "$API/api/auth/me" \
    -H "Authorization: Bearer $PAT")
[ "$CODE" = "401" ] || fail "revoked PAT returned $CODE (expected 401)"
echo "✓ /me with revoked PAT → 401"

echo ""
echo "=== 7. Token listed with revoked_at set ==="
LIST=$(curl -sf "$API/api/auth/tokens" -H "Authorization: Bearer $JWT")
echo "$LIST" | grep -q "\"id\":$TOKEN_ID" || fail "token row missing from list"
echo "$LIST" | grep -q "\"revoked_at\":\"" || fail "revoked_at not set on listed row"
echo "✓ list shows revoked_at populated"

echo ""
echo "✅ PR #14 smoke test PASSED"
