import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { validateImage } from '../src/lib/image-validation';

test('image validation uses file bytes, not the browser MIME label or filename', async () => {
  const png = await sharp({ create: { width: 24, height: 32, channels: 3, background: '#e6dfd3' } }).png().toBuffer();
  const file = new File([png], 'garment.jpg', { type: 'image/jpeg' });
  const validated = await validateImage(file);
  assert.equal(validated.mediaType, 'image/png');
  assert.equal(validated.extension, 'png');
  assert.equal(validated.width, 24);
  assert.equal(validated.height, 32);
  assert.deepEqual(validated.bytes, png);
});

test('image validation rejects unsupported SVG input', async () => {
  const file = new File(['<svg xmlns="http://www.w3.org/2000/svg"></svg>'], 'source.svg', { type: 'image/svg+xml' });
  await assert.rejects(validateImage(file), /JPEG, PNG, or WebP/);
});
