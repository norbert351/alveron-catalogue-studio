import 'server-only';
import { getPool } from './db';

/**
 * Read-only durability snapshot for the settings screen.
 *
 * Reports what is actually in the database: how many originals exist, how many
 * have a display derivative, the current retention mode, and the last recorded
 * integrity result per image. It never mutates anything.
 */
export type DurabilitySnapshot = {
  originals: number;
  originalBytes: number;
  withThumbnail: number;
  withPreview: number;
  retentionMode: string;
  pendingDeletions: number;
  neverVerified: number;
  failingIntegrity: number;
  lastCheckedAt: string | null;
};

export async function loadDurabilitySnapshot(): Promise<DurabilitySnapshot> {
  const pool = getPool();
  const [images, derivatives, policy, deletions, integrity] = await Promise.all([
    pool.query(`SELECT count(*)::int AS originals, COALESCE(sum(byte_size),0)::bigint AS bytes,
                       count(*) FILTER (WHERE last_verified_status IS NULL)::int AS never_verified,
                       count(*) FILTER (WHERE last_verified_status IS NOT NULL AND last_verified_status <> 'intact')::int AS failing
                  FROM product_images`),
    pool.query(`SELECT count(DISTINCT product_image_id) FILTER (WHERE kind='thumbnail')::int AS thumbs,
                       count(DISTINCT product_image_id) FILTER (WHERE kind='preview')::int AS previews
                  FROM product_image_derivatives`),
    pool.query(`SELECT mode FROM image_retention_policy WHERE id=1`),
    pool.query(`SELECT count(*)::int AS pending FROM image_deletion_requests WHERE status='pending'`),
    pool.query(`SELECT max(checked_at) AS last FROM image_integrity_checks`),
  ]);

  const lastCheck = integrity.rows[0]?.last as Date | null | undefined;
  return {
    originals: Number(images.rows[0]?.originals ?? 0),
    originalBytes: Number(images.rows[0]?.bytes ?? 0),
    withThumbnail: Number(derivatives.rows[0]?.thumbs ?? 0),
    withPreview: Number(derivatives.rows[0]?.previews ?? 0),
    retentionMode: policy.rows[0]?.mode ?? 'retain-all',
    pendingDeletions: Number(deletions.rows[0]?.pending ?? 0),
    neverVerified: Number(images.rows[0]?.never_verified ?? 0),
    failingIntegrity: Number(images.rows[0]?.failing ?? 0),
    lastCheckedAt: lastCheck ? new Date(lastCheck).toISOString() : null,
  };
}
