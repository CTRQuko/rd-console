#!/bin/bash
# hbbs-watcher entrypoint.
#
# Tails `docker logs -f $HBBS_CONTAINER` and, for every line of the form:
#
#   [... INFO src/peer.rs:NN] update_pk <RD_ID> <IP:PORT> b"<UUID>" b"<PK>"
#
# (the IP may be an IPv4, a bare IPv6, or `[v6]:port`) forwards a
# heartbeat POST to rd-console:
#
#   POST $RDC_URL/api/heartbeat
#   Headers: X-RD-Secret, X-Forwarded-For: <real-client-ip>
#   Body: {"id": "<RD_ID>"}
#
# rd-console's /api/heartbeat already trusts X-Forwarded-For (it runs behind
# nginx) and bumps Device.last_seen_at + Device.last_ip. So the path here is
# strictly: log line → curl → existing endpoint. No DB writes from inside
# this container.
#
# Robustness:
#   - `docker logs -f --since 1m` — on restart, replay the last minute of
#     logs so we don't drop heartbeats during a bounce.
#   - `|| true` on the curl so a transient rd-console blip doesn't kill
#     the stream.
#   - Outer `while true` wraps the whole pipeline so a `docker logs` exit
#     (e.g. hbbs container recreated) triggers a reconnect instead of a
#     crashloop.
#   - `set -eu` guards typos, but NOT pipefail — we *want* the grep to
#     keep going even if a particular line doesn't match.

set -eu

: "${HBBS_CONTAINER:?HBBS_CONTAINER is required (e.g. rustdesk-hbbs-1)}"
: "${RDC_URL:?RDC_URL is required (e.g. http://rustdesk-api:8080)}"
# Accept either RDC_CLIENT_SECRET (explicit) or RD_CLIENT_SHARED_SECRET
# (the name used in rdc.env that also feeds rustdesk-api). Preferring the
# latter lets the watcher share the env_file with the backend.
: "${RDC_CLIENT_SECRET:=${RD_CLIENT_SHARED_SECRET:-}}"
if [ -z "$RDC_CLIENT_SECRET" ]; then
    echo "FATAL: RDC_CLIENT_SECRET or RD_CLIENT_SHARED_SECRET must be set" >&2
    exit 1
fi

# Tunables (safe defaults).
SINCE="${HBBS_WATCHER_SINCE:-1m}"
CURL_TIMEOUT="${HBBS_WATCHER_CURL_TIMEOUT:-5}"
RECONNECT_DELAY="${HBBS_WATCHER_RECONNECT_DELAY:-3}"

# Captures:
#   \1 = RustDesk ID (digits; hbbs sometimes prints them spaced — we keep
#        the non-spaced form used in db_v2.sqlite3).
#   \2 = peer IP. Accepts:
#         - bare IPv4: 192.168.1.34
#         - bare IPv6: fe80::1
#         - bracketed: [fe80::1]
#         Followed by :PORT.
# We pass the regex to bash's =~, which is POSIX ERE.
RE='update_pk ([0-9]+) \[?([0-9a-fA-F:.]+)\]?:[0-9]+'

log()  { printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
warn() { log "WARN: $*" >&2; }

heartbeat() {
    local id="$1" ip="$2"
    # Strip IPv4-mapped prefix so rd-console sees the plain v4.
    ip="${ip#::ffff:}"
    # We ignore stdout/stderr of curl but keep the exit code for logging.
    if curl -sf --max-time "$CURL_TIMEOUT" \
            -X POST "$RDC_URL/api/heartbeat" \
            -H 'Content-Type: application/json' \
            -H "X-RD-Secret: $RDC_CLIENT_SECRET" \
            -H "X-Forwarded-For: $ip" \
            -d "{\"id\":\"$id\"}" \
            -o /dev/null 2>/dev/null; then
        log "heartbeat ok: id=$id ip=$ip"
    else
        # Non-fatal: rd-console may be restarting. Next log line retries.
        warn "heartbeat FAILED: id=$id ip=$ip (curl exit $?)"
    fi
}

log "hbbs-watcher starting: container=$HBBS_CONTAINER target=$RDC_URL since=$SINCE"

# Outer loop = reconnect on `docker logs` exit.
while true; do
    # 2>&1 because hbbs writes to both stdout and stderr.
    docker logs -f --since "$SINCE" "$HBBS_CONTAINER" 2>&1 \
    | while IFS= read -r line; do
        if [[ "$line" =~ $RE ]]; then
            heartbeat "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}"
        fi
      done \
    || warn "docker logs stream ended (code $?) — reconnecting"

    sleep "$RECONNECT_DELAY"
done
