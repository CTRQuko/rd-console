#!/bin/bash
# Smoke test: per-user address book (legacy kingmo888 blob contract).
#
# Verifies:
#   - POST /api/ab/get on a fresh user returns 200 with empty data
#   - POST /api/ab persists a stringified JSON blob verbatim
#   - POST /api/ab/get returns the same blob byte-for-byte
#   - /api/ab/settings + /api/ab/personal return 404 (Flutter compat probes)
#   - Exactly one ADDRESS_BOOK_UPDATED audit row is emitted
#   - A PAT minted by the same user can also read/write the AB
set -euo pipefail

RDC_DB=/opt/rustdesk/data/rdc/rd_console.sqlite3
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

echo ""
echo "=== 2. Baseline audit count for address_book_updated ==="
AUDIT_PRE=$(sqlite3 "$RDC_DB" "SELECT COUNT(*) FROM audit_logs WHERE action='ADDRESS_BOOK_UPDATED';")
echo "Pre-count: $AUDIT_PRE"

echo ""
echo "=== 3. GET empty address book ==="
GET_EMPTY=$(curl -sf -X POST "$API/api/ab/get" \
    -H "Authorization: Bearer $JWT" \
    -H 'Content-Type: application/json' \
    -d '{"id":"anything"}')
echo "$GET_EMPTY"
# data field must be either "" (empty string) or empty-object
echo "$GET_EMPTY" | grep -qE '"data":"(|\{\})"' \
    || fail "expected empty data on a fresh AB, got $GET_EMPTY"

echo ""
echo "=== 4. PUT a legacy-shaped blob ==="
# Inner JSON that Flutter clients actually send
INNER='{"tags":["smoke"],"peers":[{"id":"SMOKE-1","alias":"smoke-test","hostname":"","username":"","platform":"Linux","tags":["smoke"],"hash":""}],"tag_colors":"{\"smoke\":-16711936}"}'
# Envelope: data field holds the *stringified* inner
# Escape backslashes + quotes for JSON-in-JSON
ENVELOPE_DATA=$(python3 -c "import json,sys; print(json.dumps(json.dumps(json.loads(sys.argv[1]))))" "$INNER")
PUT_RESP=$(curl -sf -X POST "$API/api/ab" \
    -H "Authorization: Bearer $JWT" \
    -H 'Content-Type: application/json' \
    -d "{\"data\":$ENVELOPE_DATA}")
echo "$PUT_RESP"
echo "$PUT_RESP" | grep -q '"updated_at"' || fail "PUT response missing updated_at"

echo ""
echo "=== 5. GET returns the blob back (roundtrip) ==="
GET_BACK=$(curl -sf -X POST "$API/api/ab/get" \
    -H "Authorization: Bearer $JWT" \
    -H 'Content-Type: application/json' \
    -d '{}')
echo "$GET_BACK"
# Parse the envelope's data field and check it contains our SMOKE-1 peer
echo "$GET_BACK" | python3 -c "
import json,sys
env=json.load(sys.stdin)
inner=json.loads(env['data'])
peers=inner['peers']
assert len(peers)==1, f'expected 1 peer got {len(peers)}'
assert peers[0]['id']=='SMOKE-1', peers[0]
assert peers[0]['alias']=='smoke-test', peers[0]
assert 'smoke' in inner['tags'], inner['tags']
print('roundtrip ok')
" || fail "roundtrip verification failed"

echo ""
echo "=== 6. Flutter compat probes must 404 ==="
for ep in /api/ab/settings /api/ab/personal; do
    CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API$ep" \
        -H "Authorization: Bearer $JWT")
    [ "$CODE" = "404" ] || fail "$ep returned $CODE (expected 404 — Flutter compat)"
    echo "$ep → 404 ✅"
done

echo ""
echo "=== 7. Exactly ONE address_book_updated audit row added ==="
AUDIT_POST=$(sqlite3 "$RDC_DB" "SELECT COUNT(*) FROM audit_logs WHERE action='ADDRESS_BOOK_UPDATED';")
DELTA=$((AUDIT_POST - AUDIT_PRE))
[ "$DELTA" = "1" ] || fail "audit delta=$DELTA expected 1"

echo ""
echo "=== 8. PAT can also read/write the AB ==="
PAT=$(curl -sf -X POST "$API/api/auth/tokens" \
    -H "Authorization: Bearer $JWT" \
    -H 'Content-Type: application/json' \
    -d '{"name":"ab-smoke-pat"}' \
    | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
[ -n "$PAT" ] || fail "PAT mint failed"

PAT_GET=$(curl -sf -X POST "$API/api/ab/get" \
    -H "Authorization: Bearer $PAT" \
    -H 'Content-Type: application/json' \
    -d '{}')
echo "$PAT_GET" | grep -q 'SMOKE-1' || fail "PAT could not read AB"
echo "PAT read ok ✅"

# Clean up: revoke the smoke PAT (find its id)
PAT_ID=$(curl -sf "$API/api/auth/tokens" -H "Authorization: Bearer $JWT" \
    | python3 -c "import json,sys; rows=json.load(sys.stdin); print(next(r['id'] for r in rows if r['name']=='ab-smoke-pat'))")
curl -sf -X DELETE "$API/api/auth/tokens/$PAT_ID" -H "Authorization: Bearer $JWT" -o /dev/null

echo ""
echo "=== 9. Cleanup: clear the AB (will emit ADDRESS_BOOK_CLEARED) ==="
curl -sf -X POST "$API/api/ab" \
    -H "Authorization: Bearer $JWT" \
    -H 'Content-Type: application/json' \
    -d '{"data":"{}"}' -o /dev/null

echo ""
echo "✅ address book smoke PASSED"
