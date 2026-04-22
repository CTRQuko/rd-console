#!/bin/bash
# Diagnostico completo del estado actual.
set -u

echo "=== 1. Todas las filas del peer en hbbs ==="
sqlite3 -header -column /opt/rustdesk/data/db_v2.sqlite3 \
  "SELECT id, status, datetime(created_at) AS created, info FROM peer"

echo ""
echo "=== 2. hbbs logs (últimos 40) ==="
cd /opt/rustdesk
docker compose logs hbbs --tail=40

echo ""
echo "=== 3. Conexiones activas en los puertos de hbbs ==="
ss -tnp | grep -E ':21115|:21116|:21118' || echo "no hbbs connections"

echo ""
echo "=== 4. Listen sockets ==="
ss -tlnp | grep -E ':2111[5-9]|:8080' | sort
