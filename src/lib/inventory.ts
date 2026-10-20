import 'server-only';
import type { PoolClient } from 'pg';

/** Called inside the same transaction as every material product change. */
export async function bumpInventoryRevision(client: PoolClient, reason: string): Promise<number> {
  const revision = await client.query('UPDATE studio_inventory_state SET revision=revision+1,updated_at=now() WHERE id=1 RETURNING revision');
  if (!revision.rowCount) throw new Error('Inventory revision state is missing; apply database migrations.');
  await client.query(`UPDATE catalogue_approvals SET invalidated_at=now(),invalidation_reason=$1 WHERE invalidated_at IS NULL`, [reason]);
  await client.query(`UPDATE catalogues SET status='draft',revision=revision+1,rejection_reason=NULL,updated_at=now()
    WHERE status IN ('approved','exported','review','rejected','queued','running')`);
  return Number(revision.rows[0].revision);
}
