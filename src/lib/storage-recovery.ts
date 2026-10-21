import 'server-only';
import type { Pool } from 'pg';

/**
 * Tracks a private object while it is being written and committed.
 *
 * The pattern for any derived write (catalogue output, export) is:
 *   1. record the intended key, checksum and size  -> recovery row
 *   2. write the object
 *   3. commit the database row that references it
 *   4. clear the recovery row
 *
 * If the process dies between 2 and 3, the recovery row survives and the object
 * is accounted for instead of becoming an invisible orphan. If the write or the
 * commit fails while we are still running, we clean up instead of leaking.
 */

export type RecoveryPurpose = 'catalogue-output' | 'catalogue-export';

export async function reserveRecoveryObject(
  pool: Pool,
  input: { objectKey: string; provider: 'local' | 's3'; purpose: RecoveryPurpose; entityId: string; sha256: string; byteSize: number },
): Promise<string> {
  const result = await pool.query(
    `INSERT INTO storage_recovery_objects (object_key, storage_provider, purpose, entity_id, expected_sha256, byte_size)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [input.objectKey, input.provider, input.purpose, input.entityId, input.sha256, input.byteSize],
  );
  return result.rows[0].id as string;
}

export async function clearRecoveryObject(pool: Pool, recoveryId: string): Promise<void> {
  await pool.query('DELETE FROM storage_recovery_objects WHERE id=$1', [recoveryId]);
}

/**
 * Best-effort compensation for a write that will not be committed: remove the
 * object we just wrote, then the recovery row. Never throws, because the caller
 * is already handling a failure and must report the original error.
 */
export async function discardRecoveryObject(
  pool: Pool,
  storage: { remove(key: string): Promise<void> },
  recoveryId: string,
  objectKey: string,
): Promise<void> {
  let removed = true;
  try { await storage.remove(objectKey); } catch { removed = false; }
  // Only drop the recovery row once the object is actually gone; otherwise keep
  // it so the leftover object stays visible to the storage audit.
  if (!removed) return;
  await pool.query('DELETE FROM storage_recovery_objects WHERE id=$1', [recoveryId]).catch(() => undefined);
}
