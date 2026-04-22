#!/bin/bash
# Read hbbs's SQLite schema + sample rows.
set -u
DB=/opt/rustdesk/data/db_v2.sqlite3
apt-get install -y sqlite3 >/dev/null 2>&1 || true
echo "=== TABLES ==="
sqlite3 "$DB" ".tables"
echo ""
echo "=== SCHEMA ==="
sqlite3 "$DB" ".schema"
echo ""
echo "=== ROW COUNTS ==="
for t in $(sqlite3 "$DB" ".tables"); do
  n=$(sqlite3 "$DB" "SELECT COUNT(*) FROM $t")
  echo "$t: $n rows"
done
echo ""
echo "=== SAMPLE peer (first 3) ==="
sqlite3 -header -column "$DB" "SELECT * FROM peer LIMIT 3" 2>/dev/null || echo "no peer table"
