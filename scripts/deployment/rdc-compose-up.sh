#!/bin/bash
set -euo pipefail
cd /opt/rustdesk
docker compose up -d --force-recreate rustdesk-api
echo "---"
sleep 2
docker compose ps
