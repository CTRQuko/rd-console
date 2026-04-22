#!/bin/bash
# Install hbbs-watcher as a systemd service on the Docker host.
#
# Why systemd and not a docker-compose sidecar?
#   The obvious design is a sidecar container with /var/run/docker.sock
#   mounted read-only (see scripts/hbbs-watcher/Dockerfile for the image
#   definition). In practice we hit flaky Docker Hub blob storage
#   (Cloudflare R2, 172.64.66.1) from LXC 105 which blocks the image
#   build. Running the watcher directly on the host removes that failure
#   mode entirely — the host already has `docker`, `bash`, and `curl`
#   installed, and it reaches the compose network via published ports.
#
#   Surface is actually smaller this way: no privileged container, no
#   bind-mount of docker.sock into another namespace, just a small bash
#   daemon reading its own docker socket.
#
# Idempotent: re-running this overwrites the script + unit and restarts.
#
# Requires: RDC_CLIENT_SHARED_SECRET exported OR a sibling
# /opt/rustdesk/rdc.env that the unit will source at runtime.

set -euo pipefail

BIN=/usr/local/bin/hbbs-watcher
UNIT=/etc/systemd/system/hbbs-watcher.service
ENV_FILE=/opt/rustdesk/rdc.env

if [ ! -f "$ENV_FILE" ]; then
    echo "FATAL: $ENV_FILE not found — run rdc-compose-swap.sh first"
    exit 1
fi

cat > "$BIN" <<'WATCHER'
#!/bin/bash
# hbbs-watcher — tails hbbs stdout and forwards update_pk heartbeats to
# rd-console's /api/heartbeat endpoint. Runs on the Docker host as a
# systemd service. See scripts/hbbs-watcher/ in the rd-console repo.
set -eu

: "${HBBS_CONTAINER:=rustdesk-hbbs-1}"
: "${RDC_URL:=http://127.0.0.1:21114}"
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
chmod +x "$BIN"
echo "Wrote $BIN"

cat > "$UNIT" <<UNITEOF
[Unit]
Description=rd-console hbbs-watcher (tail hbbs → /api/heartbeat)
After=docker.service
Requires=docker.service

[Service]
Type=simple
EnvironmentFile=${ENV_FILE}
Environment=HBBS_CONTAINER=rustdesk-hbbs-1
Environment=RDC_URL=http://127.0.0.1:21114
ExecStart=${BIN}
Restart=always
RestartSec=3
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
UNITEOF
echo "Wrote $UNIT"

systemctl daemon-reload
systemctl enable --now hbbs-watcher.service
echo ""
echo "=== Status ==="
systemctl --no-pager status hbbs-watcher.service | head -15 || true
