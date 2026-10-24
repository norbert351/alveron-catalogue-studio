# Alveron Product Library — how to use it

This is a private, persistent library for Alveron Fashion product photographs. It
stores the real uploaded images and lets trusted clients and a private
server-side vision bridge retrieve exact originals. It does not generate images,
build outfits or compose catalogues.

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

Use a **Custom GPT Action**, not a connector:

- ChatGPT connectors/MCP apps authenticate with OAuth 2.1 only; OpenAI documents
  that ChatGPT cannot present a custom API key. The `alv_lib_…` token therefore
  cannot be used by a hosted connector.
- GPT Actions are the only ChatGPT surface that accepts a static bearer token:
  **Authentication → API Key → Bearer**, value `alv_lib_…`.
- Import the live schema at
  **`https://library.alveronfashion.com/api/library/openapi.json`**.
  It documents only the three operations needed here: list every original,
  search products, and retrieve one original image.
- The list/search actions return an `originalUrl` that is already signed and
  short-lived. Opening it returns the exact original photo; no bearer header is
  needed for that URL. Signed links expire after 10 minutes.

Setup: **ChatGPT → GPT → Configure → Actions → Add actions → Import from URL**,
paste the schema URL, then set **Authentication → API Key → Bearer** and paste
the `alv_lib_…` token. The schema itself is public because it contains no product
data or credentials. Use `listProductImages` to browse the whole catalogue,
`searchProducts` to find a garment by name or id, and `getOriginalImage` to open
its original image.

### The API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/library/images` | **Every original image in the library.** `?limit=` (1–100, default 100), `?offset=`, optional `?productId=` |
| GET | `/api/library/search` | Search/list products. `?q=`, `?category=`, `?colour=`, `?tag=`, `?ids=`, `?limit=`, `?offset=` |
| GET | `/api/library/products/{id}` | Full metadata + every image for one product |
| GET | `/api/library/products/{id}/images/{imageId}/original` | **The exact uploaded bytes** |
| POST | `/api/library/batch` | `{"ids":[...]}` — several products in one call |

`GET /api/library/images` is the smallest possible visual index: each item has
only `productId`, `imageId` and a short-lived `originalUrl`. It returns
pagination fields (`total`, `limit`, `offset`, `hasMore`, `nextOffset`) and
nothing else. Pass `productId` to list just one product's photos.

Every response includes, per image, an `originalUrl` plus `sha256`, `width`,
`height`, `mediaType` and `viewLabel`, so a styling request can tell colour
variants and multiple views apart.

Original bytes are re-hashed on every read and compared to the checksum recorded
at upload. A mismatch returns 503 rather than serving an unverified file.

### Signed original URLs (optional)

A browser click or an image fetcher cannot send `Authorization: Bearer`. With
`LIBRARY_SIGNING_SECRET` set, responses also include a `signedOriginalUrl`:

```
…/original?exp=<unix-seconds>&sig=<hmac-sha256>
```

- default lifetime 10 minutes, maximum 1 hour;
- bound to one product id + image id, so a link cannot be replayed elsewhere;
- accepted only by the original-image route, and only when no `Authorization`
  header was sent (bearer auth is unchanged and takes precedence);
- expired, malformed or tampered links get `403`; the secret never appears in a
  response or a log.

Rotating `LIBRARY_SIGNING_SECRET` invalidates every outstanding link.

### MCP bridge (image content for vision-capable clients)

`mcp/` is a read-only stdio MCP server with three tools: `search_products`,
`get_product` and `get_original_image`. It calls this HTTP API, keeps the bearer
token in its own environment, verifies the SHA-256 of every image it returns and
emits an MCP image content block. See `mcp/README.md`.

Because ChatGPT cannot supply the bearer token to an MCP connector, the bridge is
for local/trusted MCP clients (Claude Desktop, Codex, IDE agents) and for an
API-side Responses integration — not for a ChatGPT-hosted connector. Do not
expose it on a public port.

### Private vision bridge (actual image bytes)

`scripts/vision-bridge.mjs` resolves a product/image id through this API,
downloads the original, verifies size, media type and SHA-256, then sends the
verified bytes as base64 image input to a configurable OpenAI Responses API
model. It is a server-side CLI only; it opens no port and adds no public endpoint.
The read-only library token is never sent to OpenAI. See
`docs/VISION_BRIDGE.md`.

This does **not** make the current ChatGPT conversation able to see library
images. A ChatGPT wrapper could only receive the bridge's text analysis. True
image input requires an API-side integration with a vision model, verified in
that environment.

### OpenAPI schema for ChatGPT GPT Actions

The live schema is served at:

```
https://library.alveronfashion.com/api/library/openapi.json
```

It is a valid OpenAPI 3.1 document with exactly three operations:

| operationId | Path | Purpose |
|---|---|---|
| `listProductImages` | `GET /api/library/images` | Paginate every product image; returns product id, image id and signed original URL |
| `searchProducts` | `GET /api/library/search` | Find products by existing name/id and get their original image URL |
| `getOriginalImage` | `GET /api/library/products/{productId}/images/{imageId}/original` | Open the exact original bytes |

The schema is public because it contains no product data or credentials. The
API operations require `Authorization: Bearer alv_lib_…`; the signed image URLs
returned by list/search do not. The schema is generated from the request origin,
so a different deployment automatically advertises its own host.

## 5. Security model

| Surface | Protection |
|---|---|
| All app pages and product APIs | Owner login (bcrypt + HMAC session cookie) |
| Upload / edit / delete | Owner login **and** same-origin check |
| `/api/library/*` | Read-only bearer token, scope `library:read` |
| `/api/library/openapi.json` | Public schema only — no product data or credentials |
| `/api/status` | Public but exposes only up/down — no counts or data |
| Original files | Never public; served with a bearer token or a short-lived signed URL |

No permanent public image URLs exist. Signed URLs expire after 10 minutes and are
bound to one product/image pair. No credential is ever sent to the browser.

## 6. What is verified and what is not

Verified automatically (`npm run test:library`, 16 checks): bulk upload,
persistence across a restart, SHA-256 match on served bytes, derivatives not
overwriting originals, metadata edits, search/filter/pagination, anonymous
access refused, token auth (search, originals, batch, missing ids, no mutation),
single and bulk delete with file cleanup, failed-upload recovery, and
database/filesystem consistency.

**Not verified:** an actual ChatGPT round-trip. That requires the public HTTPS
URL and configuration inside ChatGPT, which cannot be done from this repository.
Everything on the server side of that connection is tested.
