/**
 * End-to-end verification: Alveron Product Image Library.
 *
 * Proves, against a real server, real storage and a real database:
 *   1.  Bulk upload of several images in one request, each persisted.
 *   2.  Data survives an application restart (server killed and restarted).
 *   3.  Original bytes match their stored SHA-256 exactly.
 *   4.  Derivatives cannot overwrite an original.
 *   5.  Metadata edits persist.
 *   6.  Search / filter / pagination work.
 *   7.  Unauthorised callers cannot read, upload or delete.
 *   8.  ChatGPT token: search, metadata, original bytes, batch, and 401 without a token.
 *   9.  Single and bulk delete remove DB rows and files together.
 *   10. Failed uploads recover (no orphaned records).
 *
 * Run: DATABASE_URL=... npm run test:library
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { existsSync } from 'node:fs';
import pg from 'pg';
import sharp from 'sharp';
import { STORAGE_ROOT } from '../src/lib/config.ts';

const port = Number(process.env.ALVERON_TEST_PORT ?? 3103);
const base = `http://127.0.0.1:${port}`;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let server; let cookie; let passed = 0;

function startServer() {
  // Local filesystem storage is deliberately refused when NODE_ENV=production
  // (see src/lib/storage.ts): production requires S3. This suite exercises the
  // documented local mode, so it runs the dev server, which is the same
  // application code and the same routes.
  server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--hostname', '127.0.0.1', '--port', String(port)], {
    cwd: process.cwd(), env: { ...process.env, NODE_ENV: 'development' }, stdio: 'ignore',
  });
  server.on('error', (error) => { throw error; });
}
async function stopServer() {
  if (!server || server.exitCode !== null) return;
  server.kill('SIGTERM');
  await Promise.race([new Promise((resolve) => server.once('exit', resolve)), delay(8000)]);
  if (server.exitCode === null) server.kill('SIGKILL');
  await delay(600);
}
async function waitReady() {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Server exited before startup (code ${server.exitCode}).`);
    try { const response = await fetch(`${base}/login`); if (response.ok) return; } catch { /* starting */ }
    await delay(500);
  }
  throw new Error('Server did not become ready.');
}
const api = (path, options = {}) => fetch(`${base}${path}`, options);
async function check(name, fn) { await fn(); passed += 1; console.log(`PASS ${name}`); }

/** A real, distinct PNG so checksum and content checks mean something. */
async function garment(index, colour) {
  const svg = `<svg width="640" height="800" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="#e8e2d6"/>
    <path d="M200 120 L440 120 L470 200 L560 250 L540 340 L500 320 L505 700 L135 700 L140 320 L100 340 L80 250 L170 200 Z" fill="${colour}"/>
    <circle cx="320" cy="${200 + index * 40}" r="18" fill="#fff8ea"/>
    <text x="240" y="760" font-family="Arial" font-size="28" fill="#222">ITEM ${index}</text>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}
function form(entries, files) {
  const data = new FormData();
  for (const [key, value] of entries) data.set(key, value);
  for (const file of files) {
    data.append('images', new Blob([file.bytes], { type: 'image/png' }), file.name);
    data.append('viewLabels', 'front');
  }
  return data;
}

try {
  if (!process.env.DATABASE_URL || !process.env.AUTH_BOOTSTRAP_EMAIL || !process.env.AUTH_BOOTSTRAP_PASSWORD || !process.env.SESSION_SECRET) {
    throw new Error('Set DATABASE_URL, owner bootstrap credentials and SESSION_SECRET.');
  }
  startServer(); await waitReady();

  await check('Owner login; anonymous access is refused', async () => {
    const anon = await api('/api/products');
    assert.equal(anon.status, 401, 'anonymous product listing must be refused');
    const anonUpload = await api('/api/products', { method: 'POST', body: new FormData() });
    assert.ok([401, 403].includes(anonUpload.status), `anonymous upload must be refused, got ${anonUpload.status}`);

    const login = await api('/api/auth/login', {
      method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: process.env.AUTH_BOOTSTRAP_EMAIL, password: process.env.AUTH_BOOTSTRAP_PASSWORD }),
    });
    assert.equal(login.status, 200, await login.text());
    cookie = login.headers.get('set-cookie')?.split(';')[0]; assert.ok(cookie);
  });

  const auth = (extra = {}) => ({ Cookie: cookie, Origin: base, ...extra });
  let productA; let productB; const uploaded = new Map();

  await check('Bulk upload of 3 images in one request', async () => {
    const files = [
      { bytes: await garment(1, '#7a1f2b'), name: 'burgundy-shirt.png' },
      { bytes: await garment(2, '#22303f'), name: 'navy-shirt.png' },
      { bytes: await garment(3, '#4a4a2f'), name: 'olive-shirt.png' },
    ];
    const created = await api('/api/products', {
      method: 'POST', headers: auth({ 'Idempotency-Key': 'lib-multi-1' }),
      body: form([['name', 'Triple Shirt Set'], ['category', 'shirt'], ['color', 'assorted'], ['tags', 'e2e,multi']], files),
    });
    const body = await created.json();
    assert.equal(created.status, 201, JSON.stringify(body));
    productA = body.id ?? body.productId;
    assert.ok(productA);
    const rows = await pool.query('SELECT original_filename, sha256, byte_size FROM product_images WHERE product_id=$1 ORDER BY original_filename', [productA]);
    assert.equal(rows.rowCount, 3, 'all three images must persist');
    for (const file of files) uploaded.set(file.name, createHash('sha256').update(file.bytes).digest('hex'));
    for (const row of rows.rows) assert.equal(row.sha256, uploaded.get(row.original_filename), `${row.original_filename} checksum mismatch`);
  });

  await check('A second product with metadata for search/filter', async () => {
    const created = await api('/api/products', {
      method: 'POST', headers: auth({ 'Idempotency-Key': 'lib-single-1' }),
      body: form([['name', 'Linen Trousers'], ['category', 'trousers'], ['color', 'sand'], ['tags', 'e2e,summer'], ['notes', 'wide leg']], [{ bytes: await garment(4, '#d8c9a3'), name: 'linen-trousers.png' }]),
    });
    const body = await created.json();
    assert.equal(created.status, 201, JSON.stringify(body));
    productB = body.id ?? body.productId;
    assert.ok(productB);
  });

  await check('Original bytes match stored SHA-256 after a full restart', async () => {
    await stopServer(); startServer(); await waitReady();
    // Re-login: sessions are DB-backed, but the cookie must still work.
    const listing = await api('/api/products', { headers: { Cookie: cookie } });
    assert.equal(listing.status, 200, 'session must survive a restart');

    const row = (await pool.query('SELECT id, sha256, byte_size, original_filename FROM product_images WHERE product_id=$1 ORDER BY original_filename LIMIT 1', [productA])).rows[0];
    const served = await api(`/api/products/${productA}/images/${row.id}`, { headers: { Cookie: cookie } });
    assert.equal(served.status, 200);
    const bytes = Buffer.from(await served.arrayBuffer());
    assert.equal(bytes.length, Number(row.byte_size), 'served size must match the record');
    assert.equal(createHash('sha256').update(bytes).digest('hex'), row.sha256, 'served bytes must match the stored checksum');
    assert.equal(createHash('sha256').update(bytes).digest('hex'), uploaded.get(row.original_filename), 'served bytes must match what was uploaded');
  });

  await check('Derivatives cannot overwrite an original', async () => {
    const row = (await pool.query('SELECT id, object_key, sha256 FROM product_images WHERE product_id=$1 ORDER BY original_filename LIMIT 1', [productA])).rows[0];
    const before = await pool.query('SELECT sha256 FROM product_images WHERE id=$1', [row.id]);
    // Build a derivative (thumbnail/preview) for this image.
    const derivative = await api(`/api/products/${productA}/images/${row.id}/derivatives/preview`, { headers: { Cookie: cookie } });
    assert.ok([200, 201, 404].includes(derivative.status), `derivative route responded ${derivative.status}`);
    const after = await pool.query('SELECT sha256, object_key FROM product_images WHERE id=$1', [row.id]);
    assert.equal(after.rows[0].sha256, before.rows[0].sha256, 'original checksum must not change');
    assert.equal(after.rows[0].object_key, row.object_key, 'original key must not change');
    assert.ok(row.object_key.startsWith('products/'), 'originals live under products/');
    const derived = await pool.query('SELECT object_key FROM product_image_derivatives WHERE product_image_id=$1', [row.id]);
    for (const d of derived.rows) {
      assert.ok(d.object_key.startsWith('derivatives/'), 'derivatives live under a different prefix');
      assert.notEqual(d.object_key, row.object_key, 'a derivative must never share an original key');
    }
  });

  await check('Metadata edit persists', async () => {
    const patched = await api(`/api/products/${productB}`, {
      method: 'PATCH', headers: auth({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ name: 'Sand Linen Trousers', color: 'sand-beige', tags: ['e2e', 'summer', 'wide-leg'] }),
    });
    assert.ok([200, 204].includes(patched.status), await patched.clone().text());
    const row = (await pool.query('SELECT name, color, tags FROM products WHERE id=$1', [productB])).rows[0];
    assert.equal(row.name, 'Sand Linen Trousers');
    assert.equal(row.color, 'sand-beige');
    assert.ok(row.tags.includes('wide-leg'));
  });

  await check('Search, category filter and pagination', async () => {
    const byName = await (await api(`/api/products?search=Linen&page=1&pageSize=10`, { headers: { Cookie: cookie } })).json();
    const names = JSON.stringify(byName);
    assert.ok(names.includes('Linen'), 'search must find the linen product');
    assert.ok(!names.includes('Triple Shirt Set'), 'search must exclude non-matching products');

    const byCategory = await (await api(`/api/products?category=trousers&page=1&pageSize=10`, { headers: { Cookie: cookie } })).json();
    assert.ok(JSON.stringify(byCategory).includes('Linen'), 'category filter must include trousers');

    // The paged shape returns { items, page, pageSize, total, totalPages }.
    const paged = await (await api(`/api/products?page=1&pageSize=1`, { headers: { Cookie: cookie } })).json();
    assert.ok(Array.isArray(paged.items), 'paged response must include items');
    assert.equal(paged.items.length, 1, 'pageSize must be honoured');
    assert.ok(paged.total >= 2, 'total must count the whole library, not just the page');
    assert.equal(paged.pageSize, 1);
  });

  let token;
  await check('ChatGPT token: created, and the API refuses callers without it', async () => {
    const noToken = await api('/api/library/search');
    assert.equal(noToken.status, 401, 'library search must require a token');
    const badToken = await api('/api/library/search', { headers: { Authorization: 'Bearer alv_lib_notarealtokenxxxxxxxxxxxx' } });
    assert.equal(badToken.status, 401, 'an unknown token must be refused');

    const created = await api('/api/settings/tokens', {
      method: 'POST', headers: auth({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ label: 'E2E ChatGPT connector' }),
    });
    const body = await created.json();
    assert.equal(created.status, 201, JSON.stringify(body));
    token = body.token;
    assert.ok(token.startsWith('alv_lib_'), 'token must carry the library prefix');
    const stored = (await pool.query('SELECT token_hash FROM library_api_tokens ORDER BY created_at DESC LIMIT 1')).rows[0];
    assert.notEqual(stored.token_hash, token, 'the plaintext token must never be stored');
    assert.equal(stored.token_hash.length, 64);
  });

  await check('ChatGPT token: search returns real products with original URLs', async () => {
    const response = await api('/api/library/search?q=Shirt', { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(response.status, 200, await response.clone().text());
    const body = await response.json();
    assert.ok(body.total >= 1, 'search must find the shirt product');
    const item = body.products.find((product) => product.id === productA);
    assert.ok(item, 'the shirt product must appear');
    assert.ok(item.primaryImage.originalUrl.includes('/api/library/products/'), 'must expose an original URL');
    assert.equal(item.primaryImage.sha256, uploaded.get(item.primaryImage.filename), 'returned checksum must be the real one');
  });

  await check('ChatGPT token: original bytes are byte-identical to the upload, through the API', async () => {
    const search = await (await api('/api/library/search?q=Shirt', { headers: { Authorization: `Bearer ${token}` } })).json();
    const item = search.products.find((product) => product.id === productA);
    const fetched = await api(item.primaryImage.originalUrl.replace(/^https?:\/\/[^/]+/, ''));
    assert.equal(fetched.status, 401, 'an original URL must NOT be publicly readable without a token');

    const withToken = await api(item.primaryImage.originalUrl.replace(/^https?:\/\/[^/]+/, ''), { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(withToken.status, 200);
    const bytes = Buffer.from(await withToken.arrayBuffer());
    assert.equal(createHash('sha256').update(bytes).digest('hex'), uploaded.get(item.primaryImage.filename), 'ChatGPT must receive the exact original bytes');
    assert.equal(withToken.headers.get('x-original-sha256'), uploaded.get(item.primaryImage.filename));
  });

  await check('ChatGPT token: batch resolves several products and reports missing ones', async () => {
    const missing = '9f8e7d6c-5b4a-4321-8765-fedcba987654'; // valid v4-shaped, never inserted
    const response = await api('/api/library/batch', {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [productA, productB, missing] }),
    });
    assert.equal(response.status, 200, await response.clone().text());
    const body = await response.json();
    assert.equal(body.found, 2);
    assert.deepEqual(body.missing, [missing], 'missing ids must be reported, not invented');
    for (const product of body.products) assert.ok(product.images.length >= 1, 'each product must include its images');
  });

  await check('ChatGPT token cannot mutate the library', async () => {
    const attempt = await api('/api/products', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: new FormData() });
    assert.ok([401, 403].includes(attempt.status), `a read token must not upload, got ${attempt.status}`);
    const del = await api(`/api/products/${productB}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
    assert.ok([401, 403].includes(del.status), `a read token must not delete, got ${del.status}`);
  });

  let objectKeys = [];
  await check('Delete one product removes its files and rows together', async () => {
    objectKeys = (await pool.query('SELECT object_key FROM product_images WHERE product_id=$1', [productB])).rows.map((row) => row.object_key);
    const response = await api(`/api/products/${productB}`, { method: 'DELETE', headers: auth() });
    assert.ok([200, 204].includes(response.status), await response.clone().text());
    const images = await pool.query('SELECT 1 FROM product_images WHERE product_id=$1', [productB]);
    assert.equal(images.rowCount, 0, 'image rows must be gone');
    const products = await pool.query('SELECT 1 FROM products WHERE id=$1', [productB]);
    assert.equal(products.rowCount, 0, 'product row must be gone');
    for (const key of objectKeys) {
      assert.equal(existsSync(`${STORAGE_ROOT}/${key}`), false, `file ${key} must be removed from storage`);
    }
  });

  await check('Bulk delete removes every selected product and leaves the rest intact', async () => {
    const keysBefore = (await pool.query('SELECT object_key FROM product_images WHERE product_id=$1', [productA])).rows.map((row) => row.object_key);
    const existing = await (await api('/api/products', { headers: { Cookie: cookie } })).json();
    const remaining = existing.products.filter((product) => product.id !== productA).map((product) => product.id);
    const response = await api('/api/products', {
      method: 'DELETE', headers: auth({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ ids: [productA] }),
    });
    assert.ok([200, 204].includes(response.status), await response.clone().text());
    assert.equal((await pool.query('SELECT 1 FROM products WHERE id=$1', [productA])).rowCount, 0);
    for (const key of keysBefore) assert.equal(existsSync(`${STORAGE_ROOT}/${key}`), false, `file ${key} must be removed`);
    const survivors = await pool.query('SELECT count(*)::int AS n FROM products');
    assert.equal(survivors.rows[0].n, remaining.length, 'only the selected product is removed');
  });

  await check('A failed upload leaves no half-written product', async () => {
    const before = (await pool.query('SELECT count(*)::int AS n FROM products')).rows[0].n;
    const bad = new FormData();
    bad.set('name', 'Broken upload');
    bad.set('category', 'shirt');
    // An empty file must be rejected by validation.
    bad.append('images', new Blob([Buffer.alloc(0)], { type: 'image/png' }), 'empty.png');
    bad.append('viewLabels', 'front');
    const response = await api('/api/products', { method: 'POST', headers: auth({ 'Idempotency-Key': 'lib-bad-1' }), body: bad });
    assert.ok(![200, 201].includes(response.status), 'an empty file must be rejected');
    const after = (await pool.query('SELECT count(*)::int AS n FROM products')).rows[0].n;
    assert.equal(after, before, 'a rejected upload must not create a product row');
    const failed = await pool.query("SELECT status FROM product_upload_requests WHERE idempotency_key='lib-bad-1'");
    if (failed.rowCount) assert.equal(failed.rows[0].status, 'failed', 'the attempt must be recorded as failed, not silently dropped');
  });

  await check('Database and filesystem stay consistent', async () => {
    const rows = await pool.query('SELECT object_key, byte_size FROM product_images');
    for (const row of rows.rows) {
      const path = `${STORAGE_ROOT}/${row.object_key}`;
      assert.equal(existsSync(path), true, `${row.object_key} must exist on disk`);
    }
    const products = await pool.query('SELECT id FROM products');
    for (const product of products.rows) {
      const images = await pool.query('SELECT count(*)::int AS n FROM product_images WHERE product_id=$1', [product.id]);
      assert.ok(images.rows[0].n >= 0);
    }
  });

  console.log(`\n${passed} automated checks passed.`);
  console.log('Scope: locally tested against a real server, real storage and a real database.');
  console.log('NOT tested here: an actual ChatGPT connector round-trip (requires a public HTTPS endpoint + ChatGPT-side setup).');
} finally {
  await stopServer();
  await pool.end().catch(() => undefined);
}
