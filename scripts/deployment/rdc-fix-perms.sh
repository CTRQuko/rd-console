#!/bin/bash
# Fix /opt/rustdesk/data/rdc permissions so the non-root `rdc` user inside
# the container can create the SQLite file. Then restart.
set -euo pipefail

cd /opt/rustdesk

# The Dockerfile creates user `rdc` via `useradd -r` which on this Debian
# base assigns a system UID (999 in current images). Chown the host
# directory to that UID so the bind mount grants write access.
RDC_UID=$(docker run --rm --entrypoint /usr/bin/id rd-console:latest -u rdc)
RDC_GID=$(docker run --rm --entrypoint /usr/bin/id rd-console:latest -g rdc)
echo "Container rdc user: uid=$RDC_UID gid=$RDC_GID"

mkdir -p ./data/rdc
chown -R "${RDC_UID}:${RDC_GID}" ./data/rdc
chmod 0750 ./data/rdc

ls -la ./data/rdc

docker compose up -d --force-recreate rustdesk-api
sleep 3
docker compose ps
