import 'server-only';
import type { PoolClient } from 'pg';
import { derivativeKey, generateDerivative, type DerivativeKind } from './derivatives';
import type { PrivateStorage } from './storage';

/**
 * Creates and records display derivatives for one already-stored original.
 *
 * Contract:
 *  - The original row must already exist and be committed/visible to `client`.
 *  - Derivative bytes go to a separate key space and a separate table.
 *  - Failure is non-fatal: an original is still fully usable without a
 *    derivative, so a derivative problem must never fail an upload. The caller
 *    gets back which kinds succeeded so it can log the rest.
 */
export async function persistDerivatives(
  client: PoolClient,
  storage: PrivateStorage,
  input: {
    productId: string;
    imageId: string;
    originalBytes: Buffer;
    originalSha256: string;
    provider: 'local' | 's3';
    kinds?: DerivativeKind[];
  },
): Promise<{ created: DerivativeKind[]; failed: Array<{ kind: DerivativeKind; error: string }> }> {
  const created: DerivativeKind[] = [];
  const failed: Array<{ kind: DerivativeKind; error: string }> = [];
  const kinds = input.kinds ?? (['thumbnail', 'preview'] as DerivativeKind[]);

  for (const kind of kinds) {
    try {
      const derivative = await generateDerivative(input.originalBytes, input.originalSha256, kind);
      const key = derivativeKey(input.productId, input.imageId, kind);
      await storage.put(key, derivative.bytes, derivative.mediaType);
      await client.query(
        `INSERT INTO product_image_derivatives
           (product_image_id, kind, object_key, media_type, width, height, byte_size, sha256, storage_provider, source_sha256, recipe)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (object_key) DO NOTHING`,
        [
          input.imageId, derivative.kind, key, derivative.mediaType, derivative.width, derivative.height,
          derivative.bytes.length, derivative.sha256, input.provider, derivative.sourceSha256, JSON.stringify(derivative.recipe),
        ],
      );
      created.push(kind);
    } catch (error) {
      failed.push({ kind, error: error instanceof Error ? error.message : 'derivative failed' });
    }
  }
  return { created, failed };
}

/** Load the row shape the authenticated derivative route needs. */
export type DerivativeRecord = {
  object_key: string;
  media_type: string;
  byte_size: string | number;
  sha256: string;
  storage_provider: 'local' | 's3' | null;
  kind: string;
};
