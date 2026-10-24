import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function publicOrigin(request: Request): string {
  const proto = request.headers.get('x-forwarded-proto');
  const host = request.headers.get('x-forwarded-host');
  return proto && host ? `${proto}://${host}` : new URL(request.url).origin;
}

/**
 * GET /api/library/openapi.json — the import schema for a ChatGPT GPT Action.
 *
 * Public on purpose: a schema contains no product data and no credentials.
 * It documents only the three read-only operations needed for visual retrieval:
 * list every original, search products, and fetch one original image.
 */
export async function GET(request: Request) {
  const origin = publicOrigin(request);

  return NextResponse.json({
    openapi: '3.1.0',
    info: {
      title: 'Alveron Fashion Product Image Library',
      version: '1.0.0',
      description: 'Read-only access to the original product photographs stored in the Alveron library. Every image URL resolves to the exact uploaded original and expires shortly after it is issued.',
    },
    servers: [{ url: origin }],
    security: [{ bearerAuth: [] }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'alv_lib_...',
        },
      },
      schemas: {
        ProductImage: {
          type: 'object',
          required: ['productId', 'imageId', 'originalUrl'],
          properties: {
            productId: { type: 'string', format: 'uuid' },
            imageId: { type: 'string', format: 'uuid' },
            originalUrl: {
              type: 'string',
              format: 'uri',
              description: 'Short-lived signed URL for the exact original image. Open it directly to view the photo.',
            },
          },
        },
        ImagePage: {
          type: 'object',
          required: ['items', 'returned', 'total', 'limit', 'offset', 'hasMore', 'nextOffset'],
          properties: {
            items: { type: 'array', items: { $ref: '#/components/schemas/ProductImage' } },
            returned: { type: 'integer' },
            total: { type: 'integer' },
            limit: { type: 'integer' },
            offset: { type: 'integer' },
            hasMore: { type: 'boolean' },
            nextOffset: { type: ['integer', 'null'] },
          },
        },
        SearchProduct: {
          type: 'object',
          required: ['id', 'name'],
          properties: {
            id: { type: 'string', format: 'uuid' },
            name: { type: 'string' },
            primaryImage: {
              type: ['object', 'null'],
              properties: {
                imageId: { type: 'string', format: 'uuid' },
                originalUrl: { type: 'string', format: 'uri' },
                signedOriginalUrl: { type: 'string', format: 'uri' },
              },
            },
          },
        },
        SearchResults: {
          type: 'object',
          required: ['returned', 'total', 'limit', 'offset', 'hasMore', 'products'],
          properties: {
            returned: { type: 'integer' },
            total: { type: 'integer' },
            limit: { type: 'integer' },
            offset: { type: 'integer' },
            hasMore: { type: 'boolean' },
            products: { type: 'array', items: { $ref: '#/components/schemas/SearchProduct' } },
          },
        },
      },
    },
    paths: {
      '/api/library/images': {
        get: {
          operationId: 'listProductImages',
          summary: 'List all original product images',
          description: 'Lists every product image in the library, paginated. Use this to browse the whole visual library. Each item contains a product id, an image id and a signed original-image URL.',
          parameters: [
            { name: 'limit', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 100, default: 100 } },
            { name: 'offset', in: 'query', required: false, schema: { type: 'integer', minimum: 0, default: 0 } },
            { name: 'productId', in: 'query', required: false, schema: { type: 'string', format: 'uuid' }, description: 'Optional. Return only the images belonging to this product.' },
          ],
          responses: {
            '200': {
              description: 'A page of original product images.',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/ImagePage' } } },
            },
            '400': { description: 'Invalid product id or pagination parameter.' },
            '401': { description: 'Missing, invalid or revoked bearer token.' },
          },
        },
      },
      '/api/library/search': {
        get: {
          operationId: 'searchProducts',
          summary: 'Search products by name or id',
          description: 'Finds products using existing library names, ids, filenames, colours or tags. It returns stored product ids plus a signed original-image URL; it does not create new descriptions or metadata.',
          parameters: [
            { name: 'q', in: 'query', required: false, schema: { type: 'string' }, description: 'Product name, filename, tag, colour or product id.' },
            { name: 'ids', in: 'query', required: false, schema: { type: 'string' }, description: 'Comma-separated product UUIDs.' },
            { name: 'limit', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 100, default: 24 } },
            { name: 'offset', in: 'query', required: false, schema: { type: 'integer', minimum: 0, default: 0 } },
          ],
          responses: {
            '200': {
              description: 'Matching products with their primary original image.',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/SearchResults' } } },
            },
            '400': { description: 'Invalid product id or pagination parameter.' },
            '401': { description: 'Missing, invalid or revoked bearer token.' },
          },
        },
      },
      '/api/library/products/{productId}/images/{imageId}/original': {
        get: {
          operationId: 'getOriginalImage',
          summary: 'Get one original product image',
          description: 'Returns the exact uploaded original image bytes. Use the signed originalUrl returned by listProductImages or searchProducts; the exp and sig values are already part of that URL.',
          parameters: [
            { name: 'productId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
            { name: 'imageId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
            { name: 'exp', in: 'query', required: false, schema: { type: 'string' }, description: 'Signed URL expiry, supplied by the originalUrl.' },
            { name: 'sig', in: 'query', required: false, schema: { type: 'string' }, description: 'Signed URL HMAC, supplied by the originalUrl.' },
          ],
          responses: {
            '200': {
              description: 'The exact original image bytes.',
              content: {
                'image/jpeg': { schema: { type: 'string', format: 'binary' } },
                'image/png': { schema: { type: 'string', format: 'binary' } },
                'image/webp': { schema: { type: 'string', format: 'binary' } },
              },
            },
            '400': { description: 'Invalid product or image id.' },
            '401': { description: 'Missing bearer token on a link without a valid signature.' },
            '403': { description: 'Expired or invalid signature.' },
            '404': { description: 'No such image in the library.' },
          },
        },
      },
    },
  }, { headers: { 'Cache-Control': 'public, max-age=300' } });
}
