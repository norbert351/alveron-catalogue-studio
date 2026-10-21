import sharp from 'sharp';
import { createHash } from 'node:crypto';

/**
 * Derivative recipes for product photography.
 *
 * Derivatives are always re-encoded copies for display. They are NEVER written
 * to an original's storage key: the caller supplies a distinct key and the
 * database enforces the separation (see migration 003 triggers).
 */

export const DERIVATIVE_RECIPES = {
  /** Small grid/thumbnail tile. */
  thumbnail: { width: 480, height: 600, quality: 78 },
  /** Larger preview for review comparisons. */
  preview: { width: 1080, height: 1350, quality: 86 },
} as const;

export type DerivativeKind = keyof typeof DERIVATIVE_RECIPES;

export type GeneratedDerivative = {
  kind: DerivativeKind;
  bytes: Buffer;
  mediaType: 'image/webp';
  extension: 'webp';
  width: number;
  height: number;
  sha256: string;
  sourceSha256: string;
  recipe: { width: number; height: number; quality: number; fit: 'inside'; format: 'webp' };
};

/**
 * Produce a display derivative from original bytes.
 *
 * `fit: 'inside'` never crops or enlarges, so the derivative always shows the
 * entire garment exactly as uploaded. Orientation is normalised from EXIF.
 */
export async function generateDerivative(
  originalBytes: Buffer,
  originalSha256: string,
  kind: DerivativeKind,
): Promise<GeneratedDerivative> {
  const recipe = DERIVATIVE_RECIPES[kind];
  const pipeline = sharp(originalBytes, { limitInputPixels: 120_000_000, failOn: 'error' })
    .rotate()
    .resize({ width: recipe.width, height: recipe.height, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: recipe.quality, effort: 4 });

  const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
  return {
    kind,
    bytes: data,
    mediaType: 'image/webp',
    extension: 'webp',
    width: info.width,
    height: info.height,
    sha256: createHash('sha256').update(data).digest('hex'),
    sourceSha256: originalSha256,
    recipe: { width: recipe.width, height: recipe.height, quality: recipe.quality, fit: 'inside', format: 'webp' },
  };
}

/** Storage key for a derivative of a specific original image. */
export function derivativeKey(productId: string, imageId: string, kind: DerivativeKind): string {
  return `derivatives/${productId}/${imageId}-${kind}.webp`;
}
