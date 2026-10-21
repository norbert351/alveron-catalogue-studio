import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { generateDerivative } from '../src/lib/derivatives';

// A realistic full-resolution garment photo: 4000x5000 with noise so it cannot
// compress to nothing and the comparison is honest.
const width = 4000;
const height = 5000;
const raw = Buffer.alloc(width * height * 3);
for (let i = 0; i < raw.length; i += 1) raw[i] = (i * 37 + (i >> 7) * 101) & 255;
const photo = await sharp(raw, { raw: { width, height, channels: 3 } }).jpeg({ quality: 92 }).toBuffer();
const sha = createHash('sha256').update(photo).digest('hex');

console.log(`original   ${width}x${height}  ${(photo.length / 1024).toFixed(0)} KB`);
for (const kind of ['thumbnail', 'preview'] as const) {
  const derivative = await generateDerivative(photo, sha, kind);
  const saving = (1 - derivative.bytes.length / photo.length) * 100;
  console.log(`${kind.padEnd(10)} ${`${derivative.width}x${derivative.height}`.padEnd(11)} ${(derivative.bytes.length / 1024).toFixed(0).padStart(6)} KB  ${saving.toFixed(1)}% smaller  source=${derivative.sourceSha256.slice(0, 12)}`);
}
