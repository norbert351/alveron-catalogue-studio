# Alveron Product Library — VPS deployment runbook

Target: `library.alveronfashion.com` → nginx (TLS) → `127.0.0.1:3001` (Next.js)
→ PostgreSQL `127.0.0.1:55432` and MinIO `127.0.0.1:9000`.

Nothing binds a public interface except nginx on 80/443 (the existing firewall
already allows those). MinIO, PostgreSQL and the app listen on loopback only.

## Why a pinned MinIO binary, not a container

MinIO Community Edition is no longer distributed as a Docker image or prebuilt
binary: Docker Hub images were removed in September 2026, `dl.min.io` returns
`410 Gone`, and the repository is archived. We therefore run the **last official
CE release with assets**, `RELEASE.2025-09-07T16-13-09Z`, downloaded from its
pinned GitHub release and verified against the published SHA-256. This is a
maintenance liability: plan a move to a supported S3 implementation (AIStor,
Garage, SeaweedFS, or a managed bucket) before relying on it for years. The app
only needs the S3 API, so the storage backend is swappable by configuration.

## Preflight (verified)

- `/var/www` is writable by `deploy`; `/etc/nginx`, `/etc/letsencrypt` and
  `/opt` are root-only. `deploy` has **no passwordless sudo**.
- `library.alveronfashion.com` already resolves to this host (A record). No DNS
  change was needed.
- Ports 80/443 are open and nginx 1.24 + certbot 2.9 (`authenticator = nginx`)
  are installed. Ports 3001, 9000, 55432 were free.
- Existing services untouched: `alveron-web` (`*:3000`), `alveron-api`
  (`*:4000`), `alveron-n8n`, `alveron-n8n-postgres` (`127.0.0.1:5432`).
- No prior library data existed on this host, so there is nothing to migrate and
  no data to delete. The existing n8n PostgreSQL is left alone; the library uses
  its own container and volume.

## 1. Provision (no root)

```bash
sudo -v   # only if you have a password; not required for this step
git clone /var/www/...  # see the deploy commit; or copy the reviewed tree
cd /var/www/alveron-library
./deploy/provision.sh
```

`provision.sh` downloads and verifies `bin/minio` + `bin/mc`, creates
`data/`, `logs/`, `backups/`, and writes `deploy/.env` and `.env.local` (both
mode 600) with fresh random secrets. The generated owner password is written
once to `.owner-credentials.txt` (mode 600); it is never printed.

## 2. Database

```bash
cd /var/www/alveron-library
docker compose --env-file deploy/.env -f deploy/docker-compose.yml up -d
npm ci
npm run db:migrate
npm run db:bootstrap
```

`db:bootstrap` is one-time and refuses if an owner already exists. After it
succeeds and you have logged in once, delete the three `AUTH_BOOTSTRAP_*` lines
from `.env.local` (see `docs/LIBRARY.md`). Do **not** delete the login code: it
protects uploads, edits, deletes and token management.

## 3. MinIO

```bash
cd /var/www/alveron-library
pm2 start deploy/alveron-library.ecosystem.config.cjs --only alveron-library-minio
sleep 3
./deploy/minio-bootstrap.sh     # bucket + least-privilege user, idempotent
npm run storage:verify
```

`minio-bootstrap.sh` creates a private bucket (`mc anonymous set none`) and a
user restricted to `Get/Put/Delete/List` on that bucket. The app uses that user,
not the root credential. The console (9001) is loopback-only and optional.

## 4. Build and run

```bash
cd /var/www/alveron-library
npm run build
pm2 start deploy/alveron-library.ecosystem.config.cjs --only alveron-library
pm2 save
curl -fsS http://127.0.0.1:3001/api/status
```

The app refuses `STORAGE_PROVIDER=local` under `NODE_ENV=production`; it must
use the MinIO S3 endpoint.

## 5. HTTPS (requires your sudo password — not run by the agent)

```bash
sudo cp deploy/nginx/limits.conf /etc/nginx/conf.d/alveron-library-limits.conf
sudo cp deploy/nginx/alveron-library.bootstrap.conf /etc/nginx/sites-available/alveron-library
sudo ln -sf ../sites-available/alveron-library /etc/nginx/sites-enabled/alveron-library
sudo nginx -t && sudo systemctl reload nginx

sudo certbot certonly --nginx -d library.alveronfashion.com

sudo cp deploy/nginx/alveron-library.conf /etc/nginx/sites-available/alveron-library
sudo nginx -t && sudo systemctl reload nginx
sudo certbot renew --dry-run
```

Verify: `curl -I http://library.alveronfashion.com` returns `301` to HTTPS;
`curl -I https://library.alveronfashion.com/login` returns `200` with a valid
certificate; `openssl s_client` negotiates TLS 1.2 or better.

## 6. Backups

```bash
cd /var/www/alveron-library
./deploy/backup.sh                 # -> backups/<UTC timestamp>/
```

Each run produces `database.dump` (pg_dump custom format) plus `minio/` (a
mirror of the private bucket) and SHA-256 manifests. Copy the directory off the
VPS; a backup on the same disk is not a backup.

Restore (destructive — verify the dump first):

```bash
docker exec -i alveron-library-postgres pg_restore \
  -U catalogue -d alveron_catalogue --clean --if-exists < database.dump
./bin/mc alias set restore http://127.0.0.1:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD"
./bin/mc mirror --overwrite minio/ restore/alveron-library
```

Then run `npm run storage:verify` and `curl` the original route for a known
image; the route re-hashes and returns 503 if the restored bytes do not match
the database checksums.

## 7. Rollback

- App: `pm2 stop alveron-library`, `git checkout <previous commit>`,
  `npm ci && npm run build`, `pm2 start ... --only alveron-library`.
- nginx: `sudo rm /etc/nginx/sites-enabled/alveron-library` and reload; the
  existing sites are untouched.
- Database: restore the last dump (above). The migration set is additive, so an
  older build ignores newer tables.
- Storage: `mc mirror` the backup back into the bucket.
- The existing storefront, API and n8n are never modified by this deployment.

## 8. Routine checks

```bash
pm2 list
curl -fsS http://127.0.0.1:3001/api/status
curl -fsS -H "Authorization: Bearer $TOKEN" \
  "https://library.alveronfashion.com/api/library/search?limit=1" | jq '.total'
ss -lnt | grep -E ':(3001|55432|9000|9001)\b'   # all must be 127.0.0.1
docker exec alveron-library-postgres pg_isready -U catalogue
df -h /var/www/alveron-library
```

Log rotation: PM2 logs go to `logs/`; install `pm2-logrotate` or truncate them.
Never log signed URLs or tokens — the app does not.
