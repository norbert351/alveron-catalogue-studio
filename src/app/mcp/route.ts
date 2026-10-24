import { NextRequest } from 'next/server';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import { getPool } from '@/lib/db';
import { createHash } from 'node:crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ProductRow = {
  id: string;
  name: string;
  sku: string | null;
  category: string;
  color: string | null;
  tags: string[] | null;
  image_count: string | null;
  image_ids: string[] | null;
};

type ImageRow = {
  id: string;
  product_id: string;
  view_label: string | null;
  media_type: string;
  width: number | null;
  height: number | null;
  sha256: string;
};

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 60;
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function rateLimitOk(key: string) {
  const now = Date.now();
  const entry = rateLimitMap.get(key);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX) return false;
  entry.count += 1;
  rateLimitMap.set(key, entry);
  return true;
}

function getClientKey(request: Request) {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  const realIp = request.headers.get('x-real-ip');
  if (realIp) return realIp;
  return 'unknown';
}

function publicOrigin(request: Request): string {
  const proto = request.headers.get('x-forwarded-proto');
  const host = request.headers.get('x-forwarded-host');
  return proto && host ? `${proto}://${host}` : new URL(request.url).origin;
}

function getServer(request: Request) {
  const server = new McpServer(
    {
      name: 'alveron-library',
      version: '1.0.0',
    },
    {
      instructions:
        'Read-only access to the Alveron Fashion product library. Only search_products, list_product_images, and get_original_image are available. Never upload, edit, or delete.',
    },
  );

  server.registerTool(
    'search_products',
    {
      title: 'Search the Alveron product library',
      description:
        'Search the real Alveron Fashion product library by free text (name, colour, tag, filename or product id), category or colour. Returns matching product IDs and available image IDs.',
      inputSchema: {
        query: z.string().optional().describe('Free text across name, colour, tags, filename or product id.'),
        category: z.string().optional().describe('Exact category.'),
        colour: z.string().optional().describe('Colour substring.'),
        limit: z.number().int().min(1).max(50).optional().describe('Page size, 1-50. Default 20.'),
        offset: z.number().int().min(0).optional().describe('Pagination offset. Default 0.'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ query, category, colour, limit, offset }) => {
      if (!rateLimitOk(getClientKey(request))) {
        return { content: [{ type: 'text', text: 'Error: Rate limit exceeded. Try again later.' }], isError: true };
      }
      // Allow unauthenticated access for public read-only catalogue search
      const pool = getPool();
      const where: string[] = ["p.availability <> 'archived'"];
      const values: unknown[] = [];
      const add = (v: unknown) => `$${values.push(v)}`;
      if (category) where.push(`p.category = ${add(category)}`);
      if (colour) where.push(`p.color ILIKE ${add(`%${colour}%`)}`);
      if (query) {
        const like = `%${query}%`;
        where.push(
          `(
          p.name ILIKE ${add(like)}
          OR COALESCE(p.sku,'') ILIKE ${add(like)}
          OR COALESCE(p.notes,'') ILIKE ${add(like)}
          OR COALESCE(p.color,'') ILIKE ${add(like)}
          OR p.id::text ILIKE ${add(like)}
          OR EXISTS (SELECT 1 FROM unnest(p.tags) AS tag WHERE tag ILIKE ${add(like)})
          OR EXISTS (
            SELECT 1 FROM product_images pi WHERE pi.product_id = p.id AND (pi.original_filename ILIKE ${add(like)} OR pi.colour_design_label ILIKE ${add(like)})
          )
        )`,
        );
      }
      const clause = where.join(' AND ');
      const totalRes = await pool.query(`SELECT count(*)::text AS count FROM products p WHERE ${clause}`, values);
      const lim = limit ?? 20;
      const off = offset ?? 0;
      const rows = await pool.query(
        `SELECT p.id, p.name, p.sku, p.category, p.color, p.tags,
                (SELECT count(*)::text FROM product_images c WHERE c.product_id = p.id AND c.is_current) AS image_count,
                (SELECT array_agg(pi.id::text ORDER BY pi.created_at ASC, pi.id ASC) FROM product_images pi WHERE pi.product_id = p.id AND pi.is_current) AS image_ids
         FROM products p WHERE ${clause}
         ORDER BY p.created_at DESC, p.id DESC
         LIMIT ${add(lim)} OFFSET ${add(off)}`,
        values,
      );
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                total: Number(totalRes.rows[0]?.count ?? 0),
                returned: rows.rows.length,
                limit: lim,
                offset: off,
                products: rows.rows.map((r: ProductRow) => ({
                  productId: r.id,
                  id: r.id,
                  name: r.name,
                  sku: r.sku,
                  category: r.category,
                  color: r.color,
                  tags: r.tags ?? [],
                  imageCount: Number(r.image_count ?? 0),
                  imageIds: r.image_ids ?? [],
                  availableImageIds: r.image_ids ?? [],
                })),
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.registerTool(
    'list_product_images',
    {
      title: 'List all original images for a product',
      description: 'List all original images for a product, with pagination where necessary. Returns product IDs and available image IDs.',
      inputSchema: {
        productId: z.string().uuid().describe('Product UUID.'),
        limit: z.number().int().min(1).max(100).optional().describe('Page size. Default 100.'),
        offset: z.number().int().min(0).optional().describe('Pagination offset. Default 0.'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ productId, limit, offset }) => {
      if (!rateLimitOk(getClientKey(request))) {
        return { content: [{ type: 'text', text: 'Error: Rate limit exceeded. Try again later.' }], isError: true };
      }
      const pool = getPool();
      const lim = limit ?? 100;
      const off = offset ?? 0;
      const totalRes = await pool.query(`SELECT count(*)::text AS count FROM product_images i WHERE i.product_id = $1`, [productId]);
      const rows = await pool.query(
        `SELECT i.id, i.product_id, i.view_label, i.media_type, i.width, i.height, i.sha256
         FROM product_images i WHERE i.product_id = $1 AND i.is_current
         ORDER BY i.created_at ASC, i.id ASC
         LIMIT $2 OFFSET $3`,
        [productId, lim, off],
      );
      const origin = publicOrigin(request);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                productId,
                total: Number(totalRes.rows[0]?.count ?? 0),
                returned: rows.rows.length,
                limit: lim,
                offset: off,
                hasMore: off + rows.rows.length < Number(totalRes.rows[0]?.count ?? 0),
                images: rows.rows.map((r: ImageRow) => ({
                  imageId: r.id,
                  productId: r.product_id,
                  viewLabel: r.view_label,
                  mediaType: r.media_type,
                  width: r.width,
                  height: r.height,
                  sha256: r.sha256,
                  originalUrl: `${origin}/api/library/products/${r.product_id}/images/${r.id}/original`,
                })),
                imageIds: rows.rows.map((r: ImageRow) => r.id),
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.registerTool(
    'get_original_image',
    {
      title: 'Get the exact original image bytes',
      description: 'Retrieve an original product image using the existing authorized image retrieval mechanism. Returns image content block directly through MCP where supported.',
      inputSchema: {
        productId: z.string().uuid().describe('Product UUID.'),
        imageId: z.string().uuid().describe('Image id.'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ productId, imageId }) => {
      if (!rateLimitOk(getClientKey(request))) {
        return { content: [{ type: 'text', text: 'Error: Rate limit exceeded. Try again later.' }], isError: true };
      }
      const { getPool } = await import('@/lib/db');
      const { getPrivateStorage } = await import('@/lib/storage');
      const { env } = await import('@/lib/config');
      const pool = getPool();
      const result = await pool.query(
        `SELECT object_key, storage_provider, media_type, byte_size, sha256, original_filename
         FROM product_images WHERE id = $1 AND product_id = $2`,
        [imageId, productId],
      );
      const row = result.rows[0];
      if (!row) {
        return { content: [{ type: 'text', text: 'Error: No such image in the library.' }], isError: true };
      }
      try {
        const bytes = await getPrivateStorage((row.storage_provider ?? env.STORAGE_PROVIDER) as 'local' | 's3').get(row.object_key);
        if (bytes.length !== Number(row.byte_size)) {
          return { content: [{ type: 'text', text: 'Error: Stored original does not match its recorded size.' }], isError: true };
        }
        const digest = createHash('sha256').update(bytes).digest('hex');
        if (digest !== row.sha256) {
          return { content: [{ type: 'text', text: 'Error: Stored original failed its checksum.' }], isError: true };
        }
        return {
          content: [
            { type: 'image', data: bytes.toString('base64'), mimeType: row.media_type },
            {
              type: 'text',
              text: JSON.stringify(
                {
                  productId,
                  imageId,
                  mediaType: row.media_type,
                  byteSize: bytes.length,
                  sha256: digest,
                  verified: true,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err: unknown) {
        return { content: [{ type: 'text', text: `Error: ${err instanceof Error ? err.message : 'unavailable'}` }], isError: true };
      }
    },
  );

  return server;
}

async function handleRequest(request: NextRequest) {
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  const server = getServer(request);
  await server.connect(transport);
  const accept = request.headers.get('accept') ?? '';
  const normalized =
    accept.includes('text/event-stream') && accept.includes('application/json')
      ? request
      : new Request(request.url, {
          method: request.method,
          headers: (() => {
            const h = new Headers(request.headers);
            h.set('accept', 'application/json, text/event-stream');
            return h;
          })(),
          body: request.body,
          duplex: 'half',
        } as RequestInit);
  return transport.handleRequest(normalized);
}

export async function POST(req: NextRequest) {
  return handleRequest(req);
}

export async function GET() {
  return new Response(
    JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Method Not Allowed' }, id: null }),
    {
      status: 405,
      headers: { 'Content-Type': 'application/json', Allow: 'POST, OPTIONS' },
    },
  );
}

export async function DELETE() {
  return new Response(
    JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Method Not Allowed' }, id: null }),
    {
      status: 405,
      headers: { 'Content-Type': 'application/json', Allow: 'POST, OPTIONS' },
    },
  );
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, mcp-session-id, mcp-protocol-version',
    },
  });
}
