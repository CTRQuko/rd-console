#!/bin/bash
# Recreate the rustdesk-api container in-place so it picks up a new image
# build and any compose changes (notably the :ro -> rw flip on /hbbs-data
# introduced in PR #12). Run from /opt/rustdesk.
set -euo pipefail
cd /opt/rustdesk
docker compose up -d --force-recreate rustdesk-api
sleep 3
echo "=== Mounts ==="
docker inspect rustdesk-api --format '{{range .Mounts}}{{.Source}}:{{.Destination}} rw={{.RW}}{{println}}{{end}}'
echo "=== Status ==="
docker ps --filter name=rustdesk-api --format '{{.Names}} {{.Status}}'
