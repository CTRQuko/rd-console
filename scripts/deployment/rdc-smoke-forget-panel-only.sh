#!/bin/bash
# Smoke test: forget a device that exists ONLY in rd-console's DB.
#
# Scenario: a Device row was inserted via the panel (admin clicks "add"
# in the UI, or a test seed) but never actually handshook with hbbs,
# so there's no matching row in hbbs.peer. The coordinated-forget code
# path must still succeed — the hbbs DELETE is a 0-row no-op, audit
# gets cleanup=panel-only, and the rdc row is removed.
set -euo pipefail

HBBS_DB=/opt/rustdesk/data/db_v2.sqlite3
RDC_DB=/opt/rustdesk/data/rdc/rd_console.sqlite3
API=http://127.0.0.1:21114
PANEL_ONLY_ID="PANEL-ONLY-$(date +%s)"

# shellcheck disable=SC1091
. /opt/rustdesk/rdc.env
USER="$RD_ADMIN_USERNAME"
PASS="$RD_ADMIN_PASSWORD"

fail() { echo "❌ $*"; exit 1; }

echo "=== 1. Assert rustdesk_id $PANEL_ONLY_ID is NOT in hbbs and NOT in rdc ==="
HBBS_PRE=$(sqlite3 "$HBBS_DB" "SELECT COUNT(*) FROM peer WHERE id='$PANEL_ONLY_ID';")
RDC_PRE=$(sqlite3 "$RDC_DB" "SELECT COUNT(*) FROM devices WHERE rustdesk_id='$PANEL_ONLY_ID';")
[ "$HBBS_PRE" = "0" ] && [ "$RDC_PRE" = "0" ] || fail "pre-state dirty: hbbs=$HBBS_PRE rdc=$RDC_PRE"

echo ""
echo "=== 2. Inject a rdc-only Device row ==="
NOW=$(date -u +'%Y-%m-%d %H:%M:%S')
sqlite3 "$RDC_DB" "INSERT INTO devices (rustdesk_id, hostname, created_at) VALUES ('$PANEL_ONLY_ID', 'panel-only-ghost', '$NOW');"
DEVICE_ID=$(sqlite3 "$RDC_DB" "SELECT id FROM devices WHERE rustdesk_id='$PANEL_ONLY_ID';")
[ -n "$DEVICE_ID" ] || fail "insert did not yield an id"
echo "Injected rdc.devices.id=$DEVICE_ID"

echo ""
echo "=== 3. Login ==="
JWT=$(curl -sf -X POST "$API/api/auth/login" \
    -H 'Content-Type: application/json' \
    -d "{\"username\":\"$USER\",\"password\":\"$PASS\"}" \
    | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p')
[ -n "$JWT" ] || fail "login failed"

echo ""
echo "=== 4. DELETE /admin/api/devices/$DEVICE_ID ==="
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE \
    "$API/admin/api/devices/$DEVICE_ID" \
    -H "Authorization: Bearer $JWT")
[ "$CODE" = "204" ] || fail "DELETE returned $CODE (expected 204 even when hbbs has no row)"

echo ""
echo "=== 5. Verify rdc row gone + hbbs still empty ==="
RDC_POST=$(sqlite3 "$RDC_DB" "SELECT COUNT(*) FROM devices WHERE rustdesk_id='$PANEL_ONLY_ID';")
HBBS_POST=$(sqlite3 "$HBBS_DB" "SELECT COUNT(*) FROM peer WHERE id='$PANEL_ONLY_ID';")
[ "$RDC_POST" = "0" ] || fail "rdc row survived forget"
[ "$HBBS_POST" = "0" ] || fail "hbbs row appeared from nowhere?!"

echo ""
echo "=== 6. Verify audit row has cleanup=panel-only ==="
AUDIT_PAYLOAD=$(sqlite3 "$RDC_DB" \
    "SELECT payload FROM audit_logs
     WHERE action='DEVICE_FORGOTTEN' AND from_id='$PANEL_ONLY_ID'
     ORDER BY id DESC LIMIT 1;")
echo "audit payload: $AUDIT_PAYLOAD"
echo "$AUDIT_PAYLOAD" | grep -q '"cleanup": "panel-only"' \
    || fail "audit payload missing cleanup=panel-only marker"

echo ""
echo "✅ panel-only forget smoke PASSED"
