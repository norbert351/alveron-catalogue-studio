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

`STORAGE_PROVIDER=local` writes files under `LOCAL_STORAGE_DIR`, default `.local-data/private/`. This directory is outside `public/`, excluded from Git, and independent of `.next` build output. Do not store it in `/tmp` for normal development. Back up this folder together with PostgreSQL.

### S3-compatible private storage

For a private S3-compatible bucket set server-only `STORAGE_PROVIDER=s3`, `S3_BUCKET`, and `S3_REGION`; set `S3_ENDPOINT` for compatible endpoints and `S3_FORCE_PATH_STYLE=true` only if required. Set `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` on the server, or use the server's workload/IAM credentials. Keep bucket public access blocked. Uploads use immutable conditional writes; images are read through authenticated routes. The settings health check issues a bucket health request without displaying credentials.

The application does not silently fail over between local and S3 storage. A configured backend outage is shown as unavailable; the original row and checksum remain intact.

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

`npm test` covers image validation, write-once originals, authorization rules, mixed-style input, approval checksum/revision checks, PDF structure, and the source-photo renderer. `npm run test:e2e` starts a real Next.js development server on port 3100 and exercises owner auth, routes, multi-image upload, idempotency, source checksum and review, exact outfit references, blocked generation job persistence, source-photo composition, rejection/correction/approval, approved PNG/JPEG/PDF exports, missing-object recovery response, and a real app-process restart. **Run it only with an isolated disposable database and storage directory.** The test requires a bootstrapped test owner. The test itself retains data; remove only its disposable resources afterward.

```bash
npm run build
ALVERON_TEST_PORT=3100 npm run test:e2e
npm audit --omit=dev
```

The E2E test performs a real Next.js process restart and verifies the same source-image bytes and DB-backed session afterward. It does not call a real image-generation service. S3 behavior must be verified against the operator's own S3-compatible endpoint and permissions; local checks do not claim that integration.

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
