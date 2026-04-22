# hbbs-watcher: tails rustdesk-server (hbbs) stdout, parses update_pk log
# lines, and turns each one into a POST /api/heartbeat against rd-console.
#
# Why this exists: hbbs free never persists online state. The only reliable
# signal for "this peer is live right now" is the update_pk heartbeat that
# hbbs logs to stdout on every peer announce. This container reads those
# logs via the docker socket (mounted read-only) and forwards a compact
# heartbeat to rd-console, which bumps Device.last_seen_at — the column
# that drives the ONLINE_WINDOW heuristic.
#
# Surface area: docker CLI + curl + bash. No network egress beyond
# ${RDC_URL}. docker.sock is mounted :ro at the compose layer.
FROM docker:24-cli

RUN apk add --no-cache bash curl

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# Minimal runtime footprint; we don't need anything from the default shell.
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
