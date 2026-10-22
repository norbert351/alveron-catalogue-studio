import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  createSignedOriginalToken,
  verifyOriginalSignature,
  signedOriginalUrl,
  SIGNING_MAX_TTL_SECONDS,
} from '../src/lib/library-signing';

/**
 * Signed-original-link contract.
 *
 * These pin the properties the public image link depends on: a signature is
 * bound to one image, expires, cannot be extended, and cannot be forged. A
 * regression here would either expose an original forever or break the link.
 */

const SECRET = 'test-signing-secret-that-is-long-enough-0123456789';
const OTHER = 'another-signing-secret-that-is-long-enough-9876543210';
const PRODUCT = '9f8e7d6c-5b4a-4321-8765-fedcba987654';
const IMAGE = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';

test('a freshly signed target verifies', () => {
  const signed = createSignedOriginalToken(PRODUCT, IMAGE, 600, SECRET);
  assert.ok(signed);
  const verdict = verifyOriginalSignature({ productId: PRODUCT, imageId: IMAGE, exp: String(signed.exp), sig: signed.sig }, SECRET);
  assert.equal(verdict, 'valid');
});

test('missing parameters are reported as missing, not as a crash', () => {
  assert.equal(verifyOriginalSignature({ productId: PRODUCT, imageId: IMAGE }, SECRET), 'missing');
  assert.equal(verifyOriginalSignature({ productId: PRODUCT, imageId: IMAGE, exp: '', sig: '' }, SECRET), 'missing');
});

test('a signature for one image cannot be replayed against another', () => {
  const signed = createSignedOriginalToken(PRODUCT, IMAGE, 600, SECRET);
  assert.ok(signed);
  const otherImage = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
  assert.equal(verifyOriginalSignature({ productId: PRODUCT, imageId: otherImage, exp: String(signed.exp), sig: signed.sig }, SECRET), 'invalid');
  const otherProduct = '11111111-1111-4111-8111-111111111111';
  assert.equal(verifyOriginalSignature({ productId: otherProduct, imageId: IMAGE, exp: String(signed.exp), sig: signed.sig }, SECRET), 'invalid');
});

test('tampering with the expiry or signature is rejected', () => {
  const signed = createSignedOriginalToken(PRODUCT, IMAGE, 600, SECRET);
  assert.ok(signed);
  assert.equal(verifyOriginalSignature({ productId: PRODUCT, imageId: IMAGE, exp: String(signed.exp + 60), sig: signed.sig }, SECRET), 'invalid');
  const flipped = `${signed.sig.slice(0, -1)}${signed.sig.endsWith('0') ? '1' : '0'}`;
  assert.equal(verifyOriginalSignature({ productId: PRODUCT, imageId: IMAGE, exp: String(signed.exp), sig: flipped }, SECRET), 'invalid');
});

test('a signature from a different secret is rejected', () => {
  const signed = createSignedOriginalToken(PRODUCT, IMAGE, 600, OTHER);
  assert.ok(signed);
  assert.equal(verifyOriginalSignature({ productId: PRODUCT, imageId: IMAGE, exp: String(signed.exp), sig: signed.sig }, SECRET), 'invalid');
});

test('expired links are rejected', async () => {
  const signed = createSignedOriginalToken(PRODUCT, IMAGE, 1, SECRET);
  assert.ok(signed);
  await new Promise((resolve) => setTimeout(resolve, 1200));
  assert.equal(verifyOriginalSignature({ productId: PRODUCT, imageId: IMAGE, exp: String(signed.exp), sig: signed.sig }, SECRET), 'expired');
});

test('links minted far beyond the maximum lifetime are rejected even if correctly signed', () => {
  const exp = Math.floor(Date.now() / 1000) + SIGNING_MAX_TTL_SECONDS + 3600;
  const sig = createHmac('sha256', SECRET).update(`${PRODUCT}.${IMAGE}.${exp}`, 'utf8').digest('hex');
  assert.equal(verifyOriginalSignature({ productId: PRODUCT, imageId: IMAGE, exp: String(exp), sig }, SECRET), 'invalid');
});

test('malformed expiry and signature shapes are rejected before any HMAC work', () => {
  assert.equal(verifyOriginalSignature({ productId: PRODUCT, imageId: IMAGE, exp: 'soon', sig: 'a'.repeat(64) }, SECRET), 'invalid');
  assert.equal(verifyOriginalSignature({ productId: PRODUCT, imageId: IMAGE, exp: '123', sig: 'short' }, SECRET), 'invalid');
});

test('the public URL carries only exp and sig, never a token or the secret', () => {
  const url = signedOriginalUrl('https://library.example', PRODUCT, IMAGE, 600, SECRET);
  assert.ok(url);
  const parsed = new URL(url);
  assert.equal(parsed.pathname, `/api/library/products/${PRODUCT}/images/${IMAGE}/original`);
  assert.match(parsed.searchParams.get('exp') ?? '', /^\d+$/);
  assert.match(parsed.searchParams.get('sig') ?? '', /^[0-9a-f]{64}$/);
  assert.equal(parsed.searchParams.has('token'), false);
  assert.equal(url.includes('alv_lib_'), false);
  assert.equal(url.includes(SECRET), false);
});

test('signing is optional: no secret means no signed URL', () => {
  assert.equal(signedOriginalUrl('https://library.example', PRODUCT, IMAGE, 600, null), null);
  assert.equal(createSignedOriginalToken(PRODUCT, IMAGE, 600, null), null);
});
