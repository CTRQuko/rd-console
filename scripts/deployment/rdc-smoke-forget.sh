#!/bin/bash
# Smoke test for PR #12 (coordinated forget):
#   1. Inject a fake ghost peer into BOTH hbbs SQLite and rd-console SQLite.
#   2. Call DELETE /admin/api/devices/{id} via the panel API.
#   3. Verify the row is gone from BOTH DBs.
#   4. Wait past one sync tick (>5s default interval) and verify hbbs sync
#      did NOT resurrect it (the local row stays gone).
#
# Run from /opt/rustdesk on LXC 105. Requires:
#   - rustdesk-api healthy
#   - /opt/rustdesk/rdc.env with RD_ADMIN_USERNAME/PASSWORD
set -euo pipefail

HBBS_DB=/opt/rustdesk/data/db_v2.sqlite3
RDC_DB=/opt/rustdesk/data/rdc/rd_console.sqlite3
API=http://127.0.0.1:21114
GHOST=999000111

# shellcheck disable=SC1091
. /opt/rustdesk/rdc.env
USER="$RD_ADMIN_USERNAME"
PASS="$RD_ADMIN_PASSWORD"

echo "=== 1. State before ==="
echo "-- hbbs.peer:"
sqlite3 "$HBBS_DB" "SELECT id FROM peer;" | head -20
echo "-- rdc.devices:"
sqlite3 "$RDC_DB" "SELECT rustdesk_id, hostname FROM devices;" | head -20

echo ""
echo "=== 2. Inject fake ghost id=$GHOST in both DBs ==="
# hbbs peer row (schema: id TEXT PK, created_at TEXT, user TEXT, uuid BLOB, pk BLOB, info TEXT, status INTEGER, note TEXT, region INTEGER, last_reg_time INTEGER, guid BLOB, strategy_name TEXT)
sqlite3 "$HBBS_DB" <<SQL
INSERT OR REPLACE INTO peer (id, created_at, user, info, status)
VALUES ('$GHOST', datetime('now'), '', '{"hostname":"smoke-ghost","os":"linux"}', 0);
SQL

# rdc.devices row (minimum columns we care about)
sqlite3 "$RDC_DB" <<SQL
INSERT OR REPLACE INTO devices (rustdesk_id, hostname, platform, created_at)
VALUES ('$GHOST', 'smoke-ghost', 'linux', datetime('now'));
SQL

echo "-- hbbs.peer (should include $GHOST):"
sqlite3 "$HBBS_DB" "SELECT id FROM peer WHERE id='$GHOST';"
echo "-- rdc.devices (should include $GHOST):"
sqlite3 "$RDC_DB" "SELECT rustdesk_id FROM devices WHERE rustdesk_id='$GHOST';"

echo ""
echo "=== 3. Login to get admin token ==="
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
echo "=== 4. Lookup internal device ID ==="
DEVICE_ID=$(curl -s "$API/admin/api/devices?search=$GHOST" \
    -H "Authorization: Bearer $TOKEN" \
    | sed -n 's/.*"id":\([0-9]*\).*/\1/p' | head -1)
echo "Internal id for ghost: $DEVICE_ID"
if [ -z "$DEVICE_ID" ]; then
    echo "FATAL: ghost not visible via API"
    exit 1
fi

echo ""
echo "=== 5. DELETE /admin/api/devices/$DEVICE_ID ==="
curl -s -X DELETE "$API/admin/api/devices/$DEVICE_ID" \
    -H "Authorization: Bearer $TOKEN" \
    -w "\nHTTP: %{http_code}\n"

echo ""
echo "=== 6. Verify removed from BOTH DBs ==="
HBBS_LEFT=$(sqlite3 "$HBBS_DB" "SELECT COUNT(*) FROM peer WHERE id='$GHOST';")
RDC_LEFT=$(sqlite3 "$RDC_DB" "SELECT COUNT(*) FROM devices WHERE rustdesk_id='$GHOST';")
echo "hbbs.peer count for $GHOST: $HBBS_LEFT (expect 0)"
echo "rdc.devices count for $GHOST: $RDC_LEFT (expect 0)"

echo ""
echo "=== 7. Wait 30s for sync tick, confirm ghost does NOT return ==="
sleep 30
HBBS_LEFT2=$(sqlite3 "$HBBS_DB" "SELECT COUNT(*) FROM peer WHERE id='$GHOST';")
RDC_LEFT2=$(sqlite3 "$RDC_DB" "SELECT COUNT(*) FROM devices WHERE rustdesk_id='$GHOST';")
echo "After 30s — hbbs: $HBBS_LEFT2 / rdc: $RDC_LEFT2 (both expect 0)"

echo ""
if [ "$HBBS_LEFT" = "0" ] && [ "$RDC_LEFT" = "0" ] && [ "$RDC_LEFT2" = "0" ]; then
    echo "✅ PR #12 smoke test PASSED"
    exit 0
else
    echo "❌ PR #12 smoke test FAILED"
    exit 1
fi
