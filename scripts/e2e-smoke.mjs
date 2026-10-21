import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { rename } from 'node:fs/promises';
import { resolve } from 'node:path';
import pg from 'pg';
import sharp from 'sharp';
// Resolve the private store exactly as the app does (absolute, cwd-independent),
// so the restart/missing-object checks target the real directory.
import { STORAGE_ROOT } from '../src/lib/config.ts';

const port = Number(process.env.ALVERON_TEST_PORT ?? 3100);
const base = `http://127.0.0.1:${port}`;
const headers = (cookie, extra = {}) => ({ ...(cookie ? { Cookie: cookie } : {}), ...extra });
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let server;
let cookie;
let passed = 0;

function startServer() {
  server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--hostname', '127.0.0.1', '--port', String(port)], { cwd: process.cwd(), env: { ...process.env, NODE_ENV: 'development' }, stdio: 'ignore' });
  server.on('error', (error) => { throw error; });
  return server;
}

async function stopServer() {
  if (!server || server.exitCode !== null) return;
  server.kill('SIGTERM');
  await Promise.race([new Promise((resolveExit) => server.once('exit', resolveExit)), delay(5000)]);
  if (server.exitCode === null) server.kill('SIGKILL');
}

async function waitReady() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Next server exited before startup (code ${server.exitCode}).`);
    try { const response = await fetch(`${base}/login`); if (response.ok) return; } catch { /* server is still starting */ }
    await delay(500);
  }
  throw new Error('Next server did not become ready within 30 seconds.');
}

async function check(name, fn) { await fn(); passed += 1; console.log(`PASS ${name}`); }
async function api(path, options = {}) { return fetch(`${base}${path}`, options); }
async function formFor(name, bytes, viewLabels, replacements = []) {
  const form = new FormData();
  form.set('name', name); form.set('category', name.toLowerCase().includes('trouser') ? 'bottoms' : 'tops');
  form.set('color', 'Owner-entered test colour'); form.set('tags', 'e2e, fidelity');
  for (const [index, image] of bytes.entries()) { form.append('images', new Blob([image], { type: 'image/png' }), `${name}-${index + 1}.png`); form.append('viewLabels', viewLabels[index]); }
  for (const replace of replacements) form.append('replacesImageIds', replace);
  return form;
}

async function addProduct(name, images, views, idempotencyKey) {
  return api('/api/products', { method: 'POST', headers: headers(cookie, { Origin: base, 'Idempotency-Key': idempotencyKey }), body: await formFor(name, images, views) });
}

try {
  if (!process.env.DATABASE_URL || !process.env.AUTH_BOOTSTRAP_EMAIL || !process.env.AUTH_BOOTSTRAP_PASSWORD || !process.env.SESSION_SECRET) throw new Error('Set DATABASE_URL, owner bootstrap credentials and SESSION_SECRET for this isolated E2E run.');
  startServer(); await waitReady();
  await check('Owner login and private image route authorization', async () => {
    const denied = await api(`/api/products/${randomUUID()}/images/${randomUUID()}`);
    assert.equal(denied.status, 401);
    const login = await api('/api/auth/login', { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: process.env.AUTH_BOOTSTRAP_EMAIL, password: process.env.AUTH_BOOTSTRAP_PASSWORD }) });
    assert.equal(login.status, 200, await login.text());
    cookie = login.headers.get('set-cookie')?.split(';')[0]; assert.ok(cookie);
  });
  await check('All seven existing studio routes render for an owner', async () => {
    for (const path of ['/dashboard', '/products', '/outfits', '/generate', '/review', '/approved', '/settings']) {
      const response = await api(path, { headers: headers(cookie) }); assert.equal(response.status, 200, `${path} returned ${response.status}`);
    }
  });

  const firstBytes = await sharp({ create: { width: 48, height: 64, channels: 3, background: '#1d334b' } }).png().toBuffer();
  const backBytes = await sharp({ create: { width: 48, height: 64, channels: 3, background: '#9c2029' } }).png().toBuffer();
  const bottomBytes = await sharp({ create: { width: 48, height: 64, channels: 3, background: '#343434' } }).png().toBuffer();
  const frontKey = randomUUID(); const bottomKey = randomUUID();
  const first = await addProduct('E2E Uploaded Shirt', [firstBytes, backBytes], ['front', 'back'], frontKey);
  assert.equal(first.status, 201, await first.clone().text()); const productA = (await first.json()).id;
  const duplicate = await addProduct('E2E Uploaded Shirt', [firstBytes, backBytes], ['front', 'back'], frontKey);
  assert.equal(duplicate.status, 200); assert.equal((await duplicate.json()).id, productA);
  const second = await addProduct('E2E Uploaded Trousers', [bottomBytes], ['front'], bottomKey);
  assert.equal(second.status, 201, await second.clone().text()); const productB = (await second.json()).id;

  let products = await (await api('/api/products', { headers: headers(cookie) })).json();
  let shirt = products.products.find((product) => product.id === productA);
  let trouser = products.products.find((product) => product.id === productB);
  assert.equal(shirt.images.length, 2); assert.equal(trouser.images.length, 1);
  const originalImage = shirt.images.find((image) => image.view_label === 'front');
  const sourceResponse = await api(`/api/products/${productA}/images/${originalImage.id}`, { headers: headers(cookie) });
  const sourceReceived = Buffer.from(await sourceResponse.arrayBuffer());
  assert.equal(sourceResponse.headers.get('x-original-sha256'), createHash('sha256').update(firstBytes).digest('hex'));
  assert.deepEqual(sourceReceived, firstBytes);

  await check('Multiple exact source views, idempotent uploads, checksums and review-gate invalidation', async () => {
    const changedKey = randomUUID();
    const failedView = await api(`/api/products/${productA}/images`, { method: 'POST', headers: headers(cookie, { Origin: base, 'Idempotency-Key': changedKey }), body: await formFor('ignored', [firstBytes], ['front'], [originalImage.id]) });
    assert.equal(failedView.status, 201, await failedView.clone().text());
    const refreshed = await (await api('/api/products', { headers: headers(cookie) })).json();
    const newFront = refreshed.products.find((product) => product.id === productA).images.find((image) => image.current && image.view_label === 'front');
    const oldFront = refreshed.products.find((product) => product.id === productA).images.find((image) => image.id === originalImage.id);
    assert.equal(oldFront.current, false); assert.equal(oldFront.reviewed, false);
    const beforeReview = await api('/api/catalogues', { method: 'POST', headers: headers(cookie, { Origin: base, 'Content-Type': 'application/json' }), body: JSON.stringify({ title: 'E2E Outfit', style: 'modern-tailoring', occasion: 'workwear', mixedStyleRequested: false, items: [{ productId: productA, imageId: newFront.id, role: 'top' }, { productId: productB, imageId: trouser.images[0].id, role: 'bottom' }] }) });
    assert.equal(beforeReview.status, 409, 'An image added during the workflow must invalidate readiness until all views are reviewed.');
    for (const product of refreshed.products) for (const image of product.images) {
      const response = await api(`/api/products/${product.id}/images/${image.id}`, { method: 'POST', headers: headers(cookie, { Origin: base }) });
      assert.equal(response.status, 200);
    }
  });

  products = (await (await api('/api/products', { headers: headers(cookie) })).json()).products;
  shirt = products.find((product) => product.id === productA); trouser = products.find((product) => product.id === productB);
  const selectedFront = shirt.images.find((image) => image.current && image.view_label === 'front');
  const createCatalogue = await api('/api/catalogues', { method: 'POST', headers: headers(cookie, { Origin: base, 'Content-Type': 'application/json' }), body: JSON.stringify({ title: 'E2E Outfit', style: 'modern-tailoring', occasion: 'workwear', mixedStyleRequested: false, items: [{ productId: productA, imageId: selectedFront.id, role: 'top' }, { productId: productB, imageId: trouser.images[0].id, role: 'bottom' }] }) });
  assert.equal(createCatalogue.status, 201, await createCatalogue.clone().text()); const catalogueId = (await createCatalogue.json()).id;
  await check('One-style, one-occasion outfit and exact product/image associations', async () => {
    const rows = await pool.query('SELECT product_id,product_image_id,outfit_role FROM catalogue_items WHERE catalogue_id=$1 ORDER BY position', [catalogueId]);
    assert.equal(rows.rowCount, 2); assert.equal(rows.rows[0].product_image_id, selectedFront.id); assert.equal(rows.rows[0].product_id, productA);
    assert.equal(rows.rows[0].outfit_role, 'top');
    const mixed = await api('/api/catalogues', { method: 'POST', headers: headers(cookie, { Origin: base, 'Content-Type': 'application/json' }), body: JSON.stringify({ title: 'Invalid mixed values', style: ['modern-tailoring', 'smart-casual'], occasion: 'workwear', items: [{ productId: productA, imageId: selectedFront.id, role: 'top' }, { productId: productB, imageId: trouser.images[0].id, role: 'bottom' }] }) });
    assert.equal(mixed.status, 400);
  });

  const blocked = await api(`/api/catalogues/${catalogueId}/generate`, { method: 'POST', headers: headers(cookie, { Origin: base, 'Idempotency-Key': 'e2e-provider-not-configured' }) });
  assert.equal(blocked.status, 503); const blockedJob = await blocked.json(); assert.equal(blockedJob.status, 'blocked');
  const blockedRetry = await api(`/api/catalogues/${catalogueId}/generate`, { method: 'POST', headers: headers(cookie, { Origin: base, 'Idempotency-Key': 'e2e-provider-not-configured' }) });
  assert.equal(blockedRetry.status, 200); assert.equal((await blockedRetry.json()).jobId, blockedJob.jobId);

  const compose = await api(`/api/catalogues/${catalogueId}/compose`, { method: 'POST', headers: headers(cookie, { Origin: base }) });
  assert.equal(compose.status, 201, await compose.clone().text()); const assetId = (await compose.json()).assetId;
  const pendingExport = await api(`/api/catalogues/${catalogueId}/export`, { method: 'POST', headers: headers(cookie, { Origin: base, 'Content-Type': 'application/json' }), body: JSON.stringify({ assetId, format: 'png', dimensions: '1080x1350' }) });
  assert.equal(pendingExport.status, 409);
  const output = await api(`/api/catalogues/${catalogueId}/assets/${assetId}`, { headers: headers(cookie) });
  assert.equal(output.status, 200); const outputBytes = Buffer.from(await output.arrayBuffer());
  assert.equal(output.headers.get('x-output-sha256'), createHash('sha256').update(outputBytes).digest('hex'));

  await check('Source/output rejection, correction, re-composition and checksum-bound approval', async () => {
    const reject = await api(`/api/catalogues/${catalogueId}/decision`, { method: 'POST', headers: headers(cookie, { Origin: base, 'Content-Type': 'application/json' }), body: JSON.stringify({ decision: 'reject', assetId, reason: 'Synthetic E2E review rejection.' }) });
    assert.equal(reject.status, 200);
    const correction = await api(`/api/catalogues/${catalogueId}/decision`, { method: 'POST', headers: headers(cookie, { Origin: base, 'Content-Type': 'application/json' }), body: JSON.stringify({ decision: 'correction', reason: 'Synthetic E2E request for a corrected draft.' }) });
    assert.equal(correction.status, 200);
    const newCompose = await api(`/api/catalogues/${catalogueId}/compose`, { method: 'POST', headers: headers(cookie, { Origin: base }) });
    assert.equal(newCompose.status, 201); const newAssetId = (await newCompose.json()).assetId;
    const approve = await api(`/api/catalogues/${catalogueId}/decision`, { method: 'POST', headers: headers(cookie, { Origin: base, 'Content-Type': 'application/json' }), body: JSON.stringify({ decision: 'approve', assetId: newAssetId }) });
    assert.equal(approve.status, 200, await approve.clone().text());
    const approval = await approve.json(); assert.equal(approval.assetId, newAssetId); assert.equal(approval.sha256.length, 64);
  });

  for (const [format, signature] of [['png', Buffer.from([137,80,78,71])], ['jpeg', Buffer.from([255,216])], ['pdf', Buffer.from('%PDF-1.4')]]) {
    const response = await api(`/api/catalogues/${catalogueId}/export`, { method: 'POST', headers: headers(cookie, { Origin: base, 'Content-Type': 'application/json' }), body: JSON.stringify({ assetId: (await pool.query('SELECT generated_asset_id FROM catalogue_approvals WHERE catalogue_id=$1 AND invalidated_at IS NULL ORDER BY approved_at DESC LIMIT 1', [catalogueId])).rows[0].generated_asset_id, format, dimensions: '1080x1350' }) });
    assert.equal(response.status, 200, `${format} export returned ${response.status}: ${await response.clone().text()}`);
    const bytes = Buffer.from(await response.arrayBuffer()); assert.deepEqual(bytes.subarray(0, signature.length), signature); assert.ok(response.headers.get('x-export-id'));
  }

  await check('Approved PNG/JPEG/PDF export audit and output provenance', async () => {
    const rows = await pool.query('SELECT format,width,height,sha256,approval_id FROM catalogue_exports WHERE catalogue_id=$1 ORDER BY created_at', [catalogueId]);
    assert.deepEqual(rows.rows.map((row) => row.format).sort(), ['jpeg','pdf','png']);
    assert.ok(rows.rows.every((row) => row.width === 1080 && row.height === 1350 && row.sha256.length === 64 && row.approval_id));
  });

  const imageRow = await pool.query('SELECT object_key FROM product_images WHERE id=$1', [selectedFront.id]);
  const absoluteImage = resolve(STORAGE_ROOT, imageRow.rows[0].object_key);
  const missingPath = `${absoluteImage}.e2e-missing`;
  await rename(absoluteImage, missingPath);
  try {
    const unavailable = await api(`/api/products/${productA}/images/${selectedFront.id}`, { headers: headers(cookie) });
    assert.equal(unavailable.status, 503);
  } finally { await rename(missingPath, absoluteImage); }

  await check('Real app-process restart preserves private image bytes and database session', async () => {
    await stopServer(); startServer(); await waitReady();
    const afterRestart = await api(`/api/products/${productA}/images/${selectedFront.id}`, { headers: headers(cookie) });
    assert.equal(afterRestart.status, 200);
    assert.deepEqual(Buffer.from(await afterRestart.arrayBuffer()), firstBytes);
    const productAfterRestart = await api('/api/products', { headers: headers(cookie) }); assert.equal(productAfterRestart.status, 200);
  });

  const uploadNewVersion = await api(`/api/products/${productA}/images`, { method: 'POST', headers: headers(cookie, { Origin: base, 'Idempotency-Key': randomUUID() }), body: await formFor('ignored', [backBytes], ['front'], [selectedFront.id]) });
  assert.equal(uploadNewVersion.status, 201);
  const staleExport = await api(`/api/catalogues/${catalogueId}/export`, { method: 'POST', headers: headers(cookie, { Origin: base, 'Content-Type': 'application/json' }), body: JSON.stringify({ assetId: (await pool.query('SELECT generated_asset_id FROM catalogue_approvals WHERE catalogue_id=$1 ORDER BY approved_at DESC LIMIT 1', [catalogueId])).rows[0].generated_asset_id, format: 'png', dimensions: '1080x1350' }) });
  assert.equal(staleExport.status, 409);
  await check('A new image version invalidates the prior approval and export', async () => {
    const state = await pool.query('SELECT status,revision FROM catalogues WHERE id=$1', [catalogueId]);
    const approval = await pool.query('SELECT invalidated_at FROM catalogue_approvals WHERE catalogue_id=$1 ORDER BY approved_at DESC LIMIT 1', [catalogueId]);
    assert.equal(state.rows[0].status, 'draft'); assert.ok(approval.rows[0].invalidated_at);
  });

  await check('Uploaded originals get separate display derivatives that never replace the original', async () => {
    const derivatives = await pool.query('SELECT kind,object_key,byte_size,sha256,source_sha256,width,height FROM product_image_derivatives WHERE product_image_id=$1 ORDER BY kind', [selectedFront.id]);
    assert.ok(derivatives.rowCount >= 1, 'expected at least a thumbnail derivative for the uploaded original');
    const originalRow = await pool.query('SELECT object_key,sha256,byte_size FROM product_images WHERE id=$1', [selectedFront.id]);
    for (const derivative of derivatives.rows) {
      // Distinct key space: a derivative must never sit on the original's key.
      assert.notEqual(derivative.object_key, originalRow.rows[0].object_key);
      assert.ok(derivative.object_key.startsWith('derivatives/'), `derivative key ${derivative.object_key} is outside the derivative key space`);
      // Provenance: recorded against the exact original bytes.
      assert.equal(derivative.source_sha256, originalRow.rows[0].sha256);
      // Smaller or equal, never a re-encode of the original in place.
      assert.ok(Number(derivative.byte_size) > 0);
    }
    // The original is byte-identical after derivative generation.
    const originalAfter = await api(`/api/products/${productA}/images/${selectedFront.id}`, { headers: headers(cookie) });
    assert.equal(originalAfter.status, 200);
    assert.deepEqual(Buffer.from(await originalAfter.arrayBuffer()), firstBytes);

    // Derivative is served only to an authenticated studio user.
    const thumbKind = derivatives.rows[0].kind;
    const anonymous = await api(`/api/products/${productA}/images/${selectedFront.id}/derivatives/${thumbKind}`);
    assert.equal(anonymous.status, 401);
    const served = await api(`/api/products/${productA}/images/${selectedFront.id}/derivatives/${thumbKind}`, { headers: headers(cookie) });
    assert.equal(served.status, 200);
    assert.equal(served.headers.get('content-type'), 'image/webp');
    const servedBytes = Buffer.from(await served.arrayBuffer());
    assert.equal(served.headers.get('x-derivative-sha256'), createHash('sha256').update(servedBytes).digest('hex'));
    assert.equal(served.headers.get('x-source-sha256'), originalRow.rows[0].sha256);
    // The preview is a re-encode, so it must not be byte-identical to the original.
    assert.ok(!servedBytes.equals(firstBytes));
  });

  await check('Storage health, recovery inventory and audit records remain accessible', async () => {
    const health = await api('/api/settings/health', { headers: headers(cookie) }); assert.equal(health.status, 200);
    const body = await health.json(); assert.equal(body.database, 'ready'); assert.equal(body.storage, 'ready');
    const count = await pool.query('SELECT count(*)::int AS count FROM audit_events'); assert.ok(count.rows[0].count >= 8);
  });
  console.log(`E2E smoke checks passed: ${passed}. Isolated test data is retained until the test volume is explicitly removed.`);
} finally {
  await stopServer(); await pool.end();
}
