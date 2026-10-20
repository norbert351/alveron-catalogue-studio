import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { jpegPagePdf } from '../src/lib/pdf';

test('PDF export embeds a rendered catalogue JPEG in a single-page PDF document', async () => {
  const jpeg = await sharp({ create: { width: 1080, height: 1350, channels: 3, background: '#eeeae3' } }).jpeg().toBuffer();
  const pdf = jpegPagePdf(jpeg, 1080, 1350);
  const text = pdf.toString('latin1');
  assert.ok(text.startsWith('%PDF-1.4'));
  assert.match(text, /\/Subtype \/Image/);
  assert.match(text, /\/Filter \/DCTDecode/);
  assert.match(text, /\/Count 1/);
  assert.match(text, /%%EOF/);
});
