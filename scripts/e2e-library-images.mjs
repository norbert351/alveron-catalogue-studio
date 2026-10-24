/**
 * Read-only end-to-end verification of the ChatGPT image API.
 *
 * Proves against a real deployment that:
 *   - the public OpenAPI schema imports the three required operations;
 *   - a missing or malformed token is refused;
 *   - image pagination reaches every image exactly once;
 *   - every listed signed URL opens without a bearer header;
 *   - every downloaded original is a real image and matches the checksum the
 *     library recorded at upload.
 *
 * It creates, edits and deletes nothing. Requirements:
 *   ALVERON_LIBRARY_BASE_URL=https://library.alveronfashion.com
 *   ALVERON_LIBRARY_TOKEN=alv_lib_...
 *
 * Optional: ALVERON_IMAGE_PAGE_SIZE (default 5, capped at 100).
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import sharp from 'sharp';

const base = (process.env.ALVERON_LIBRARY_BASE_URL ?? 'http://127.0.0.1:3001').replace(/\/+$/, '');
const token = process.env.ALVERON_LIBRARY_TOKEN ?? '';
const pageSize = Math.min(Math.max(Number(process.env.ALVERON_IMAGE_PAGE_SIZE ?? 5) || 5, 1), 100);

let passed = 0;
const check = async (name, fn) => { await fn(); passed += 1; console.log(`PASS ${name}`); };
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const api = (path, options = {}) => fetch(`${base}${path}`, options);

if (!token.startsWith('alv_lib_')) {
  throw new Error('Set ALVERON_LIBRARY_TOKEN to a read-only alv_lib_... token.');
}

const bearer = { Authorization: `Bearer ${token}` };

try {
  await check('the OpenAPI schema is public and contains the three required operations', async () => {
    const response = await api('/api/library/openapi.json');
    assert.equal(response.status, 200);
    const schema = await response.json();
    assert.match(schema.openapi, /^3\.1\./);
    assert.equal(schema.paths['/api/library/images'].get.operationId, 'listProductImages');
    assert.equal(schema.paths['/api/library/search'].get.operationId, 'searchProducts');
    assert.equal(schema.paths['/api/library/products/{productId}/images/{imageId}/original'].get.operationId, 'getOriginalImage');
  });

  await check('missing, malformed and cookie-only access are refused', async () => {
    assert.equal((await api('/api/library/images')).status, 401);
    assert.equal((await api('/api/library/images', { headers: { Authorization: 'Bearer alv_lib_not-a-real-token-value' } })).status, 401);
    assert.equal((await api('/api/library/images', { headers: { Cookie: 'alveron_studio_session=not-a-session' } })).status, 401);
  });

  const images = [];
  let expectedTotal = null;
  let pages = 0;
  let offset = 0;

  await check('pagination lists every image exactly once', async () => {
    for (;;) {
      const response = await api(`/api/library/images?limit=${pageSize}&offset=${offset}`, { headers: bearer });
      assert.equal(response.status, 200, await response.clone().text());
      assert.equal(response.headers.get('cache-control'), 'no-store');
      const body = await response.json();

      if (expectedTotal === null) expectedTotal = body.total;
      assert.equal(body.total, expectedTotal, 'total must stay stable across pages');
      assert.equal(body.limit, pageSize);
      assert.equal(body.offset, offset);
      assert.equal(body.returned, body.items.length);
      assert.equal(body.hasMore, offset + body.items.length < expectedTotal);
      assert.equal(body.nextOffset, body.hasMore ? offset + body.items.length : null);

      for (const item of body.items) {
        assert.deepEqual(Object.keys(item).sort(), ['imageId', 'originalUrl', 'productId']);
        const signed = new URL(item.originalUrl);
        assert.equal(signed.origin, new URL(base).origin);
        assert.match(signed.pathname, /^\/api\/library\/products\/[0-9a-f-]+\/images\/[0-9a-f-]+\/original$/);
        assert.match(signed.searchParams.get('exp') ?? '', /^\d+$/);
        assert.match(signed.searchParams.get('sig') ?? '', /^[0-9a-f]{64}$/);
        assert.ok(Number(signed.searchParams.get('exp')) > Math.floor(Date.now() / 1000), 'signed URL must not already be expired');
        assert.equal(signed.searchParams.has('token'), false);
        images.push(item);
      }

      pages += 1;
      if (!body.hasMore) break;
      assert.ok(body.nextOffset > offset, 'pagination must advance');
      offset = body.nextOffset;
      assert.ok(pages < 10_000, 'pagination did not terminate');
    }

    assert.equal(images.length, expectedTotal, 'every recorded image must be returned');
    assert.equal(new Set(images.map((image) => image.imageId)).size, expectedTotal, 'an image must not appear twice');
    const productIds = new Set(images.map((image) => image.productId));
    assert.ok(productIds.size > 0, 'the real library must contain products');
    console.log(`     ${images.length} images across ${productIds.size} products in ${pages} page(s)`);
  });

  let firstProductId;
  await check('search finds an existing product by its product id', async () => {
    firstProductId = images[0].productId;
    const response = await api(`/api/library/search?ids=${encodeURIComponent(firstProductId)}`, { headers: bearer });
    assert.equal(response.status, 200, await response.clone().text());
    const body = await response.json();
    const product = body.products.find((candidate) => candidate.id === firstProductId);
    assert.ok(product, 'search must return the requested product');
    assert.ok(product.primaryImage?.signedOriginalUrl, 'search must return a signed original URL');
  });

  await check('every listed original opens without a bearer header and matches its recorded checksum', async () => {
    const checksums = new Map();
    for (const productId of new Set(images.map((image) => image.productId))) {
      const response = await api(`/api/library/products/${productId}`, { headers: bearer });
      assert.equal(response.status, 200, await response.clone().text());
      const product = await response.json();
      for (const image of product.images) checksums.set(image.imageId, image.sha256.toLowerCase());
    }

    for (const image of images) {
      const response = await fetch(image.originalUrl);
      assert.equal(response.status, 200, `signed URL failed for image ${image.imageId}`);
      assert.match(response.headers.get('content-type') ?? '', /^image\/(jpeg|png|webp)(;|$)/);
      const arrayBuffer = await response.arrayBuffer();
      const bytes = Buffer.from(arrayBuffer);
      assert.ok(bytes.length > 0, 'the original must not be empty');
      const digest = sha(bytes);
      const expected = checksums.get(image.imageId);
      assert.ok(expected, `no checksum recorded for image ${image.imageId}`);
      assert.equal(digest, expected, 'original bytes must match the checksum recorded at upload');
      const metadata = await sharp(bytes).metadata();
      assert.ok(Number(metadata.width) > 0 && Number(metadata.height) > 0, 'the original must be a viewable image');
    }
  });

  console.log(`\n${passed} read-only image API checks passed against ${base}`);
  console.log('Coverage: schema, token rejection, full pagination, search, signed URLs and original bytes.');
} catch (error) {
  console.error(`FAIL ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
}
