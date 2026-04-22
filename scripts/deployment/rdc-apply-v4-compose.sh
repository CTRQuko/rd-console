#!/bin/bash
# Update LXC 105's docker-compose.yml to add the read-only hbbs data mount
# into the rustdesk-api (rd-console) service. Then force-recreate.
set -euo pipefail

cd /opt/rustdesk

TS=$(date +%Y%m%d-%H%M%S)
cp docker-compose.yml "docker-compose.yml.bak-${TS}"
echo "Backup: docker-compose.yml.bak-${TS}"

# Rewrite the file — same structure, just adds the hbbs-data mount + depends_on.
cat > docker-compose.yml <<'YAML'
services:
  hbbs:
    image: rustdesk/rustdesk-server:latest
    command: hbbs
    ports:
      - "21115:21115"
      - "21116:21116"
      - "21116:21116/udp"
      - "21118:21118"
    volumes:
      - ./data:/root
    depends_on:
      - hbbr
    restart: unless-stopped
    network_mode: bridge

  hbbr:
    image: rustdesk/rustdesk-server:latest
    command: hbbr
    ports:
      - "21117:21117"
      - "21119:21119"
    volumes:
      - ./data:/root
    restart: unless-stopped
    network_mode: bridge

  rustdesk-api:
    image: rd-console:latest
    ports:
      - "21114:8080"
    env_file:
      - ./rdc.env
    environment:
      - TZ=Europe/Madrid
    volumes:
      - ./data/rdc:/data
      - ./data:/hbbs-data:ro
    depends_on:
      - hbbs
    restart: unless-stopped
YAML

echo "Updated docker-compose.yml:"
grep -n 'image:\|hbbs-data' docker-compose.yml

echo ""
echo "Recreating rustdesk-api..."
docker compose up -d --force-recreate rustdesk-api
sleep 3
docker compose ps
