#!/bin/bash
# Smoke test for PR #12 (coordinated forget).
#
# Uses a pre-existing ghost peer (default: 330045685 — the one the plan
# called out, but override with GHOST=xxx for anything else). The peer
# must already exist in BOTH hbbs's peer table and rd-console's devices
# table (if it's in hbbs, the metadata sync will have mirrored it).
#
# Flow:
#   1. Assert ghost is present in both DBs.
#   2. Call DELETE /admin/api/devices/{id} via the panel API.
#   3. Verify the row is gone from BOTH DBs.
#   4. Wait past one sync tick (default 30s) and verify hbbs sync did NOT
#      resurrect it — that's the whole point of the coordinated forget.
set -euo pipefail

HBBS_DB=/opt/rustdesk/data/db_v2.sqlite3
RDC_DB=/opt/rustdesk/data/rdc/rd_console.sqlite3
API=http://127.0.0.1:21114
GHOST="${GHOST:-330045685}"

# shellcheck disable=SC1091
. /opt/rustdesk/rdc.env
USER="$RD_ADMIN_USERNAME"
PASS="$RD_ADMIN_PASSWORD"

echo "=== 1. Assert ghost $GHOST present in both DBs ==="
HBBS_BEFORE=$(sqlite3 "$HBBS_DB" "SELECT COUNT(*) FROM peer WHERE id='$GHOST';")
RDC_BEFORE=$(sqlite3 "$RDC_DB" "SELECT COUNT(*) FROM devices WHERE rustdesk_id='$GHOST';")
echo "hbbs.peer: $HBBS_BEFORE / rdc.devices: $RDC_BEFORE (both expect 1)"
if [ "$HBBS_BEFORE" != "1" ] || [ "$RDC_BEFORE" != "1" ]; then
    echo "FATAL: ghost not present as expected. Pick a different GHOST or wait for sync."
    exit 1
fi

echo ""
echo "=== 2. Login ==="
TOKEN=$(curl -s -X POST "$API/admin/api/auth/login" \
    -H 'Content-Type: application/json' \
    -d "{\"username\":\"$USER\",\"password\":\"$PASS\"}" \
    | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p')
if [ -z "$TOKEN" ]; then
    echo "FATAL: login failed"
    exit 1
fi
echo "Got token (len=${#TOKEN})"

echo ""
echo "=== 3. Find internal device ID for rustdesk_id=$GHOST ==="
DEVICE_ID=$(sqlite3 "$RDC_DB" "SELECT id FROM devices WHERE rustdesk_id='$GHOST';")
echo "Internal id: $DEVICE_ID"
if [ -z "$DEVICE_ID" ]; then
    echo "FATAL: no internal id"
    exit 1
fi

echo ""
echo "=== 4. DELETE /admin/api/devices/$DEVICE_ID ==="
curl -s -X DELETE "$API/admin/api/devices/$DEVICE_ID" \
    -H "Authorization: Bearer $TOKEN" \
    -w "\nHTTP: %{http_code}\n"

echo ""
echo "=== 5. Verify removed from BOTH DBs ==="
HBBS_LEFT=$(sqlite3 "$HBBS_DB" "SELECT COUNT(*) FROM peer WHERE id='$GHOST';")
RDC_LEFT=$(sqlite3 "$RDC_DB" "SELECT COUNT(*) FROM devices WHERE rustdesk_id='$GHOST';")
echo "hbbs.peer: $HBBS_LEFT / rdc.devices: $RDC_LEFT (both expect 0)"

echo ""
echo "=== 6. Wait 30s for sync tick; ghost must stay gone ==="
sleep 30
HBBS_LEFT2=$(sqlite3 "$HBBS_DB" "SELECT COUNT(*) FROM peer WHERE id='$GHOST';")
RDC_LEFT2=$(sqlite3 "$RDC_DB" "SELECT COUNT(*) FROM devices WHERE rustdesk_id='$GHOST';")
echo "After 30s — hbbs: $HBBS_LEFT2 / rdc: $RDC_LEFT2 (both expect 0)"

echo ""
if [ "$HBBS_LEFT" = "0" ] && [ "$RDC_LEFT" = "0" ] && [ "$HBBS_LEFT2" = "0" ] && [ "$RDC_LEFT2" = "0" ]; then
    echo "✅ PR #12 smoke test PASSED"
    exit 0
else
    echo "❌ PR #12 smoke test FAILED"
    exit 1
fi
