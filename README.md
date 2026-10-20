# Alveron Catalogue Studio

A private, standalone product-catalogue studio for Alveron Fashion. It is built from the actual product photographs uploaded by the studio owner. The initial release includes the private studio shell, owner sign-in, Product Library, immutable original-image storage, per-image review markers, an outfit brief that references exact reviewed products and image views, and a source-only editorial composition preview that uses those original photos unchanged.

**Image generation, source-versus-output approval, catalogue export, and storefront publishing are not implemented.** The generator is visibly disabled and does not return demo art. Nothing is published automatically.

## Stack and pinned versions

The lockfile records exact resolved dependency versions. The initial direct pins are:

| Area | Version |
|---|---|
| Next.js App Router | 16.4.2 |
| React / React DOM | 19.3.1 |
| TypeScript | 5.9.3 |
| Tailwind CSS / PostCSS integration | 4.3.3 |
| Node PostgreSQL driver | pg 8.23.1 |
| PostgreSQL local container | 18.6 Alpine |
| Zod | 4.6.7 |
| S3 client | AWS SDK client-s3 3.1153.0 |
| Image metadata/decode validation | Sharp 0.35.5 |
| File signature detection | file-type 22.2.0 |
| Password hashing | bcryptjs 3.0.3 |
| Icons | lucide-react 1.59.0 |
| Lint | ESLint 10.13.0, @eslint/js 10.0.1, typescript-eslint 8.72.0, eslint-plugin-react-hooks 7.1.1 |
| Test runner | Node test runner with tsx 4.23.15 |

Use Node.js 22.9 or newer (the project was scaffolded with Node 22.23.1), npm, and Docker Compose. Next.js 16 itself documents a Node.js 20.9 minimum; the higher project minimum is for Node's `--env-file-if-exists` setup scripts.

## Local development

1. Install packages:

   ```bash
   npm ci
   ```

2. Create a local environment file and replace the placeholders. Use unique local secrets; the template password is intentionally rejected by the bootstrap script.

   ```bash
   cp .env.example .env.local
   openssl rand -hex 24
   ```

   Put the generated value into `SESSION_SECRET`. Set `AUTH_BOOTSTRAP_EMAIL`, `AUTH_BOOTSTRAP_NAME`, and a unique `AUTH_BOOTSTRAP_PASSWORD` of at least 16 characters. Set the same local database password in `POSTGRES_PASSWORD` and in the password portion of `DATABASE_URL`.

3. Start PostgreSQL on loopback only (host port 55432 avoids common local PostgreSQL ports):

   ```bash
   docker compose --env-file .env.local up -d postgres
   ```

4. Create/update the schema and create the first owner account:

   ```bash
   npm run db:migrate
   npm run db:bootstrap
   ```

   Owner bootstrap is one-time and refuses to run if an account already exists.

5. Start the studio:

   ```bash
   npm run dev
   ```

   Visit `http://localhost:3000` and sign in with the configured owner account. Stop PostgreSQL with `docker compose down`; keep its volume with `docker compose down` and delete data only with an explicit `docker compose down -v`.

Local original photos are stored beneath `.local-data/private/`, outside `public/`, with restrictive filesystem permissions. They are excluded from Git. Local storage is refused in production.

## Private storage configuration

Local mode needs no storage service or paid account. For deployment, set `STORAGE_PROVIDER=s3`, `S3_BUCKET`, and `S3_REGION`; set `S3_ENDPOINT` for an S3-compatible endpoint and `S3_FORCE_PATH_STYLE=true` only when that endpoint requires it. Credentials may use the server's IAM/workload identity, or the server-only `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` variables. Use a private bucket with public access blocked. The application does not set public ACLs or generate public URLs.

Original images are limited to JPEG, PNG and WebP, 15 MB each, up to five per product. The server checks file signatures and image dimensions, stores the uploaded bytes unchanged under a unique key, records a SHA-256 checksum, and serves photos through an authenticated, no-store route. Product image rows cannot be edited through the UI/API; replacement workflows are intentionally absent.

## Routes

- `/dashboard` — inventory and review overview
- `/products` — add products, upload and inspect every image, mark views reviewed
- `/outfits` — explicitly select reviewed products, source views, item roles, one style, and one occasion
- `/generate` — provider readiness; generation is disabled until a real adapter is built and configured
- `/review` — outfit brief with original source views, checksums and an unchanged-photo composition preview; output approval is disabled
- `/approved` — approval archive (empty until approval/export exists)
- `/settings` — non-secret database, storage, session and generation status
- `/login` — private owner sign-in; no public account creation
- `/api/status` — non-secret local readiness status

## Data integrity and security

- All studio pages and private image routes require a database-backed session. Sessions use random HttpOnly, SameSite=Strict cookies and HMAC-hashed tokens; production cookies are Secure.
- State-changing browser requests require a same-origin `Origin` header. Login attempts are throttled per process.
- SQL migrations define users, sessions, products, original images, image reviews, catalogues, source-product links, jobs, generated-asset metadata, approvals and audit events.
- Every catalogue item stores a product ID and an image ID constrained to that same product. The API blocks outfit creation while any accessible product image remains unreviewed.
- An image model is not allowed to stand in for the original garment. The provider adapter returns “unconfigured” and cannot generate until implementation work connects a real provider.
- Export and publishing APIs do not exist in this stage.

## Checks

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

The unit tests cover product metadata uncertainty, category validation, one-style/one-occasion constraints, explicit mixed-style requests, unique product references, private-access decisions, same-origin writes, and storage-path traversal rejection.
