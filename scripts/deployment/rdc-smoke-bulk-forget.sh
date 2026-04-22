#!/bin/bash
# Smoke test: bulk forget over N rdc-only devices.
#
# Seeds N (default 3) Device rows only in rd-console, calls
# POST /admin/api/devices/bulk with action=forget + all ids, and
# asserts:
#   - 200 OK with affected == N and skipped == 0
#   - all rdc rows gone
#   - hbbs.peer still doesn't contain any of them
#   - exactly one DEVICE_BULK_UPDATED audit row was emitted (not N)
set -euo pipefail

HBBS_DB=/opt/rustdesk/data/db_v2.sqlite3
RDC_DB=/opt/rustdesk/data/rdc/rd_console.sqlite3
API=http://127.0.0.1:21114
N="${N:-3}"
PREFIX="BULK-$(date +%s)"

# shellcheck disable=SC1091
. /opt/rustdesk/rdc.env
USER="$RD_ADMIN_USERNAME"
PASS="$RD_ADMIN_PASSWORD"

fail() { echo "❌ $*"; exit 1; }

echo "=== 1. Seed $N rdc-only devices with prefix $PREFIX ==="
NOW=$(date -u +'%Y-%m-%d %H:%M:%S')
IDS=()
for i in $(seq 1 "$N"); do
    RID="${PREFIX}-${i}"
    sqlite3 "$RDC_DB" \
        "INSERT INTO devices (rustdesk_id, hostname, created_at) VALUES ('$RID', 'bulk-ghost-$i', '$NOW');"
    DEV_ID=$(sqlite3 "$RDC_DB" "SELECT id FROM devices WHERE rustdesk_id='$RID';")
    IDS+=("$DEV_ID")
done
IDS_JSON="[$(IFS=,; echo "${IDS[*]}")]"
echo "Seeded ids: $IDS_JSON"

echo ""
echo "=== 2. Baseline audit count for device_bulk_updated ==="
AUDIT_PRE=$(sqlite3 "$RDC_DB" "SELECT COUNT(*) FROM audit_logs WHERE action='DEVICE_BULK_UPDATED';")
echo "Pre-count: $AUDIT_PRE"

echo ""
echo "=== 3. Login ==="
JWT=$(curl -sf -X POST "$API/api/auth/login" \
    -H 'Content-Type: application/json' \
    -d "{\"username\":\"$USER\",\"password\":\"$PASS\"}" \
    | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p')
[ -n "$JWT" ] || fail "login failed"

echo ""
echo "=== 4. POST /admin/api/devices/bulk action=forget ==="
RESP=$(curl -sf -X POST "$API/admin/api/devices/bulk" \
    -H "Authorization: Bearer $JWT" \
    -H 'Content-Type: application/json' \
    -d "{\"action\":\"forget\",\"device_ids\":$IDS_JSON}")
echo "$RESP"
AFFECTED=$(echo "$RESP" | sed -n 's/.*"affected":\([0-9]*\).*/\1/p')
SKIPPED=$(echo "$RESP" | sed -n 's/.*"skipped":\([0-9]*\).*/\1/p')
[ "$AFFECTED" = "$N" ] || fail "affected=$AFFECTED expected $N"
[ "$SKIPPED" = "0" ] || fail "skipped=$SKIPPED expected 0"

echo ""
echo "=== 5. Verify rdc rows gone ==="
REMAIN=$(sqlite3 "$RDC_DB" "SELECT COUNT(*) FROM devices WHERE rustdesk_id LIKE '$PREFIX%';")
[ "$REMAIN" = "0" ] || fail "rdc rows remaining: $REMAIN"

echo ""
echo "=== 6. Verify hbbs.peer has none of them ==="
HBBS_REMAIN=$(sqlite3 "$HBBS_DB" "SELECT COUNT(*) FROM peer WHERE id LIKE '$PREFIX%';")
[ "$HBBS_REMAIN" = "0" ] || fail "hbbs rows appeared: $HBBS_REMAIN"

echo ""
echo "=== 7. Exactly ONE device_bulk_updated audit row added ==="
AUDIT_POST=$(sqlite3 "$RDC_DB" "SELECT COUNT(*) FROM audit_logs WHERE action='DEVICE_BULK_UPDATED';")
DELTA=$((AUDIT_POST - AUDIT_PRE))
[ "$DELTA" = "1" ] || fail "audit delta=$DELTA expected 1 (one per bulk op, not per device)"

echo ""
echo "✅ bulk forget smoke PASSED (N=$N)"
