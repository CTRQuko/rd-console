# ─────────────────────────────────────────────────────────────
# rd-console — self-hosted RustDesk Server admin panel
#
# Stage 1 builds the React/Vite frontend → produces /app/dist
# Stage 2 installs the FastAPI backend, copies the built frontend
#          into /app/frontend, and runs uvicorn on $PORT (default 8080).
#
# Default admin on first start is created from RD_ADMIN_USERNAME /
# RD_ADMIN_PASSWORD. Persisted state lives under /data (mount as a volume).
# ─────────────────────────────────────────────────────────────

# ═══════════════════════════════════════════════════════════════════════════
# Stage 1 — frontend build
# ═══════════════════════════════════════════════════════════════════════════
FROM node:20-alpine AS frontend
WORKDIR /app

# Install deps first — maximises Docker layer caching.
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund

# Copy the rest and build.
COPY frontend/ ./
# Cap Node's heap so the build fits in memory-constrained LXCs (LXC 105
# on pve2 runs with 256 MB RAM + 512 MB swap — a default Node heap OOMs
# the cgroup). 420 MB leaves ~350 MB for the rest of the container.
ENV NODE_OPTIONS="--max-old-space-size=420"
RUN npm run build

# ═══════════════════════════════════════════════════════════════════════════
# Stage 2 — backend runtime
# ═══════════════════════════════════════════════════════════════════════════
FROM python:3.11-slim AS runtime

# Install only what's needed at runtime. No dev headers, no build tools.
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PORT=8080 \
    RD_DB_PATH=/data/rd_console.sqlite3 \
    RD_FRONTEND_DIST=/app/frontend

WORKDIR /app

# argon2-cffi needs build-essential + libffi at install time; python-jose
# pulls in cryptography which is wheel-shipped for slim — no compile.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
         build-essential \
         libffi-dev \
    && rm -rf /var/lib/apt/lists/*

# Install backend dependencies from pyproject.toml (no dev extras).
COPY backend/pyproject.toml backend/README.md ./backend/
COPY backend/app ./backend/app
RUN pip install ./backend

# Remove build toolchain to keep the final image small.
RUN apt-get purge -y --auto-remove build-essential libffi-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy the built frontend from stage 1 into a stable path referenced by
# RD_FRONTEND_DIST above.
COPY --from=frontend /app/dist /app/frontend

# Persistent volume for the SQLite DB + any future uploads.
RUN mkdir -p /data
VOLUME ["/data"]

EXPOSE 8080

# Non-root runtime user. Owns /data so init_db() can create the sqlite file.
RUN groupadd -r rdc && useradd -r -g rdc -d /app rdc \
    && chown -R rdc:rdc /data /app
USER rdc

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request, sys; \
sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:' + __import__('os').environ.get('PORT', '8080') + '/health', timeout=2).status == 200 else 1)"

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080}"]
