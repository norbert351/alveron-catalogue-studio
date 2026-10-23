# Alveron Library MCP bridge

A narrow, read-only [Model Context Protocol](https://modelcontextprotocol.io)
server that exposes the existing Alveron library API to a vision-capable MCP
client. It reuses the HTTP API and adds no database or storage logic of its own.

Tools:

| Tool | Purpose |
|---|---|
| `search_products` | Search by text, category or colour |
| `get_product` | Full metadata and every image for one product |
| `get_original_image` | The exact uploaded bytes, SHA-256 verified, as image content |

## Why stdio

ChatGPT's hosted connectors/MCP apps authenticate with **OAuth 2.1 only**:
OpenAI documents that ChatGPT "cannot present custom API keys". The library's
`alv_lib_…` bearer token therefore cannot be used by a ChatGPT-hosted connector.
GPT Actions are the only ChatGPT surface that accepts a static bearer token, and
Actions are text-only.

So this bridge runs over **stdio** for local or trusted MCP clients (Claude
Desktop, Codex, IDE agents, or an API-side Responses integration) where the
token can be kept in the process environment. It does not open a port.

## Configuration

| Variable | Required | Meaning |
|---|---|---|
| `ALVERON_LIBRARY_TOKEN` | yes | `alv_lib_…` read-only token. Never commit it. |
| `ALVERON_LIBRARY_BASE_URL` | no | Default `http://127.0.0.1:3001` for a local check. Set the HTTPS origin (for example `https://library.alveronfashion.com`) only when it is actually serving. |
| `ALVERON_LIBRARY_TIMEOUT_MS` | no | API timeout in milliseconds. Default `45000`. |
| `ALVERON_MAX_IMAGE_BYTES` | no | Refuse larger originals. Default `20971520` (20 MiB). |

Example client entry (store the file with mode `600`):

```json
{
  "mcpServers": {
    "alveron-library": {
      "command": "node",
      "args": ["/var/www/alveron-library/mcp/server.mjs"],
      "env": {
        "ALVERON_LIBRARY_BASE_URL": "https://library.alveronfashion.com",
        "ALVERON_LIBRARY_TOKEN": "alv_lib_REPLACE_ME"
      }
    }
  }
}
```

The token is read once at startup. It is never returned in a tool result, never
logged, and `[redacted]` replaces it in any error text.

## Run

```bash
cd mcp
npm ci
ALVERON_LIBRARY_TOKEN=alv_lib_… npm start
```

## Test

Needs a running library API and a product with at least three images:

```bash
cd mcp
ALVERON_LIBRARY_BASE_URL=http://127.0.0.1:3001 \
ALVERON_LIBRARY_TOKEN=alv_lib_… \
ALVERON_TEST_PRODUCT_ID=<uuid> \
npm run test:e2e
```

The last check decodes the returned base64 image and compares its SHA-256 with
the checksum the API reported, so a passing run proves the model-side client
received the real bytes rather than a link.

## Private Responses API vision bridge

`scripts/vision-bridge.mjs` reuses this bridge's shared
`mcp/library-client.mjs` retrieval and verification code, then sends the verified
bytes to a configurable OpenAI vision model. It is a server-side CLI, not a
public MCP endpoint. See `docs/VISION_BRIDGE.md` for privacy, cost, usage and
testing details. It does not make a normal ChatGPT conversation see images.
