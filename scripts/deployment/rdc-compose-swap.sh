#!/bin/bash
# Replace the kingmo888 rustdesk-api service with rd-console in-place.
# Takes a timestamped backup of the current compose file first.

set -euo pipefail

cd /opt/rustdesk

TS=$(date +%Y%m%d-%H%M%S)
cp docker-compose.yml "docker-compose.yml.bak-${TS}"
echo "Backup: /opt/rustdesk/docker-compose.yml.bak-${TS}"

# Ensure volume directory exists (was previously ./data/api for kingmo888;
# rd-console uses /data inside the container, mapped to ./data/rdc here).
mkdir -p ./data/rdc

# Generate secret key if no .env exists yet.
if [ ! -f ./rdc.env ]; then
    SECRET=$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | base64)
    CLIENT_SECRET=$(openssl rand -hex 16 2>/dev/null || head -c 16 /dev/urandom | base64)
    cat > ./rdc.env <<EOF
RD_ENVIRONMENT=prod
RD_SECRET_KEY=${SECRET}
RD_SERVER_HOST=rustdeskserver.casaredes.cc
RD_PANEL_URL=https://rustdesk.casaredes.cc
RD_HBBS_PUBLIC_KEY=XMsXAtY+pfUhyOs29e5ilqAvOjP9MaAmamefL3rb8dQ=
RD_CLIENT_SHARED_SECRET=${CLIENT_SECRET}
RD_ADMIN_USERNAME=admin
RD_ADMIN_PASSWORD=Admin2026!
RD_MAX_AUDIT_PAYLOAD_BYTES=4096
EOF
    chmod 600 ./rdc.env
    echo "Generated /opt/rustdesk/rdc.env (secret key + client shared secret rotated)"
fi

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
    restart: unless-stopped
YAML

echo "Wrote new docker-compose.yml"
grep -n 'image:' docker-compose.yml
