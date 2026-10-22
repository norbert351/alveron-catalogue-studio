/**
 * Production-mode end-to-end verification (real Postgres + real S3/MinIO +
 * `next start`). Unlike scripts/e2e-library.mjs this never falls back to local
 * storage, and it exercises signed original URLs and a real process restart.
 *
 * Run from the deployment directory:
 *   node --conditions=react-server --env-file-if-exists=.env.local \
 *     scripts/e2e-library-prod.mjs
 *
 * Env: DATABASE_URL, AUTH_BOOTSTRAP_EMAIL/PASSWORD, SESSION_SECRET,
 *      LIBRARY_SIGNING_SECRET, S3_* (all present in .env.local).
 * Optional: ALVERON_E2E_BASE (default http://127.0.0.1:3001),
 *           ALVERON_E2E_PM2_NAME (default alveron-library; set empty to skip restart),
 *           ALVERON_E2E_LOG_DIR (default ./logs).
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import sharp from 'sharp';
import { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';

const base = (process.env.ALVERON_E2E_BASE ?? 'http://127.0.0.1:3001').replace(/\/+$/, '');
const restartName = process.env.ALVERON_E2E_PM2_NAME ?? 'alveron-library';
const logDir = process.env.ALVERON_E2E_LOG_DIR ?? './logs';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const s3 = new S3Client({
  region: process.env.S3_REGION,
  endpoint: process.env.S3_ENDPOINT,
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
  credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY },
});

let passed = 0;
const check = async (name, fn) => { await fn(); passed += 1; console.log(`PASS ${name}`); };
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const sameOrigin = { Origin: base };
const api = (path, options = {}) => fetch(`${base}${path}`, options);

async function garment(index, colour) {
  const svg = `<svg width="640" height="800" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="#e8e2d6"/>
    <path d="M200 120 L440 120 L470 200 L560 250 L540 340 L500 320 L505 700 L135 700 L140 320 L100 340 L80 250 L170 200 Z" fill="${colour}"/>
    <circle cx="320" cy="${200 + index * 40}" r="18" fill="#fff8ea"/>
    <text x="240" y="760" font-family="Arial" font-size="28" fill="#222">PROD ${index}</text>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

function form(entries, files) {
  const data = new FormData();
  for (const [key, value] of entries) data.set(key, value);
  for (const file of files) {
    data.append('images', new Blob([file.bytes], { type: 'image/png' }), file.name);
    data.append('viewLabels', file.view);
  }
  return data;
}

let cookie;
let productId;
let token;
let tokenId;
const uploaded = new Map();

try {
  for (const key of ['DATABASE_URL', 'AUTH_BOOTSTRAP_EMAIL', 'AUTH_BOOTSTRAP_PASSWORD', 'LIBRARY_SIGNING_SECRET']) {
    if (!process.env[key]) throw new Error(`${key} is required (use --env-file-if-exists=.env.local).`);
  }

  await check('status reports database + S3 storage ready', async () => {
    const response = await api('/api/status');
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.database, 'ready');
    assert.equal(body.storage, 'ready');
    assert.equal(body.storageProvider, 's3');
  });

  await check('owner login works (bcrypt + session cookie)', async () => {
    const response = await api('/api/auth/login', {
      method: 'POST',
      headers: { ...sameOrigin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: process.env.AUTH_BOOTSTRAP_EMAIL, password: process.env.AUTH_BOOTSTRAP_PASSWORD }),
    });
    assert.equal(response.status, 200, await response.clone().text());
    cookie = response.headers.get('set-cookie')?.split(';')[0];
    assert.ok(cookie, 'a session cookie must be issued');
    const setCookie = response.headers.get('set-cookie') ?? '';
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /Secure/i);
  });

  const auth = (extra = {}) => ({ Cookie: cookie, ...sameOrigin, ...extra });

  await check('upload a 3-image product into MinIO', async () => {
    const files = [
      { bytes: await garment(1, '#7a1f2b'), name: 'prod-front.png', view: 'front' },
      { bytes: await garment(2, '#22303f'), name: 'prod-back.png', view: 'back' },
      { bytes: await garment(3, '#4a4a2f'), name: 'prod-detail.png', view: 'detail' },
    ];
    for (const file of files) uploaded.set(file.name, sha(file.bytes));
    const response = await api('/api/products', {
      method: 'POST',
      headers: auth({ 'Idempotency-Key': `prod-e2e-${Date.now()}` }),
      body: form([['name', 'Production E2E Shirt'], ['category', 'shirt'], ['color', 'assorted'], ['tags', 'e2e,prod']], files),
    });
    const body = await response.json();
    assert.equal(response.status, 201, JSON.stringify(body));
    productId = body.id ?? body.productId;
    assert.ok(productId);
    const rows = await pool.query('SELECT original_filename, sha256, byte_size, object_key FROM product_images WHERE product_id=$1', [productId]);
    assert.equal(rows.rowCount, 3);
    for (const row of rows.rows) {
      assert.equal(row.sha256, uploaded.get(row.original_filename));
      assert.ok(row.object_key.startsWith('products/'));
    }
  });

  await check('create a read-only token; plaintext is never stored', async () => {
    const response = await api('/api/settings/tokens', {
      method: 'POST',
      headers: auth({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ label: 'Production E2E' }),
    });
    const body = await response.json();
    assert.equal(response.status, 201, JSON.stringify(body));
    token = body.token;
    tokenId = body.id;
    assert.ok(token.startsWith('alv_lib_'));
    const stored = (await pool.query('SELECT token_hash FROM library_api_tokens WHERE id=$1', [tokenId])).rows[0];
    assert.notEqual(stored.token_hash, token);
    assert.equal(stored.token_hash, sha(Buffer.from(token)));
  });

  const bearer = { Authorization: `Bearer ${token}` };

  await check('search returns the product, checksums and a signed link', async () => {
    const response = await api('/api/library/search?q=Production', { headers: bearer });
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const body = await response.json();
    const item = body.products.find((product) => product.id === productId);
    assert.ok(item);
    assert.equal(item.primaryImage.sha256, uploaded.get(item.primaryImage.filename));
    assert.match(item.primaryImage.signedOriginalUrl, /\?exp=\d+&sig=[0-9a-f]{64}$/);
    assert.ok(!item.primaryImage.signedOriginalUrl.includes('alv_lib_'));
  });

  const product = await (await api(`/api/library/products/${productId}`, { headers: bearer })).json();
  const images = [...product.images].sort((a, b) => a.filename.localeCompare(b.filename));
  assert.equal(images.length, 3);

  await check('every original matches the upload through the bearer route', async () => {
    for (const image of images) {
      const response = await api(`/api/library/products/${productId}/images/${image.imageId}/original`, { headers: bearer });
      assert.equal(response.status, 200);
      const bytes = Buffer.from(await response.arrayBuffer());
      assert.equal(bytes.length, image.byteSize);
      assert.equal(sha(bytes), image.sha256);
      assert.equal(response.headers.get('x-original-sha256'), image.sha256);
      assert.equal(sha(bytes), uploaded.get(image.filename));
    }
  });

  await check('every original is readable through its signed URL without a token', async () => {
    for (const image of images) {
      const path = new URL(image.signedOriginalUrl).pathname + new URL(image.signedOriginalUrl).search;
      const response = await api(path);
      assert.equal(response.status, 200, `signed link failed for ${image.filename}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      assert.equal(sha(bytes), image.sha256);
    }
  });

  await check('tampered, expired and cross-image signed links are refused', async () => {
    const first = images[0];
    const second = images[1];
    const url = new URL(first.signedOriginalUrl);
    const goodSig = url.searchParams.get('sig');

    const tampered = new URL(url);
    tampered.searchParams.set('sig', `${goodSig.slice(0, -1)}${goodSig.endsWith('0') ? '1' : '0'}`);
    assert.equal((await api(tampered.pathname + tampered.search)).status, 403);

    const wrongExp = new URL(url);
    wrongExp.searchParams.set('exp', String(Number(url.searchParams.get('exp')) + 120));
    assert.equal((await api(wrongExp.pathname + wrongExp.search)).status, 403);

    const crossImage = new URL(url);
    crossImage.pathname = `/api/library/products/${productId}/images/${second.imageId}/original`;
    assert.equal((await api(crossImage.pathname + crossImage.search)).status, 403);

    const expiredExp = Math.floor(Date.now() / 1000) - 10;
    const expiredSig = createHmac('sha256', process.env.LIBRARY_SIGNING_SECRET)
      .update(`${productId}.${first.imageId}.${expiredExp}`).digest('hex');
    const expired = `/api/library/products/${productId}/images/${first.imageId}/original?exp=${expiredExp}&sig=${expiredSig}`;
    assert.equal((await api(expired)).status, 403);

    const futureExp = Math.floor(Date.now() / 1000) + 7200;
    const futureSig = createHmac('sha256', process.env.LIBRARY_SIGNING_SECRET)
      .update(`${productId}.${first.imageId}.${futureExp}`).digest('hex');
    const future = `/api/library/products/${productId}/images/${first.imageId}/original?exp=${futureExp}&sig=${futureSig}`;
    assert.equal((await api(future)).status, 403);
  });

  await check('missing token and cookie-only access are refused', async () => {
    assert.equal((await api('/api/library/search')).status, 401);
    assert.equal((await api('/api/library/search', { headers: { Cookie: cookie } })).status, 401);
    assert.equal((await api('/api/library/search', { headers: { Authorization: 'Bearer alv_lib_bogus' } })).status, 401);
  });

  await check('batch resolves all three images and reports missing ids', async () => {
    const missing = '9f8e7d6c-5b4a-4321-8765-fedcba987654';
    const response = await api('/api/library/batch', {
      method: 'POST', headers: { ...bearer, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [productId, missing] }),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.found, 1);
    assert.deepEqual(body.missing, [missing]);
    assert.equal(body.products[0].images.length, 3);
    for (const image of body.products[0].images) assert.match(image.signedOriginalUrl, /\?exp=\d+&sig=[0-9a-f]{64}$/);
  });

  await check('read-only token cannot create, edit or delete', async () => {
    const create = await api('/api/products', { method: 'POST', headers: bearer, body: new FormData() });
    assert.ok([401, 403].includes(create.status));
    const patch = await api(`/api/products/${productId}`, {
      method: 'PATCH', headers: { ...bearer, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'nope' }),
    });
    assert.ok([401, 403].includes(patch.status));
    const del = await api(`/api/products/${productId}`, { method: 'DELETE', headers: bearer });
    assert.ok([401, 403].includes(del.status));
  });

  await check('originals survive a full application restart', async () => {
    if (!restartName) return;
    execFileSync(process.env.PM2_BIN ?? 'pm2', ['restart', restartName], { stdio: 'ignore' });
    for (let attempt = 0; attempt < 60; attempt += 1) {
      try { if ((await api('/api/status')).ok) break; } catch { /* restarting */ }
      await delay(500);
    }
    for (const image of images) {
      const response = await api(`/api/library/products/${productId}/images/${image.imageId}/original`, { headers: bearer });
      assert.equal(response.status, 200);
      assert.equal(sha(Buffer.from(await response.arrayBuffer())), image.sha256);
    }
  });

  await check('revocation takes effect on the next request', async () => {
    const revoke = await api(`/api/settings/tokens?id=${tokenId}`, { method: 'DELETE', headers: auth() });
    assert.equal(revoke.status, 200, await revoke.clone().text());
    assert.equal((await api('/api/library/search', { headers: bearer })).status, 401);
    const row = (await pool.query('SELECT revoked_at, use_count, last_used_at FROM library_api_tokens WHERE id=$1', [tokenId])).rows[0];
    assert.ok(row.revoked_at, 'revoked_at must be set');
    assert.ok(Number(row.use_count) > 0, 'use accounting must have recorded the successful reads');
    assert.ok(row.last_used_at);
  });

  await check('deleting the product removes rows and MinIO objects', async () => {
    const keys = (await pool.query('SELECT object_key FROM product_images WHERE product_id=$1', [productId])).rows.map((row) => row.object_key);
    const response = await api(`/api/products/${productId}`, { method: 'DELETE', headers: auth() });
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal((await pool.query('SELECT 1 FROM product_images WHERE product_id=$1', [productId])).rowCount, 0);
    assert.equal((await pool.query('SELECT 1 FROM products WHERE id=$1', [productId])).rowCount, 0);
    for (const key of keys) {
      let missing = false;
      try { await s3.send(new HeadObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key })); } catch { missing = true; }
      assert.equal(missing, true, `${key} must be gone from the bucket`);
    }
  });

  await check('the bucket is not anonymously readable', async () => {
    const response = await fetch(`${process.env.S3_ENDPOINT}/${process.env.S3_BUCKET}?list-type=2`);
    assert.equal(response.status, 403);
  });

  await check('logs contain neither the token nor any signature', async () => {
    const signatures = images.map((image) => new URL(image.signedOriginalUrl).searchParams.get('sig'));
    for (const file of ['app.out.log', 'app.err.log', 'minio.out.log', 'minio.err.log']) {
      let text;
      try { text = readFileSync(`${logDir}/${file}`, 'utf8'); } catch { continue; }
      assert.equal(text.includes(token), false, `${file} leaked the token`);
      for (const signature of signatures) assert.equal(text.includes(signature), false, `${file} leaked a signed URL`);
    }
  });

  console.log(`\n${passed} production checks passed against ${base}`);
} finally {
  await pool.end().catch(() => undefined);
}
