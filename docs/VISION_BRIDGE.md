# Private vision bridge

`scripts/vision-bridge.mjs` is a server-side CLI that answers a question about
one or more **exact original** library images using the OpenAI Responses API.

It is not a public endpoint, an nginx location, an MCP listener or a ChatGPT
connector. It opens no port and adds no database table. Run it from
`/var/www/alveron-library` on the host that can reach the library.

## What it does

1. Reads the library token and OpenAI key from the server-side environment.
2. Resolves product/image identifiers through the existing authenticated
   library API. It never accepts an arbitrary image URL.
3. Fetches the original with the bearer token and checks:
   - HTTP status;
   - declared size against actual size and `Content-Length`;
   - declared media type against the response and the magic bytes (JPEG, PNG or
     WebP);
   - `X-Original-SHA256` and the stored SHA-256 against the bytes received.
4. Rejects unsupported, oversized or mismatched images **before** calling
   OpenAI.
5. Sends the verified bytes as a base64 `input_image` data URL plus the question
   as `input_text`, with `store: false`.
6. Returns the model's text answer with safe product/image ids, dimensions and
   checksums.

The library token is sent only to the library. It is never sent to OpenAI. The
bridge does not use signed original URLs, so no signed URL can be copied into a
log or an API request.

## Privacy and cost

- **Image bytes leave the host.** The verified originals are sent to OpenAI as
  part of the Responses API request. Only do this for images you are allowed to
  send, and only with an approved OpenAI account and billing.
- **One API call per invocation.** Images count as input tokens; larger images
  and `original` detail can cost significantly more. `VISION_MAX_CALLS_PER_MINUTE`
  is a local safety limit, not an OpenAI quota.
- **No prompt content is stored by the bridge.** The request sets `store: false`;
  the bridge itself writes no image bytes or prompts to disk.
- **Image text is untrusted.** Text inside a product photo is treated as content
  to describe, not as instructions. The model is told not to follow embedded
  instructions or reveal secrets.
- **No secrets in output.** The CLI prints JSON to stdout and sanitized errors to
  stderr. It never prints the library token, OpenAI key, base64 image data or
  signed URLs.

## Configuration

```bash
OPENAI_API_KEY=...
OPENAI_VISION_MODEL=...        # required; must accept image input
ALVERON_LIBRARY_TOKEN=alv_lib_...
ALVERON_LIBRARY_BASE_URL=http://127.0.0.1:3001
```

Create the token in **Settings & Access → ChatGPT retrieval tokens**. It is
read-only and can be revoked. Keep the values in `.env.local` or another
mode-600 server-side file; never commit them.

There is deliberately no default model. Verify in your OpenAI account/provider
documentation that the chosen model accepts image input before using it. The live
marker test below is the end-to-end check.

Optional limits:

| Variable | Default | Meaning |
|---|---:|---|
| `ALVERON_LIBRARY_TIMEOUT_MS` | `45000` | Library API timeout |
| `VISION_MAX_IMAGES` | `4` | Maximum images per call (cap 10) |
| `VISION_MAX_IMAGE_BYTES` | `20971520` | Maximum original size (20 MiB) |
| `VISION_TIMEOUT_MS` | `45000` | OpenAI request timeout |
| `VISION_MAX_CALLS_PER_MINUTE` | `10` | Local in-process call limit |
| `VISION_MAX_OUTPUT_TOKENS` | `800` | Maximum answer length |
| `VISION_MAX_QUESTION_CHARS` | `2000` | Maximum question length |
| `VISION_IMAGE_DETAIL` | `auto` | `low`, `high`, `original` or `auto`; `original` is not supported by every model |

## Usage

One image:

```bash
npm run vision:bridge -- \
  --question "Describe the fabric, fit and visible details." \
  --image "<productId>:<imageId>"
```

All images on one product (up to `VISION_MAX_IMAGES`):

```bash
npm run vision:bridge -- \
  --question "Which views show the back of the shirt?" \
  --product "<productId>"
```

Output is JSON:

```json
{
  "answer": "...",
  "model": "...",
  "responseId": "resp_...",
  "usage": { "inputTokens": 1000, "outputTokens": 80, "totalTokens": 1080 },
  "images": [
    {
      "productId": "...",
      "productName": "...",
      "imageId": "...",
      "filename": "...",
      "mediaType": "image/png",
      "byteSize": 123456,
      "width": 1200,
      "height": 1600,
      "viewLabel": "front",
      "sha256": "...",
      "verified": true
    }
  ]
}
```

If the original fails verification, the command exits non-zero and OpenAI is not
called. If OpenAI fails or times out, the error is sanitized and no image data or
credentials are included.

## Tests

Routine, offline tests (mocked library and OpenAI):

```bash
npm run test:vision
```

They cover valid retrieval and actual bytes in `input_image`, SHA-256 mismatch
before OpenAI, unsupported MIME, oversized originals, size/type mismatches,
invalid credentials, model errors and timeouts without leakage, output without
secrets/base64/signed URLs, image limits and malformed identifiers.

Opt-in live marker test (one paid OpenAI call, one generated image):

```bash
VISION_LIVE_APPROVED=yes npm run test:vision:live
```

It requires `OPENAI_API_KEY`, `OPENAI_VISION_MODEL`, `AUTH_BOOTSTRAP_EMAIL` and
`AUTH_BOOTSTRAP_PASSWORD`. It creates a temporary product and token, generates a
PNG containing a unique random marker, asks the model to read it, checks the
answer and the image checksum, then deletes the product and token. It refuses to
run without the approval flag. A passing run prints `PASS live vision bridge`
with the marker and response id.

## What this does not do

It does not add image vision to a normal ChatGPT conversation. ChatGPT cannot
reach the bridge, and the bridge is not exposed publicly. A ChatGPT-side wrapper
could only receive the bridge's text analysis. True image input requires an
API-side integration with a vision model, verified in that environment.
