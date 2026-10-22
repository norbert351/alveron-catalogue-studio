#!/bin/sh
# Consistent logical backup: PostgreSQL custom-format dump + a mirror of the
# private bucket, each with a SHA-256 manifest. Store backups off this VPS too.
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
set -a
. "$ROOT/deploy/.env"
set +a

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DEST="${1:-$ROOT/backups/$STAMP}"
mkdir -p "$DEST/minio"

docker exec alveron-library-postgres \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc > "$DEST/database.dump"

"$ROOT/bin/mc" alias set backup http://127.0.0.1:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null
"$ROOT/bin/mc" mirror --quiet --overwrite "backup/$MINIO_BUCKET" "$DEST/minio" >/dev/null

sha256sum "$DEST/database.dump" > "$DEST/database.dump.sha256"
( cd "$DEST/minio" && find . -type f -print0 | sort -z | xargs -0 -r sha256sum ) > "$DEST/minio.sha256"
echo "$DEST"
