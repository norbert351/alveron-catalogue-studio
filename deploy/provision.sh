#!/bin/sh
# One-time, idempotent provisioning of the library host (no root required):
# pinned MinIO CE + mc binaries, data/log/backup directories, and secrets.
# It never prints a secret. Safe to re-run; existing secrets are preserved.
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

MINIO_VER=RELEASE.2025-09-07T16-13-09Z
MC_VER=RELEASE.2025-08-13T08-35-41Z

mkdir -p bin data/minio data/local-fallback logs backups

verify_download() {
  url="$1"; dest="$2"; sums="$3"
  tmp="$dest.tmp"
  curl -fsSL "$url" -o "$tmp"
  expected="$(curl -fsSL "$sums" | cut -d' ' -f1)"
  actual="$(sha256sum "$tmp" | cut -d' ' -f1)"
  if [ "$expected" != "$actual" ]; then
    rm -f "$tmp"
    echo "checksum mismatch for $dest" >&2
    exit 1
  fi
  mv "$tmp" "$dest"
  chmod 750 "$dest"
}

if [ ! -x bin/minio ]; then
  base="https://github.com/minio/minio/releases/download/$MINIO_VER"
  verify_download "$base/minio.linux-amd64.$MINIO_VER" bin/minio "$base/minio.linux-amd64.$MINIO_VER.sha256sum"
fi
if [ ! -x bin/mc ]; then
  base="https://github.com/minio/mc/releases/download/$MC_VER"
  verify_download "$base/mc.linux-amd64.$MC_VER" bin/mc "$base/mc.linux-amd64.$MC_VER.sha256sum"
fi

if [ ! -f deploy/.env ]; then
  umask 077
  cat > deploy/.env <<ENV
POSTGRES_DB=alveron_catalogue
POSTGRES_USER=catalogue
POSTGRES_PASSWORD=$(openssl rand -hex 24)
MINIO_ROOT_USER=alveron-minio-admin
MINIO_ROOT_PASSWORD=$(openssl rand -hex 24)
MINIO_APP_USER=alveron-library-app
MINIO_APP_PASSWORD=$(openssl rand -hex 24)
MINIO_BUCKET=alveron-library
MINIO_DATA_DIR=$ROOT/data/minio
ENV
  chmod 600 deploy/.env
fi

if [ ! -f .env.local ]; then
  set -a
  . deploy/.env
  set +a
  OWNER_PASSWORD="$(openssl rand -hex 16)"
  umask 077
  cat > .env.local <<ENV
DATABASE_URL=postgres://$POSTGRES_USER:$POSTGRES_PASSWORD@127.0.0.1:55432/$POSTGRES_DB
SESSION_SECRET=$(openssl rand -hex 32)
STORAGE_PROVIDER=s3
LOCAL_STORAGE_DIR=$ROOT/data/local-fallback
S3_BUCKET=$MINIO_BUCKET
S3_REGION=us-east-1
S3_ENDPOINT=http://127.0.0.1:9000
S3_FORCE_PATH_STYLE=true
S3_ACCESS_KEY_ID=$MINIO_APP_USER
S3_SECRET_ACCESS_KEY=$MINIO_APP_PASSWORD
LIBRARY_SIGNING_SECRET=$(openssl rand -hex 32)
AUTH_BOOTSTRAP_EMAIL=owner@alveronfashion.com
AUTH_BOOTSTRAP_NAME=Alveron Studio Owner
AUTH_BOOTSTRAP_PASSWORD=$OWNER_PASSWORD
ENV
  chmod 600 .env.local
  printf '%s\n%s\n' 'owner@alveronfashion.com' "$OWNER_PASSWORD" > .owner-credentials.txt
  chmod 600 .owner-credentials.txt
fi

echo "binaries: $(./bin/minio --version 2>/dev/null | head -1)"
echo "secrets: deploy/.env (600), .env.local (600)"
echo "owner credentials: $ROOT/.owner-credentials.txt (600)"
