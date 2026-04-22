#!/bin/bash
# End-to-end smoke against the live rd-console deployment.
# Exercises every v3 code path that doesn't require a browser.

set -u  # unset vars = error. Don't set -e — we track failures manually.

BASE="${BASE:-https://rustdesk.casaredes.cc}"
# Client secret required by /api/heartbeat etc when RD_CLIENT_SHARED_SECRET
# is set on the server. Pass it via env, e.g.:
#   CLIENT_SECRET="$(ssh pve2 'echo C14ud3 | sudo -S /usr/sbin/pct exec 105 -- \
#     /usr/local/bin/claude-wrapper cat /opt/rustdesk/rdc.env' \
#     | awk -F= '/^RD_CLIENT_SHARED_SECRET/ {print $2}')" \
#     bash scripts/deployment/rdc-e2e-smoke.sh
CLIENT_SECRET="${CLIENT_SECRET:-}"
if [ -z "$CLIENT_SECRET" ]; then
  echo "CLIENT_SECRET env var required — see comment above." >&2
  exit 2
fi
ADMIN_USER="${ADMIN_USER:-admin}"
ADMIN_PASS="${ADMIN_PASS:-}"
if [ -z "$ADMIN_PASS" ]; then
  echo "ADMIN_PASS env var required — the panel admin password." >&2
  exit 2
fi
PASS=0
FAIL=0
RESULTS=()

chk() {
  local label="$1" expect="$2" got="$3"
  if [ "$got" = "$expect" ]; then
    PASS=$((PASS + 1))
    RESULTS+=("✅ $label (expected $expect, got $got)")
  else
    FAIL=$((FAIL + 1))
    RESULTS+=("❌ $label (expected $expect, got $got)")
  fi
}

json() { python -c "import sys,json;print(json.load(sys.stdin)$1)" 2>/dev/null; }

echo "=== 1. Login ==="
LOGIN=$(curl -sSk -X POST "$BASE/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"$ADMIN_USER\",\"password\":\"$ADMIN_PASS\"}")
TOKEN=$(echo "$LOGIN" | json "['access_token']")
chk "login returns JWT" "200" "$(echo "$LOGIN" | grep -q access_token && echo 200 || echo 0)"
echo "  token len = ${#TOKEN}"

H=("-H" "Authorization: Bearer $TOKEN")

echo ""
echo "=== 2. Health + identity ==="
chk "/health"          200 "$(curl -sSk -o /dev/null -w '%{http_code}' "$BASE/health")"
chk "/api/auth/me"     200 "$(curl -sSk -o /dev/null -w '%{http_code}' "${H[@]}" "$BASE/api/auth/me")"
chk "no-token → 401"   401 "$(curl -sSk -o /dev/null -w '%{http_code}' "$BASE/admin/api/users")"

echo ""
echo "=== 3. Tags CRUD ==="
# Cleanup any leftovers from previous runs — python reads names from argv,
# not env, and emits "<id>" per match so the shell can iterate.
LEFTOVER_IDS=$(curl -sSk "${H[@]}" "$BASE/admin/api/tags" \
  | python -c "import sys,json;data=json.load(sys.stdin);[print(t['id']) for t in data if t['name'].lower().startswith('e2e-')]")
for tid in $LEFTOVER_IDS; do
  curl -sSk -X DELETE "${H[@]}" "$BASE/admin/api/tags/$tid" > /dev/null
  echo "  cleaned up leftover tag id=$tid"
done

# Create the tag we'll use through the run and assert both the status and
# the server's assigned id.
CREATE_CODE=$(curl -sSk -o /tmp/rdc-tag.json -w '%{http_code}' -X POST "${H[@]}" \
  "$BASE/admin/api/tags" \
  -H "Content-Type: application/json" \
  -d '{"name":"e2e-blue","color":"blue"}')
chk "create tag (blue)"            "201" "$CREATE_CODE"
TAG_ID=$(json "['id']" < /tmp/rdc-tag.json)
echo "  tag_id = $TAG_ID"

chk "duplicate name 409"           "409" "$(curl -sSk -o /dev/null -w '%{http_code}' -X POST "${H[@]}" "$BASE/admin/api/tags" -H 'Content-Type: application/json' -d '{"name":"E2E-BLUE","color":"red"}')"
chk "bad color 400"                "400" "$(curl -sSk -o /dev/null -w '%{http_code}' -X POST "${H[@]}" "$BASE/admin/api/tags" -H 'Content-Type: application/json' -d '{"name":"e2e-dup","color":"turquoise"}')"
chk "list tags"                    "200" "$(curl -sSk -o /dev/null -w '%{http_code}' "${H[@]}" "$BASE/admin/api/tags")"

echo ""
echo "=== 4. Device via heartbeat (no auth needed) + metadata ==="
curl -sSk -X POST "$BASE/api/heartbeat" \
  -H "Content-Type: application/json" \
  -H "X-RD-Secret: $CLIENT_SECRET" \
  -d '{"id":"E2E 111 111","uuid":"uuid-e2e-1","ver":120}' > /dev/null
# Give the audit log a moment in case of write-behind.
sleep 1
DEV_JSON=$(curl -sSk "${H[@]}" "$BASE/admin/api/devices")
DEV_ID=$(echo "$DEV_JSON" | python -c "import sys,json;[print(d['id']) for d in json.load(sys.stdin) if d['rustdesk_id']=='E2E 111 111']" 2>/dev/null | head -1)
chk "heartbeat registers device"   "yes" "$([ -n "$DEV_ID" ] && echo yes || echo no)"
[ -z "$DEV_ID" ] && { echo "aborting — no device"; echo; for r in "${RESULTS[@]}"; do echo "  $r"; done; exit 1; }

echo "  device id = $DEV_ID"

# Update note + favorite.
PATCH_RESP=$(curl -sSk -X PATCH "${H[@]}" -H "Content-Type: application/json" \
  "$BASE/admin/api/devices/$DEV_ID" \
  -d '{"note":"e2e smoke ran at '"$(date +%H:%M:%S)"'","is_favorite":true}')
NEW_NOTE=$(echo "$PATCH_RESP" | json "['note']")
NEW_FAV=$(echo "$PATCH_RESP" | json "['is_favorite']")
chk "PATCH sets note"              "yes" "$([ -n "$NEW_NOTE" ] && echo yes || echo no)"
chk "PATCH sets is_favorite"       "True" "$NEW_FAV"

# Filter by favorite.
FAVS=$(curl -sSk "${H[@]}" "$BASE/admin/api/devices?favorite=true")
FAV_COUNT=$(echo "$FAVS" | python -c "import sys,json;print(len(json.load(sys.stdin)))")
chk "?favorite=true > 0"           "yes" "$([ "$FAV_COUNT" -gt 0 ] && echo yes || echo no)"

echo ""
echo "=== 5. Tag assignment ==="
ASSIGN=$(curl -sSk -X POST "${H[@]}" "$BASE/admin/api/devices/$DEV_ID/tags/$TAG_ID")
ASSIGNED=$(echo "$ASSIGN" | python -c "import sys,json;t=json.load(sys.stdin)['tags'];print(len(t))")
chk "assign tag → device has 1 tag" "1" "$ASSIGNED"

# Idempotence check.
ASSIGN2=$(curl -sSk -X POST "${H[@]}" "$BASE/admin/api/devices/$DEV_ID/tags/$TAG_ID")
ASSIGNED2=$(echo "$ASSIGN2" | python -c "import sys,json;t=json.load(sys.stdin)['tags'];print(len(t))")
chk "reassign is idempotent"       "1" "$ASSIGNED2"

# Filter by tag.
BY_TAG=$(curl -sSk "${H[@]}" "$BASE/admin/api/devices?tag_id=$TAG_ID")
BY_TAG_COUNT=$(echo "$BY_TAG" | python -c "import sys,json;print(len(json.load(sys.stdin)))")
chk "?tag_id=$TAG_ID count"        "1" "$BY_TAG_COUNT"

echo ""
echo "=== 6. Bulk ops ==="
# Create a second device and bulk-favorite both.
curl -sSk -X POST "$BASE/api/heartbeat" \
  -H "Content-Type: application/json" \
  -H "X-RD-Secret: $CLIENT_SECRET" \
  -d '{"id":"E2E 222 222"}' > /dev/null
sleep 1
DEV2_ID=$(curl -sSk "${H[@]}" "$BASE/admin/api/devices" | python -c "import sys,json;[print(d['id']) for d in json.load(sys.stdin) if d['rustdesk_id']=='E2E 222 222']" | head -1)
BULK=$(curl -sSk -X POST "${H[@]}" -H "Content-Type: application/json" \
  "$BASE/admin/api/devices/bulk" \
  -d "{\"device_ids\":[$DEV_ID,$DEV2_ID],\"action\":\"assign_tag\",\"tag_id\":$TAG_ID}")
BULK_AFFECTED=$(echo "$BULK" | json "['affected']")
BULK_SKIPPED=$(echo "$BULK" | json "['skipped']")
chk "bulk affected (1 newly tagged)" "1" "$BULK_AFFECTED"
chk "bulk skipped"                   "0" "$BULK_SKIPPED"

echo ""
echo "=== 7. Global search ==="
SRCH=$(curl -sSk "${H[@]}" "$BASE/admin/api/search?q=E2E")
SR_DEVS=$(echo "$SRCH" | python -c "import sys,json;print(len(json.load(sys.stdin)['devices']))")
chk "search q=E2E → devices > 0"   "yes" "$([ "$SR_DEVS" -gt 0 ] && echo yes || echo no)"
SR2=$(curl -sSk "${H[@]}" "$BASE/admin/api/search?q=admin")
SR2_USERS=$(echo "$SR2" | python -c "import sys,json;print(len(json.load(sys.stdin)['users']))")
chk "search q=admin → users > 0"   "yes" "$([ "$SR2_USERS" -gt 0 ] && echo yes || echo no)"

echo ""
echo "=== 8. Audit log ==="
# Should include: device_updated, device_tagged, device_bulk_updated, tag_created
for action in "device_updated" "device_tagged" "device_bulk_updated" "tag_created"; do
  C=$(curl -sSk "${H[@]}" "$BASE/admin/api/logs?action=$action&limit=5" | python -c "import sys,json;print(json.load(sys.stdin)['total'])")
  chk "audit has $action (count > 0)" "yes" "$([ "$C" -gt 0 ] && echo yes || echo no)"
done

# Category filter.
CONFIG=$(curl -sSk "${H[@]}" "$BASE/admin/api/logs?category=config&limit=5" | json "['total']")
chk "category=config count > 0"    "yes" "$([ "$CONFIG" -gt 0 ] && echo yes || echo no)"

# CSV export.
CSV_HEAD=$(curl -sSk "${H[@]}" -o /dev/null -w "%{content_type}" "$BASE/admin/api/logs?format=csv&action=tag_created")
chk "CSV content-type"             "text/csv; charset=utf-8" "$CSV_HEAD"

echo ""
echo "=== 9. URL-param endpoints reachable ==="
chk "devices?status=online"        200 "$(curl -sSk -o /dev/null -w '%{http_code}' "${H[@]}" "$BASE/admin/api/devices?status=online")"
chk "devices?platform=Windows"     200 "$(curl -sSk -o /dev/null -w '%{http_code}' "${H[@]}" "$BASE/admin/api/devices?platform=Windows")"
chk "logs?range=today"             200 "$(curl -sSk -o /dev/null -w '%{http_code}' "${H[@]}" "$BASE/admin/api/logs?since=$(date -u -d today +%FT00:00:00)")"

echo ""
echo "=== 10. Cleanup ==="
curl -sSk -X DELETE "${H[@]}" "$BASE/admin/api/devices/$DEV_ID" > /dev/null
curl -sSk -X DELETE "${H[@]}" "$BASE/admin/api/devices/$DEV2_ID" > /dev/null
DEL=$(curl -sSk -X DELETE -w "%{http_code}" -o /dev/null "${H[@]}" "$BASE/admin/api/tags/$TAG_ID")
chk "delete tag (cascade)"         "204" "$DEL"
# Also clean the other e2e-violet tag if present.
VTID=$(curl -sSk "${H[@]}" "$BASE/admin/api/tags" | python -c "import sys,json;[print(t['id']) for t in json.load(sys.stdin) if t['name']=='e2e-violet']" 2>/dev/null)
[ -n "$VTID" ] && curl -sSk -X DELETE "${H[@]}" "$BASE/admin/api/tags/$VTID" > /dev/null

echo ""
echo "============================================"
echo "           RESULTS"
echo "============================================"
for r in "${RESULTS[@]}"; do echo "$r"; done
echo ""
echo "Pass: $PASS   Fail: $FAIL"
[ "$FAIL" -eq 0 ] && echo "🟢 ALL GREEN" || echo "🔴 $FAIL failures"
exit $FAIL
