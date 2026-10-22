# Audit — Alveron Catalogue Studio → Product Image Library

Date: 2026-10-22. Audited against commit `07001fe`.

## Baseline measured before any change

| Gate | Result |
|---|---|
| `tsc --noEmit` | pass |
| `npm test` (unit) | 35 / 35 pass |
| `npm run lint` | **FAIL** — 5 errors, all in catalogue files (unused imports, useless assignment) |
| Existing data in `alveron_catalogue` | 2 products, 5 images, 988 bytes of originals |

The lint failures are all inside catalogue-only code that this task removes.

## What exists today

### Routes (18 API + 9 pages)

| Area | Files | Needed for a library? |
|---|---|---|
| `api/products` (list/create), `api/products/[id]` (get/patch/delete) | 2 | **yes** |
| `api/products/[id]/images` (upload), `[imageId]` (serve/review/delete) | 2 | **yes** |
| `api/products/[id]/images/[imageId]/derivatives/[kind]` | 1 | **yes** (thumbnails) |
| `api/auth/login`, `api/auth/logout` | 2 | **yes** (keeps the app private) |
| `api/status`, `api/settings/health` | 2 | yes (health/capacity) |
| `api/catalogues/*` (5 files), `api/catalogues/[id]/generate|compose|editorial|export|decision` | 9 | **no** |

Pages: `login`, `products`, `settings` are needed. `dashboard`, `outfits`, `generate`, `review`, `approved` are catalogue-only.

### Schema (5 migrations, 20 tables)

Library needs exactly 6: `studio_users`, `sessions`, `products`, `product_images`, `product_image_derivatives`, `product_upload_requests` (+ `audit_events` for traceability).

Catalogue-only: `catalogues`, `catalogue_items`, `catalogue_approvals`, `catalogue_rejections`, `catalogue_exports`, `generated_assets`, `generation_jobs`, `generation_job_attempts`, `generation_invented_items`, `product_variants`, `storage_recovery_objects`.

### Storage — already correct, preserve as-is

- Originals: `products/{productId}/{imageId}.{ext}` via `PrivateStorage` (`put`/`get`/`remove`/`head`).
- Derivatives: `derivatives/{productId}/{imageId}-{kind}.webp` — **different key prefix, so a derivative cannot overwrite an original by construction.** This is the guarantee the brief asks for and it already holds.
- Every upload is SHA-256 hashed and size-checked; `products` and `product_images` rows record `sha256` and `byte_size`, and the serve route re-hashes bytes before returning them.

### Auth — real, not decorative

`studio_users` + bcrypt + HMAC-hashed session tokens in `sessions`, httpOnly/strict cookie, 12h expiry. Every mutating route also checks `isSameOrigin` (14 files). There is no public signup.

## Deployment exposure (this decides the privacy question)

- **No `render.yaml`, no `vercel.json`, no production deployment.** The project has only ever run locally plus a temporary Cloudflare tunnel started for review.
- Therefore the "publicly reachable" branch of the brief does **not** currently apply, and removing the login would make a reachable instance world-writable the moment a tunnel or deploy exists.

**Decision:** keep the login, and add a separate, scoped, read-only API token for ChatGPT. A token can be revoked independently of the owner's browser session, and it cannot upload or delete.

## What ChatGPT can and cannot do here

ChatGPT cannot reach `localhost`, a LAN address, or files on this disk. It can call a public HTTPS API with a bearer token — that is the only supported path, and it is what this build implements.

Required contract:
1. `GET /api/library/search` — list/search products, returns IDs + metadata.
2. `GET /api/library/products/{id}` — full metadata for one product.
3. `GET /api/library/products/{id}/images/{imageId}/original` — **actual original bytes**.
4. Multi-select: search accepts repeated `id` params; a batch endpoint returns several products in one call.

## Planned change set (smallest safe)

| Change | Risk |
|---|---|
| Delete catalogue pages/routes/libs/components | none — no library code imports them |
| Stop generation worker, remove FAL/Qwen config | none — library never calls them |
| New migration `006`: add `api_tokens`; catalogue tables left in place, documented as retired | low — additive only |
| Add `api/library/*` read-only routes | low — new files |
| Nav/settings trimmed to library scope | low |

**Not doing:** dropping catalogue tables, deleting `products`/`product_images` rows, rewriting migrations, resetting storage. All reversible decisions stay reversible.
