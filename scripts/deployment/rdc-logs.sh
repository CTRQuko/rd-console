#!/bin/bash
cd /opt/rustdesk
docker compose logs rustdesk-api --tail=40
