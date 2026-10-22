/**
 * End-to-end test for the read-only MCP bridge.
 *
 * Requires a running Alveron library API and a real read-only token:
 *   ALVERON_LIBRARY_BASE_URL=http://127.0.0.1:3001 \
 *   ALVERON_LIBRARY_TOKEN=alv_lib_... \
 *   ALVERON_TEST_PRODUCT_ID=<uuid> \
 *   node test/e2e.mjs
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const BASE = (process.env.ALVERON_LIBRARY_BASE_URL ?? 'http://127.0.0.1:3001').replace(/\/+$/, '');
const TOKEN = (process.env.ALVERON_LIBRARY_TOKEN ?? '').trim();
const PRODUCT_ID = process.env.ALVERON_TEST_PRODUCT_ID;

if (!TOKEN.startsWith('alv_lib_')) throw new Error('Set ALVERON_LIBRARY_TOKEN to a real alv_lib_ token.');
if (!PRODUCT_ID) throw new Error('Set ALVERON_TEST_PRODUCT_ID to a product that exists.');

const env = Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== undefined));
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [fileURLToPath(new URL('../server.mjs', import.meta.url))],
  env: { ...env, ALVERON_LIBRARY_BASE_URL: BASE, ALVERON_LIBRARY_TOKEN: TOKEN },
  stderr: 'pipe',
});

const client = new Client({ name: 'alveron-library-e2e', version: '1.0.0' });
let passed = 0;
const check = async (name, fn) => { await fn(); passed += 1; console.log(`PASS ${name}`); };

try {
  await client.connect(transport);

  await check('tools/list exposes exactly the three read-only tools', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name).sort();
    assert.deepEqual(names, ['get_original_image', 'get_product', 'search_products']);
    for (const tool of tools) assert.ok(tool.description && tool.inputSchema, `${tool.name} must be documented`);
  });

  await check('search_products returns the real product', async () => {
    const result = await client.callTool({ name: 'search_products', arguments: { limit: 50 } });
    assert.equal(result.isError, undefined);
    const body = JSON.parse(result.content.find((block) => block.type === 'text').text);
    assert.ok(Array.isArray(body.products));
    assert.ok(body.products.some((product) => product.id === PRODUCT_ID), 'the test product must be found');
  });

  let imageId;
  await check('get_product returns every image with checksums', async () => {
    const result = await client.callTool({ name: 'get_product', arguments: { productId: PRODUCT_ID } });
    assert.equal(result.isError, undefined);
    const product = JSON.parse(result.content.find((block) => block.type === 'text').text);
    assert.equal(product.id, PRODUCT_ID);
    assert.ok(product.images.length >= 3, 'the test product must have three images');
    for (const image of product.images) {
      assert.match(image.sha256, /^[0-9a-f]{64}$/);
      assert.ok(image.width > 0 && image.height > 0);
    }
    imageId = product.images[0].imageId;
  });

  await check('get_original_image returns verified image content, not a URL', async () => {
    const result = await client.callTool({ name: 'get_original_image', arguments: { productId: PRODUCT_ID, imageId } });
    assert.equal(result.isError, undefined, JSON.stringify(result));
    const image = result.content.find((block) => block.type === 'image');
    assert.ok(image, 'an image content block must be returned');
    assert.ok(['image/jpeg', 'image/png', 'image/webp'].includes(image.mimeType));
    const bytes = Buffer.from(image.data, 'base64');
    const digest = createHash('sha256').update(bytes).digest('hex');
    const meta = JSON.parse(result.content.find((block) => block.type === 'text').text);
    assert.equal(digest, meta.sha256, 'the returned bytes must match the recorded SHA-256');
    assert.equal(bytes.length, meta.byteSize);
    assert.equal(meta.verified, true);
    assert.ok(!JSON.stringify(result).includes(TOKEN), 'the token must never appear in a tool result');
  });

  await check('an unknown image id fails without leaking anything', async () => {
    const result = await client.callTool({
      name: 'get_original_image',
      arguments: { productId: PRODUCT_ID, imageId: 'ffffffff-ffff-4fff-8fff-ffffffffffff' },
    });
    assert.equal(result.isError, true);
    assert.ok(!JSON.stringify(result).includes(TOKEN));
  });

  console.log(`\n${passed} MCP checks passed.`);
} finally {
  await client.close().catch(() => undefined);
}
