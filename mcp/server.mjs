#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

/**
 * Read-only MCP bridge to the Alveron product image library.
 *
 * The library bearer token lives ONLY in this process's environment. It is
 * never sent to the model, never included in tool results, and never written
 * to logs. The bridge calls the existing read-only HTTP API instead of
 * re-implementing database or storage logic.
 *
 * Transport: stdio. ChatGPT's hosted connectors require OAuth 2.1 and cannot
 * present a custom API key, so this server is for local/trusted MCP clients
 * (and for an API-side Responses integration). See README.md.
 */

const BASE = (process.env.ALVERON_LIBRARY_BASE_URL ?? 'https://library.alveronfashion.com').replace(/\/+$/, '');
const TOKEN = (process.env.ALVERON_LIBRARY_TOKEN ?? '').trim();
const TIMEOUT_MS = 45_000;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

if (!TOKEN.startsWith('alv_lib_')) {
  process.stderr.write('ALVERON_LIBRARY_TOKEN is missing or not a library token (alv_lib_...). Create one in Alveron Studio -> Settings -> Tokens.\n');
  process.exit(1);
}

function redact(value) {
  return TOKEN ? String(value).split(TOKEN).join('[redacted]') : String(value);
}

async function call(path) {
  let response;
  try {
    response = await fetch(`${BASE}${path}`, {
      headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw new Error(`Could not reach the Alveron library at ${BASE}: ${redact(error?.message ?? error)}`, { cause: error });
  }
  if (!response.ok) {
    throw new Error(`Alveron library returned ${response.status} for ${path}: ${redact((await response.text()).slice(0, 400))}`);
  }
  return response;
}

async function getJson(path) {
  return (await call(path)).json();
}

function textResult(value) {
  return { content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] };
}

function fail(message) {
  return { content: [{ type: 'text', text: `Error: ${redact(message)}` }], isError: true };
}

const server = new McpServer({ name: 'alveron-library', version: '1.0.0' });

server.registerTool(
  'search_products',
  {
    title: 'Search the Alveron product library',
    description:
      'Search the real Alveron Fashion product library by free text (name, colour, tag, filename or product id), category or colour. Returns metadata and image ids. Use this first, then get_product or get_original_image. Never invent a product that is not returned.',
    inputSchema: {
      query: z.string().optional().describe('Free text across name, colour, tags, filename or product id.'),
      category: z.string().optional().describe('Exact category, e.g. shirt, trousers, jacket.'),
      colour: z.string().optional().describe('Colour substring, e.g. navy.'),
      limit: z.number().int().min(1).max(50).optional().describe('Page size, 1-50. Default 20.'),
      offset: z.number().int().min(0).optional().describe('Pagination offset. Default 0.'),
    },
  },
  async ({ query, category, colour, limit, offset }) => {
    try {
      const params = new URLSearchParams();
      if (query) params.set('q', query);
      if (category) params.set('category', category);
      if (colour) params.set('colour', colour);
      if (limit !== undefined) params.set('limit', String(limit));
      if (offset !== undefined) params.set('offset', String(offset));
      const body = await getJson(`/api/library/search${params.size ? `?${params}` : ''}`);
      return textResult({
        scope: body.scope,
        returned: body.returned,
        total: body.total,
        hasMore: body.hasMore,
        note: body.note,
        products: (body.products ?? []).map((product) => ({
          id: product.id,
          name: product.name,
          sku: product.sku,
          category: product.category,
          colour: product.colour,
          tags: product.tags,
          imageCount: product.imageCount,
          primaryImage: product.primaryImage,
        })),
      });
    } catch (error) {
      return fail(error?.message ?? error);
    }
  },
);

server.registerTool(
  'get_product',
  {
    title: 'Get one Alveron product with all images',
    description:
      'Return the full stored metadata for one product, including every image with imageId, viewLabel, dimensions, mediaType and SHA-256. Use the ids from search_products. Do not guess missing fields.',
    inputSchema: {
      productId: z.string().uuid().describe('Product UUID returned by search_products.'),
    },
  },
  async ({ productId }) => {
    try {
      return textResult(await getJson(`/api/library/products/${encodeURIComponent(productId)}`));
    } catch (error) {
      return fail(error?.message ?? error);
    }
  },
);

server.registerTool(
  'get_original_image',
  {
    title: 'Get the exact original image bytes',
    description:
      'Fetch the byte-for-byte uploaded original for one image, verified against its stored SHA-256, and return it as image content so a vision-capable client can see it. Use imageId from get_product. This returns the original, never a thumbnail or generated image.',
    inputSchema: {
      productId: z.string().uuid().describe('Product UUID returned by search_products.'),
      imageId: z.string().uuid().describe('Image id returned by get_product.'),
    },
  },
  async ({ productId, imageId }) => {
    try {
      const product = await getJson(`/api/library/products/${encodeURIComponent(productId)}`);
      const image = (product.images ?? []).find((candidate) => candidate.imageId === imageId);
      if (!image) throw new Error('No such image on that product.');
      if (!IMAGE_TYPES.has(image.mediaType)) throw new Error(`Unsupported media type: ${image.mediaType}`);

      const response = await call(`/api/library/products/${encodeURIComponent(productId)}/images/${encodeURIComponent(imageId)}/original`);
      const bytes = Buffer.from(await response.arrayBuffer());

      if (bytes.length !== image.byteSize) throw new Error('Original size does not match the stored record.');
      if (bytes.length > MAX_IMAGE_BYTES) throw new Error('Original is larger than the 20 MB MCP limit.');
      const digest = createHash('sha256').update(bytes).digest('hex');
      if (digest !== image.sha256) throw new Error('Original failed its SHA-256 check; refusing to return it.');

      return {
        content: [
          { type: 'image', data: bytes.toString('base64'), mimeType: image.mediaType },
          {
            type: 'text',
            text: JSON.stringify({
              productId: product.id,
              productName: product.name,
              imageId: image.imageId,
              filename: image.filename,
              mediaType: image.mediaType,
              byteSize: image.byteSize,
              width: image.width,
              height: image.height,
              viewLabel: image.viewLabel,
              sha256: image.sha256,
              verified: true,
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      return fail(error?.message ?? error);
    }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
