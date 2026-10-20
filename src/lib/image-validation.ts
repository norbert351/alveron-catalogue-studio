import { fileTypeFromBuffer } from 'file-type';
import sharp from 'sharp';

export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
export const MAX_PRODUCT_IMAGES = 5;
const ACCEPTED_TYPES = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
]);

export type ValidatedImage = {
  bytes: Buffer;
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp';
  extension: 'jpg' | 'png' | 'webp';
  width: number;
  height: number;
};

export async function validateImage(file: File): Promise<ValidatedImage> {
  if (file.size === 0 || file.size > MAX_IMAGE_BYTES) throw new Error('Each image must be between 1 byte and 15 MB.');
  const bytes = Buffer.from(await file.arrayBuffer());
  const detected = await fileTypeFromBuffer(bytes);
  if (!detected || !ACCEPTED_TYPES.has(detected.mime)) throw new Error('Use a JPEG, PNG, or WebP product photo.');
  const metadata = await sharp(bytes, { limitInputPixels: 120_000_000, failOn: 'error' }).metadata();
  if (!metadata.width || !metadata.height || metadata.width > 12_000 || metadata.height > 12_000) {
    throw new Error('Image dimensions must be between 1 and 12,000 pixels per side.');
  }
  return {
    bytes,
    mediaType: detected.mime as ValidatedImage['mediaType'],
    extension: ACCEPTED_TYPES.get(detected.mime) as ValidatedImage['extension'],
    width: metadata.width,
    height: metadata.height,
  };
}
