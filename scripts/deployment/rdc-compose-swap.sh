#!/bin/bash
# Replace the kingmo888 rustdesk-api service with rd-console in-place, and
# lay down the hbbs-watcher sidecar next to it.
#
# Takes a timestamped backup of the current compose file first.
#
# Idempotent: re-running this only rewrites docker-compose.yml + the watcher
# build context. Existing ./rdc.env is preserved (secrets stay rotated once).

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

# Lay down the hbbs-watcher build context. Inlining the Dockerfile+entrypoint
# here keeps the deploy as a single script — no separate `scp` step.
mkdir -p ./hbbs-watcher

cat > ./hbbs-watcher/Dockerfile <<'DOCKERFILE'
FROM docker:24-cli
RUN apk add --no-cache bash curl
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
DOCKERFILE

cat > ./hbbs-watcher/entrypoint.sh <<'WATCHER'
#!/bin/bash
# Tails `docker logs -f $HBBS_CONTAINER` and forwards every `update_pk`
# line to rd-console's /api/heartbeat, preserving the real client IP via
# X-Forwarded-For. See scripts/hbbs-watcher/entrypoint.sh in the repo for
# the full rationale.
set -eu

: "${HBBS_CONTAINER:?HBBS_CONTAINER is required}"
: "${RDC_URL:?RDC_URL is required}"
: "${RDC_CLIENT_SECRET:=${RD_CLIENT_SHARED_SECRET:-}}"
if [ -z "$RDC_CLIENT_SECRET" ]; then
    echo "FATAL: RDC_CLIENT_SECRET or RD_CLIENT_SHARED_SECRET must be set" >&2
    exit 1
fi

SINCE="${HBBS_WATCHER_SINCE:-1m}"
CURL_TIMEOUT="${HBBS_WATCHER_CURL_TIMEOUT:-5}"
RECONNECT_DELAY="${HBBS_WATCHER_RECONNECT_DELAY:-3}"

RE='update_pk ([0-9]+) \[?([0-9a-fA-F:.]+)\]?:[0-9]+'

log()  { printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
warn() { log "WARN: $*" >&2; }

heartbeat() {
    local id="$1" ip="$2"
    ip="${ip#::ffff:}"
    if curl -sf --max-time "$CURL_TIMEOUT" \
            -X POST "$RDC_URL/api/heartbeat" \
            -H 'Content-Type: application/json' \
            -H "X-RD-Secret: $RDC_CLIENT_SECRET" \
            -H "X-Forwarded-For: $ip" \
            -d "{\"id\":\"$id\"}" \
            -o /dev/null 2>/dev/null; then
        log "heartbeat ok: id=$id ip=$ip"
    else
        warn "heartbeat FAILED: id=$id ip=$ip"
    fi
}

log "hbbs-watcher starting: container=$HBBS_CONTAINER target=$RDC_URL since=$SINCE"

while true; do
    docker logs -f --since "$SINCE" "$HBBS_CONTAINER" 2>&1 \
    | while IFS= read -r line; do
        if [[ "$line" =~ $RE ]]; then
            heartbeat "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}"
        fi
      done \
    || warn "docker logs stream ended — reconnecting"

    sleep "$RECONNECT_DELAY"
done
WATCHER

chmod +x ./hbbs-watcher/entrypoint.sh
echo "Wrote /opt/rustdesk/hbbs-watcher/"

cat > docker-compose.yml <<'YAML'
services:
  hbbs:
    image: rustdesk/rustdesk-server:latest
    container_name: rustdesk-hbbs-1
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
    container_name: rustdesk-hbbr-1
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
    container_name: rustdesk-api
    ports:
      - "21114:8080"
    env_file:
      - ./rdc.env
    environment:
      - TZ=Europe/Madrid
    volumes:
      - ./data/rdc:/data
      # hbbs SQLite mounted read-only: metadata sync only, never writes.
      # Online state comes from the hbbs-watcher → /api/heartbeat pipeline.
      - ./data:/hbbs-data:ro
    depends_on:
      - hbbs
    restart: unless-stopped

  # hbbs-watcher: tails rustdesk-hbbs-1 stdout and forwards each
  # `update_pk` line to rd-console's heartbeat endpoint. This is the only
  # reliable online-presence signal hbbs-free exposes — see
  # scripts/hbbs-watcher/ in the rd-console repo for the rationale.
  hbbs-watcher:
    build: ./hbbs-watcher
    image: hbbs-watcher:latest
    container_name: rustdesk-hbbs-watcher
    environment:
      HBBS_CONTAINER: rustdesk-hbbs-1
      RDC_URL: http://rustdesk-api:8080
    env_file:
      - ./rdc.env
    volumes:
      # Docker socket is read-only: the watcher only needs `docker logs`.
      - /var/run/docker.sock:/var/run/docker.sock:ro
    depends_on:
      - rustdesk-api
      - hbbs
    restart: unless-stopped
    # read-only rootfs + drop caps would be ideal, but the docker CLI needs
    # to write its config cache. Leaving defaults; surface is still small:
    # one bash process + curl + docker-cli, no inbound listeners.
YAML

echo "Wrote new docker-compose.yml"
grep -n 'image:\|container_name:' docker-compose.yml
