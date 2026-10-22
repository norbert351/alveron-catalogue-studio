import test from 'node:test';
import assert from 'node:assert/strict';
import { productInputSchema } from '../src/lib/product-rules';
import { hasStudioAccess, isSafeObjectKey, isSameOrigin } from '../src/lib/security-rules';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { storeImmutableFile } from '../src/lib/storage-files';

const productA = '2bb7f6f9-d43e-45b7-9f2e-67ca60629c91';

test('product metadata retains unknown visual attributes as null', () => {
  const parsed = productInputSchema.parse({ name: '  Wool jacket ', category: 'outerwear' });
  assert.equal(parsed.name, 'Wool jacket');
  assert.equal(parsed.color, null);
  assert.equal(parsed.fabric, null);
  assert.equal(parsed.pattern, null);
  assert.equal(parsed.fit, null);
});

test('product input rejects unsupported categories and blank names', () => {
  assert.equal(productInputSchema.safeParse({ name: 'X', category: 'uniform' }).success, false);
  assert.equal(productInputSchema.safeParse({ name: ' ', category: 'tops' }).success, false);
});

test('private image routes require an authenticated studio identity', () => {
  assert.equal(hasStudioAccess(null), false);
  assert.equal(hasStudioAccess(undefined), false);
  assert.equal(hasStudioAccess({ id: productA, role: 'owner' }), true);
  assert.equal(hasStudioAccess({ id: productA, role: 'editor' }), true);
});

test('state-changing requests require a same-origin browser request', () => {
  assert.equal(isSameOrigin('http://localhost:3000/api/products', 'http://localhost:3000'), true);
  assert.equal(isSameOrigin('http://localhost:3000/api/products', 'http://127.0.0.1:3000', '127.0.0.1:3000'), true);
  assert.equal(isSameOrigin('http://localhost:3000/api/products', 'https://attacker.example'), false);
  assert.equal(isSameOrigin('http://localhost:3000/api/products', null), false);
});

test('object keys reject path traversal and unexpected suffixes', () => {
  assert.equal(isSafeObjectKey('products/abc/item_123.webp'), true);
  assert.equal(isSafeObjectKey('../public/image.jpg'), false);
  assert.equal(isSafeObjectKey('products/abc/item.svg'), false);
});

test('object keys allow every private extension the app actually writes', () => {
  // Regression: PDF exports were silently rejected by the key guard because the
  // allowlist only covered jpg/png/webp, so every PDF export failed at write time.
  const id = 'd924f76e-b56f-4f57-a444-52c325f26c92';
  for (const key of [
    `products/${id}/a1b2c3d4.png`,
    `products/${id}/a1b2c3d4.jpg`,
    `products/${id}/a1b2c3d4.webp`,
    `catalogues/${id}/outputs/a1b2c3d4.png`,
    `catalogues/${id}/exports/a1b2c3d4.jpg`,
    `catalogues/${id}/exports/a1b2c3d4.pdf`,
    'healthchecks/a1b2c3d4.png',
  ]) {
    assert.equal(isSafeObjectKey(key), true, `expected ${key} to be an allowed key`);
  }
});

test('object keys reject traversal, absolute, empty-segment and control-character forms', () => {
  for (const key of [
    '/etc/passwd.jpg',
    'products/../../etc/passwd.png',
    'products//double.png',
    'products\\windows.png',
    'products/abc/',
    'products/abc/file name.png',
    'products/abc/file\nname.png',
    'products/abc/.hidden.png',
    'Products/ABC/UPPER.png',
    '',
    'a'.repeat(600) + '.png',
    'products/abc/file.pdf.exe',
  ]) {
    assert.equal(isSafeObjectKey(key), false, `expected ${JSON.stringify(key)} to be rejected`);
  }
});

test('original file keys are write-once and cannot be silently replaced', async () => {
  const root = await mkdtemp(join(tmpdir(), 'alveron-storage-test-'));
  const original = Buffer.from('owner-upload-original');
  try {
    await storeImmutableFile(root, 'products/product_a/image_a.jpg', original);
    await assert.rejects(storeImmutableFile(root, 'products/product_a/image_a.jpg', Buffer.from('replacement')));
    assert.deepEqual(await readFile(join(root, 'products/product_a/image_a.jpg')), original);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
