#!/bin/sh
# Creates the private bucket and a least-privilege application user.
# Idempotent. Uses the root credential only to administer, never for the app.
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
set -a
. "$ROOT/deploy/.env"
set +a

ALIAS=alveron-local
MC="$ROOT/bin/mc"

"$MC" alias set "$ALIAS" http://127.0.0.1:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null
"$MC" mb --ignore-existing "$ALIAS/$MINIO_BUCKET" >/dev/null
"$MC" anonymous set none "$ALIAS/$MINIO_BUCKET" >/dev/null

POLICY="$ROOT/deploy/minio-app-policy.json"
"$MC" admin policy create "$ALIAS" alveron-library-rw "$POLICY" >/dev/null 2>&1 || true
"$MC" admin user add "$ALIAS" "$MINIO_APP_USER" "$MINIO_APP_PASSWORD" >/dev/null 2>&1 || true
"$MC" admin policy attach "$ALIAS" alveron-library-rw --user "$MINIO_APP_USER" >/dev/null 2>&1 || true

echo "bucket=$MINIO_BUCKET user=$MINIO_APP_USER policy=alveron-library-rw"
