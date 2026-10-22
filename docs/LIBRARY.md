# Alveron Product Library — how to use it

This is a private, persistent library for Alveron Fashion product photographs. It
stores the real uploaded images and lets ChatGPT retrieve them for styling ideas.
It does not generate images, build outfits or compose catalogues.

## 1. Run it locally

```bash
cp .env.example .env.local      # then set DATABASE_URL, SESSION_SECRET
npm install
npm run db:migrate              # additive migrations only
npm run db:bootstrap            # creates the single owner account
npm run dev                     # http://localhost:3000
```

Sign in at `/login` with the owner account you bootstrapped.

> Local filesystem storage is refused when `NODE_ENV=production` (see
> `src/lib/storage.ts`). For production, configure a private S3 bucket.

## 2. Upload products

`/products` → **New product**. Pick 1–5 images per upload (JPEG, PNG or WebP,
15 MB each). Each image is checksummed (SHA-256) and stored under its own
immutable key. Previews live under a separate `derivatives/` prefix, so a
thumbnail can never overwrite an original.

Bulk upload many products by repeating the form. There is no cap on the number
of products; the only limit is free disk space, shown in Settings.

## 3. Browse, search, edit, delete

- Search by name, colour, tag, filename or product ID.
- Filter by category and availability; paginate large collections.
- Click any image to open the original at full resolution.
- **Edit details** changes metadata only (partial updates supported).
- **Delete** removes the product, its rows and its files. Bulk delete is
  available from the library API. Both require a signed-in owner.

## 4. Let ChatGPT read the library

ChatGPT cannot reach `localhost`, a LAN address or files on this machine. It needs
a public HTTPS URL. That is the one piece you must provide.

### Step A — expose the app over HTTPS

Either deploy it (e.g. Render) or, for a temporary trial, run a tunnel:

```bash
cloudflared tunnel --url http://localhost:3000
```

Note the `https://…` address it prints.

### Step B — create a read-only token

In **Settings & Access → ChatGPT retrieval tokens**, click **Create token** and
copy the value immediately. It is shown once and never stored — only its SHA-256
hash is kept. The token:

- can **read** products and download originals;
- **cannot** upload, edit or delete anything;
- can be revoked at any time, which stops access immediately;
- is independent of your browser login, so revoking it does not sign you out.

### Step C — connect ChatGPT

In ChatGPT, add a custom connector / action pointing at your HTTPS base URL and
send the header:

```
Authorization: Bearer alv_lib_…
```

Point ChatGPT at the four endpoints below. A minimal OpenAPI description follows.

### The API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/library/search` | Search/list products. `?q=`, `?category=`, `?colour=`, `?tag=`, `?ids=`, `?limit=`, `?offset=` |
| GET | `/api/library/products/{id}` | Full metadata + every image for one product |
| GET | `/api/library/products/{id}/images/{imageId}/original` | **The exact uploaded bytes** |
| POST | `/api/library/batch` | `{"ids":[...]}` — several products in one call |

Every response includes, per image, an `originalUrl` plus `sha256`, `width`,
`height`, `mediaType` and `viewLabel`, so a styling request can tell colour
variants and multiple views apart.

Original bytes are re-hashed on every read and compared to the checksum recorded
at upload. A mismatch returns 503 rather than serving an unverified file.

### Minimal OpenAPI for the ChatGPT connector

```yaml
openapi: 3.1.0
info: { title: Alveron Product Library, version: "1.0" }
servers: [{ url: "https://YOUR-PUBLIC-HOST" }]
security: [{ bearerAuth: [] }]
components:
  securitySchemes:
    bearerAuth: { type: http, scheme: bearer }
paths:
  /api/library/search:
    get:
      operationId: searchProducts
      summary: Search the Alveron product library
      parameters:
        - { name: q, in: query, schema: { type: string }, description: "name, colour, tag, filename or product id" }
        - { name: category, in: query, schema: { type: string } }
        - { name: colour, in: query, schema: { type: string } }
        - { name: limit, in: query, schema: { type: integer, default: 24, maximum: 100 } }
        - { name: offset, in: query, schema: { type: integer, default: 0 } }
      responses: { "200": { description: Matching products with originalUrl links } }
  /api/library/products/{productId}:
    get:
      operationId: getProduct
      summary: Full metadata and images for one product
      parameters: [{ name: productId, in: path, required: true, schema: { type: string } }]
      responses: { "200": { description: Product with all images } }
  /api/library/products/{productId}/images/{imageId}/original:
    get:
      operationId: getOriginalImage
      summary: Download the exact original uploaded image
      parameters:
        - { name: productId, in: path, required: true, schema: { type: string } }
        - { name: imageId, in: path, required: true, schema: { type: string } }
      responses: { "200": { description: The original image bytes } }
  /api/library/batch:
    post:
      operationId: getProducts
      summary: Resolve several products in one call
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              properties: { ids: { type: array, items: { type: string }, maxItems: 50 } }
      responses: { "200": { description: Products plus a list of any missing ids } }
```

## 5. Security model

| Surface | Protection |
|---|---|
| All app pages and product APIs | Owner login (bcrypt + HMAC session cookie) |
| Upload / edit / delete | Owner login **and** same-origin check |
| `/api/library/*` | Read-only bearer token, scope `library:read` |
| `/api/status` | Public but exposes only up/down — no counts or data |
| Original files | Never public; served only through authenticated routes |

No permanent public image URLs exist. No credential is ever sent to the browser.

## 6. What is verified and what is not

Verified automatically (`npm run test:library`, 16 checks): bulk upload,
persistence across a restart, SHA-256 match on served bytes, derivatives not
overwriting originals, metadata edits, search/filter/pagination, anonymous
access refused, token auth (search, originals, batch, missing ids, no mutation),
single and bulk delete with file cleanup, failed-upload recovery, and
database/filesystem consistency.

**Not verified:** an actual ChatGPT connector round-trip. That requires a public
HTTPS URL and configuration inside ChatGPT, which cannot be done from this
repository. Everything on the server side of that connection is tested.
