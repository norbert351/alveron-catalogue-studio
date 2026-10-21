# Alveron Catalogue Studio

Private, standalone Alveron Fashion catalogue studio. The application is built around original owner-uploaded product photographs, explicit outfit selection, and human approval. It does not connect to or publish to the Alveron storefront.

## Current capability and boundary

The application provides authenticated owner/editor access, product and image management, review of every accessible source image, outfit drafts, source-photo catalogue composition, persistent generation request records, source/output review, rejection/correction, checksum-bound approval, and authorized PNG/JPEG/PDF export. Original photos and derived assets are stored privately and are never overwritten.

**A real image-generation provider is not connected.** Generation is disabled and no garment photos are sent to an external model. A provider adapter interface and persistent blocked-job record are present, but enabling provider egress requires selecting and authorizing a specific provider. The available alternative is an explicitly labeled source-photo composition, which uses the actual uploaded images and does not claim to show a generated mannequin. Every output still requires human approval.

There is no product hard-delete operation. Products are archived or restored; original photos and history remain retained. No export is allowed without current approval for the exact output checksum and source inventory revision.

## Stack and versions

The lockfile pins the full resolved dependency graph. Direct versions include:

| Component | Version |
|---|---:|
| Next.js App Router | 16.4.2 |
| React / React DOM | 19.3.1 |
| TypeScript | 5.9.3 |
| Tailwind CSS / PostCSS | 4.3.3 |
| PostgreSQL | 18.6 Alpine container |
| `pg` | 8.23.1 |
| Zod | 4.6.7 |
| AWS SDK S3 client | 3.1153.0 |
| Sharp | 0.35.5 |
| `file-type` | 22.2.0 |
| `bcryptjs` | 3.0.3 |
| `server-only` | 0.0.1 |
| ESLint | 10.13.0 |
| Node test runner / tsx | Node 22.23.1 / 4.23.15 |

Use Node.js 22.9 or later, npm, and Docker Compose. The project is private; no production credentials are included.

## Local setup

```bash
npm ci
cp .env.example .env.local
```

Replace local placeholders. Create a unique `SESSION_SECRET` (at least 32 characters), `AUTH_BOOTSTRAP_EMAIL`, `AUTH_BOOTSTRAP_NAME`, and owner password (at least 16 characters). Use the same local PostgreSQL password in `POSTGRES_PASSWORD` and `DATABASE_URL`.

```bash
openssl rand -hex 32
docker compose --env-file .env.local up -d postgres
npm run db:migrate
npm run db:bootstrap
npm run dev
```

Open `http://localhost:3000`. Bootstrap only creates the first owner and refuses to create a default or additional account. There is no public signup route. Apply schema updates with `npm run db:migrate`; migrations are additive and recorded in `schema_migrations`. Do not use database reset commands on an existing studio.

The Compose database uses a named `catalogue-postgres` volume at PostgreSQL's data directory and binds only to `127.0.0.1:55432`. `docker compose down` retains database data; `docker compose down -v` deletes the volume and should only be used for a disposable test environment.

## Routes

| Route | Purpose |
|---|---|
| `/dashboard` | Product, source-image, draft and review counts |
| `/products` | Product metadata, upload/version views, private previews, review, search/filter, archive/restore |
| `/outfits` | Exact products and source-image selection, roles, one style/occasion, saved draft editing |
| `/generate` | Provider status and persisted generation-job history; external generation disabled |
| `/review` | Source/output comparison, original-photo composition, reject/correction/approve controls |
| `/approved` | Approved output versions and PNG/JPEG/PDF downloads |
| `/settings` | Redacted connection status, health checks, limits, queue and upload recovery counts |
| `/login` | Private owner/editor sign-in |

All studio routes are inside the authenticated layout. Product and output images are served from authenticated server routes with `private, no-store` headers; storage credentials and permanent public object URLs are never sent to the browser.

## Product uploads and retention

Accepted formats are JPEG, PNG, and WebP. Each file is limited to 15 MB, and each upload request accepts up to five images (maximum request about 75 MB). The server enforces multipart size, file signature, image decoding, pixel bounds, MIME type, SHA-256, and dimensions. Original bytes are written unchanged to immutable, random-ID storage keys. The database stores image ID, product ID, key, MIME type, dimensions, size, checksum, view label, upload time, storage provider, and optional superseded-image link.

Supported views are front, back, side, close-up, detail, and colour/design. Replacing a view adds a new original record and marks the earlier record as a previous version; it never edits the prior object. Every accessible image version remains available and must be reviewed. New uploads and material product changes advance a persistent inventory revision, invalidate prior approvals, and require a fresh output review.

Product details and tags are owner-entered. The UI labels them accordingly; the studio does not infer hidden material, colour, fit, or construction information. Unverified fields stay blank. Unavailable and archived products cannot be newly selected. Archiving is reversible and does not delete the product or its images.

## Storage

### Local development

`STORAGE_PROVIDER=local` writes files under `LOCAL_STORAGE_DIR`, default `.local-data/private/`.

**Where it actually points.** The path is resolved to an absolute location anchored to the project directory, *not* to the process working directory. Starting the app from a different cwd (a systemd unit, a container `WORKDIR`, cron, `/tmp`) therefore still finds the same images. The app refuses to start if `LOCAL_STORAGE_DIR` resolves inside `.next/`, `public/`, `/tmp/` or `node_modules/`, because those are disposable or public. Verify any deployment with:

```bash
npm run storage:root   # prints the resolved absolute store; fails if unsafe
```

**What must be backed up (and what must not be relied on):**

| Path / volume | Contains | Back up? |
|---|---|---|
| `LOCAL_STORAGE_DIR` (default `./.local-data/private/`) | Every original photo, display derivative, catalogue output and export | **Yes — required** |
| PostgreSQL database (Docker volume `catalogue-postgres`) | Product, image, review, catalogue, approval, export and audit records; also sessions | **Yes — required** |
| `.local-data/migration-reports/` | Storage-migration JSON reports | Recommended (operational history) |
| `.next/`, `node_modules/` | Build output and dependencies | No — regenerated by `npm ci && npm run build` |
| `public/` | Static app assets only | No — never holds product images |

Everything the studio needs to reconstruct itself is in the first two rows. A database-only backup cannot restore image bytes; a file-only backup cannot restore which product an image belongs to, nor its checksum, approvals or export records.

### Docker persistence

The Compose file uses a **named volume** for the database, so data survives container recreation:

```yaml
volumes:
  - catalogue-postgres:/var/lib/postgresql   # survives down/up, NOT down -v
```

- `docker compose down` retains data.
- `docker compose down -v` **deletes the database volume**. Never run it against an environment you want to keep; use it only for a disposable test database.
- Image files live on the host filesystem (`LOCAL_STORAGE_DIR`), not in a container layer, so container rebuilds and recreation do not touch them.
- If you put the app itself in a container, mount the image store as a volume (e.g. `-v alveron-images:/data/alveron` with `LOCAL_STORAGE_DIR=/data/alveron`) rather than writing into the image filesystem, which is discarded on rebuild.

### S3-compatible private storage

For a private S3-compatible bucket set server-only `STORAGE_PROVIDER=s3`, `S3_BUCKET`, and `S3_REGION`; set `S3_ENDPOINT` for compatible endpoints and `S3_FORCE_PATH_STYLE=true` only if required. Set `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` on the server, or use the server's workload/IAM credentials. Keep bucket public access blocked. Uploads use immutable conditional writes; images are read through authenticated routes. The settings health check issues a bucket health request without displaying credentials.

The application does not silently fail over between local and S3 storage. A configured backend outage is shown as unavailable; the original row and checksum remain intact.

Both backends implement one `PrivateStorage` interface (`put`, `get`, `remove`, `head`, `health`), so all routes work unchanged against either. Access is always proxied through authenticated, authorized server routes that check the database before returning bytes; no permanent public URL is ever generated or sent to the browser, and no storage credential is exposed to client code.

### Storage health check

```bash
npm run storage:verify             # verify every referenced object; report drift and orphans
npm run storage:verify -- --json   # machine-readable
npm run storage:verify -- --record # also stamp last_verified_* and image_integrity_checks
```

It checks presence, byte size and SHA-256 for every original, derivative, output and export; lists files present on disk but unreferenced (orphans) without deleting anything; and exits non-zero when anything has drifted. The same result is summarised on `/settings`, and `GET /api/settings/health` performs a live database + backend probe.

### Display derivatives

Each original gets a thumbnail (480 × 600) and preview (1080 × 1350) WebP copy. They are re-encodes stored under a separate `derivatives/` key space and recorded in `product_image_derivatives` with the `source_sha256` they were made from. They are display-only: originals are never overwritten, and if a derivative is missing, stale or corrupt the UI falls back to the authenticated original route. Measured on a 4000 × 5000 photo: 15.7 MB original → 3 KB thumbnail / 356 KB preview.

### Copy-and-verify storage migration

The migration inventories database-referenced originals, outputs, and exports. It copies without deleting the source, verifies byte size and SHA-256, updates a row's provider reference only after verification, resumes when an identical destination already exists, and fails on destination conflicts instead of overwriting them. A timestamped JSON report is written beneath `.local-data/migration-reports/` by default.

For local to S3, first keep `STORAGE_PROVIDER=local` so legacy rows without a provider marker resolve to their current backend, configure S3 settings, then run:

```bash
npm run storage:migrate -- --from local --to s3
```

Inspect the report and failed rows. After every source record is verified and migrated, set `STORAGE_PROVIDER=s3`. Source files are retained; remove them only under a separately approved retention process. For production, keep the configured backend private and test restore before retiring any source storage.

## Outfit, generation, review and export

Outfit drafts store exact product/image IDs and roles, one style, one occasion, and the inventory revision. A top and bottom (or an uploaded set) are required. Mixed style is recorded only when the owner explicitly checks the request. Server endpoints recheck current availability, review status, exact product-image relationships, and inventory revision.

`POST /api/catalogues/{id}/generate` records an idempotent persistent job. Because no specifically selected and authorized provider is configured, the job is stored as blocked with `provider_not_configured`; it does not send product photographs anywhere. Job state, input snapshot, retry/attempt fields, failure details, and timestamps are in PostgreSQL.

The source-photo composer creates a derived 1080 × 1350 editorial layout exclusively from exact selected uploads. It is marked `original-photo-composition`, not AI output. Output files are separately stored with source snapshots and SHA-256. The review page shows the output beside source images and labels the fallback type.

Approval records bind reviewer, output ID, output checksum, and catalogue revision. A source change or new output invalidates older approval rows without deleting audit history. Rejection requires a reason; correction returns the draft to an editable state. The export API rechecks approval in PostgreSQL and private storage, and records format, dimensions, requesting user, approval, output checksum, export checksum, and timestamp. PNG, JPEG, and one-page PDF use 1080 × 1350 by default. Export does not publish to a storefront or social account.

## Migrations, tests and checks

```bash
npm run db:migrate
npm run lint
npm run typecheck
npm test
npm run build
```

`npm test` runs **35** tests. Unit tests cover image validation, write-once originals, storage-key guards (including the PDF-extension regression), authorization rules, mixed-style input, approval checksum/revision checks, PDF structure, the source-photo renderer and pagination maths. Database-backed tests (skipped automatically when `DATABASE_URL` is absent) cover checksum-matched bytes on disk, image/product references surviving a reconnect, originals being immutable at the schema level, derivative/original key separation, the review gate counting every image regardless of page, idempotent uploads, recoverable failed uploads, dequeuing exclusivity, lease recovery after a crashed worker, retry limits and idempotent job completion.

`npm run test:e2e` starts a real Next.js server on port 3100 and exercises **10** checks: owner auth, all seven routes, multi-image upload, idempotency, source checksum, review-gate invalidation, exact outfit references, one-style/one-occasion validation, blocked generation job persistence, source-photo composition, rejection/correction/approval, approved PNG/JPEG/PDF export with provenance, missing-object recovery, a **real app-process restart**, approval invalidation on new uploads, derivative separation, and storage health.

```bash
npm run build
ALVERON_TEST_PORT=3100 npm run test:e2e
npm audit --omit=dev
```

**What is verified, and what is not:**

| Claim | Status |
|---|---|
| Image bytes persist across a real app restart | **Verified** — e2e stops and restarts the Next.js process, then re-reads the same checksum from authenticated routes |
| Originals can never be overwritten | **Verified** — database triggers reject key/checksum/size changes; tested directly |
| Private images require an authenticated studio user | **Verified** — anonymous requests return 401 in unit and e2e tests |
| Export requires a current approval for the exact checksum | **Verified** — pending/rejected/stale approvals return 409 |
| Queued generation work survives a restart | **Verified** — lease recovery and connection-drop tests |
| S3-compatible storage works | **NOT verified** — no bucket/credentials available here. The adapter implements the same interface and the migration command is tested up to the point of S3 authentication; verify against your own endpoint |
| Real AI image generation | **NOT verified and not implemented** — no provider adapter exists. `IMAGE_GENERATION_PROVIDER=none`; the settings screen reports generation as not configured, and jobs are stored as `blocked` with `provider_not_configured`. The labelled original-photo composition is the available output and is never presented as AI-generated |
| Automated garment-fidelity verification | **Does not exist.** Human approval is the only fidelity gate; no automated visual check is claimed |

S3 behaviour must be verified against the operator's own endpoint and permissions; local checks do not claim that integration.

## Backup and restore

Back up PostgreSQL **and** the local original/generated/export storage directory. A database-only backup cannot restore product bytes; a file-only backup cannot restore product/image relationships, approvals, or export records. For S3, use provider-side private bucket versioning/backup policy and separately back up PostgreSQL.

Example custom-format PostgreSQL backup:

```bash
pg_dump --format=custom --file=alveron-catalogue.dump "$DATABASE_URL"
tar -czf alveron-private-storage.tar.gz .local-data/private
```

Restore into a newly provisioned empty database and a separate local storage directory before switching the application:

```bash
pg_restore --no-owner --dbname="$RESTORE_DATABASE_URL" alveron-catalogue.dump
mkdir -p "$RESTORE_STORAGE_DIR"
tar -xzf alveron-private-storage.tar.gz -C "$RESTORE_ROOT"
```

Set `LOCAL_STORAGE_DIR` to the restored directory, run migrations, then validate `/api/settings/health`, product/image counts, and sampled SHA-256 values before allowing studio use. Do not restore over a live database or delete the original backup before verification.

## Security and operating limits

- Sessions are stored in PostgreSQL with hashed tokens; cookies are HttpOnly, SameSite=Strict, and Secure in production. Session lifetime is 12 hours.
- Mutating browser requests require a same-origin `Origin`. Product, image, catalogue, approval, and export handlers check the authenticated studio role.
- Login, upload, generation-request, and export operations have rate limits. Files have strict format, size, pixel, and path validation.
- Upload failures retain a failed idempotency record and planned object keys for recovery inspection. Derived-output and export writes have recovery records until their database rows commit.
- Original images are never deleted by normal application actions. There is no automated retention purge or physical delete endpoint.
- No database image blobs, mock provider images, public object URLs, default owner passwords, automatic export, or publishing integrations are used.

Before production use, configure private S3-compatible storage, secrets/session management, operational PostgreSQL backups, an authorized provider and its image-egress policy if AI generation is desired, and verify the complete deploy/restore procedure in a non-production environment. This project has not been deployed or declared production-ready.
