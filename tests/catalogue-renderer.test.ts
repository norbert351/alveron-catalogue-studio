import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { renderOriginalPhotoCatalogue } from '../src/lib/catalogue-renderer';

test('source-photo layout is a 1080x1350 PNG derived from the exact supplied image bytes', async () => {
  const source = await sharp({ create: { width: 24, height: 32, channels: 3, background: '#8c1e26' } }).png().toBuffer();
  const result = await renderOriginalPhotoCatalogue({ title: 'Alveron test layout', style: 'modern tailoring', occasion: 'workwear', items: [
    { name: 'Uploaded coat', role: 'outerwear', view: 'front', bytes: source },
    { name: 'Uploaded trousers', role: 'bottom', view: 'side', bytes: source },
  ] });
  const metadata = await sharp(result.bytes).metadata();
  assert.equal(result.width, 1080);
  assert.equal(result.height, 1350);
  assert.equal(metadata.format, 'png');
  assert.equal(metadata.width, 1080);
  assert.equal(metadata.height, 1350);
  assert.notDeepEqual(result.bytes, source);
  assert.match(result.bytes.toString('latin1').slice(0, 24), /PNG/);
});
