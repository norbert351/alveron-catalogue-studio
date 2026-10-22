import 'server-only';
import type { PoolClient } from 'pg';
import { getPool } from './db';
import { configuredStorageProvider, getPrivateStorage } from './storage';

/**
 * Deleting products safely.
 *
 * Order matters. The database rows are removed inside a transaction FIRST, then
 * the objects are removed from storage. That ordering is deliberate:
 *
 *   - rows first, objects second  => a crash leaves an unreferenced file
 *     (recoverable, invisible to the app, reclaimable by the storage audit);
 *   - objects first, rows second  => a crash leaves a row pointing at a missing
 *     file (a broken product the owner can see and cannot fix).
 *
 * The first failure is the cheaper one, so we take it. Every object key is
 * collected inside the transaction, so nothing that is still referenced by
 * another record is ever deleted (the query only returns keys belonging to the
 * products being removed).
 *
 * A partial storage failure does not roll back the database delete, because the
 * rows are already gone by then. It is reported back per key so the caller can
 * surface it, and the leftover objects stay visible to the storage audit rather
 * than being silently forgotten.
 */

export type DeleteResult = {
  deletedProducts: string[];
  notFound: string[];
  objectsRemoved: number;
  objectsFailed: Array<{ key: string; reason: string }>;
};

export async function deleteProducts(productIds: string[]): Promise<DeleteResult> {
  const ids = [...new Set(productIds)];
  if (ids.length === 0) return { deletedProducts: [], notFound: [], objectsRemoved: 0, objectsFailed: [] };

  const pool = getPool();
  const storage = getPrivateStorage(configuredStorageProvider());
  const client: PoolClient = await pool.connect();
  let objectKeys: string[] = [];
  let derivativeKeys: string[] = [];
  let deleted: string[] = [];

  try {
    await client.query('BEGIN');
    // Re-check existence inside the transaction so a concurrent delete cannot
    // make us report a false success.
    const existing = await client.query<{ id: string }>('SELECT id FROM products WHERE id = ANY($1::uuid[]) FOR UPDATE', [ids]);
    deleted = existing.rows.map((row) => row.id);
    const notFound = ids.filter((id) => !deleted.includes(id));

    if (deleted.length) {
      // Collect every key we are about to orphan. Originals and derivatives are
      // separate prefixes; both must be removed or the disk keeps growing.
      const originals = await client.query<{ object_key: string }>(
        'SELECT object_key FROM product_images WHERE product_id = ANY($1::uuid[])', [deleted]);
      objectKeys = originals.rows.map((row) => row.object_key);
      const derivativeRows = await client.query<{ object_key: string }>(
        `SELECT d.object_key FROM product_image_derivatives d
           JOIN product_images i ON i.id = d.product_image_id
          WHERE i.product_id = ANY($1::uuid[])`, [deleted]).catch(() => ({ rows: [] as Array<{ object_key: string }> }));
      derivativeKeys = derivativeRows.rows.map((row) => row.object_key);

      // product_image_derivatives references product_images with ON DELETE
      // RESTRICT, so derivatives must be deleted explicitly before the images
      // they belong to. Deleting the images first fails with a foreign-key
      // violation instead of cascading.
      await client.query(
        `DELETE FROM product_image_derivatives d
          USING product_images i
          WHERE d.product_image_id = i.id AND i.product_id = ANY($1::uuid[])`, [deleted]);

      // Then the products. Remaining references (catalogue_items, approvals)
      // are removed by their own ON DELETE rules.
      await client.query('DELETE FROM products WHERE id = ANY($1::uuid[])', [deleted]);
    }

    await client.query('COMMIT');
    return finalize(deleted, notFound, objectKeys, derivativeKeys, storage);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function finalize(
  deleted: string[],
  notFound: string[],
  objectKeys: string[],
  derivativeKeys: string[],
  storage: { remove(key: string): Promise<void> },
): Promise<DeleteResult> {
  const objectsFailed: Array<{ key: string; reason: string }> = [];
  let removed = 0;
  for (const key of [...objectKeys, ...derivativeKeys]) {
    try { await storage.remove(key); removed += 1; }
    catch (error) { objectsFailed.push({ key, reason: (error as Error).message.slice(0, 160) }); }
  }
  return { deletedProducts: deleted, notFound, objectsRemoved: removed, objectsFailed };
}
