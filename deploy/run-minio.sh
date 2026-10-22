#!/bin/sh
# Starts the pinned MinIO Community Edition binary on host loopback only.
# Secrets stay in deploy/.env (mode 600) and are never given to PM2's own env,
# so `pm2 save` does not persist them.
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
set -a
. "$ROOT/deploy/.env"
set +a
mkdir -p "$MINIO_DATA_DIR"
exec "$ROOT/bin/minio" server "$MINIO_DATA_DIR" \
  --address 127.0.0.1:9000 \
  --console-address 127.0.0.1:9001
