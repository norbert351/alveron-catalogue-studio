import 'server-only';
import type { PoolClient } from 'pg';
import { getPool } from '../db';

/**
 * PostgreSQL-backed generation job queue.
 *
 * Design constraints from the brief:
 *  - No Redis or paid service: the queue lives in the existing database.
 *  - A server restart must not erase queued work.
 *  - Interrupted jobs must be recoverable and must never corrupt product data
 *    or an existing generated asset.
 *
 * Mechanism: a job is "claimed" by setting status='running' plus a lease
 * (lease_expires_at). A worker that dies leaves the lease behind, and any
 * process that sees an expired lease reclaims the job. Claims are serialised
 * with SELECT ... FOR UPDATE SKIP LOCKED so two workers cannot take one job.
 */

export type GenerationJobStatus = 'blocked' | 'queued' | 'running' | 'failed' | 'complete';

export type ClaimedJob = {
  id: string;
  catalogue_id: string;
  status: GenerationJobStatus;
  provider: string;
  model: string | null;
  attempts: number;
  max_attempts: number;
  input_snapshot: unknown;
  settings: unknown;
};

export const LEASE_SECONDS = 120;

/**
 * Recover jobs whose worker died: anything 'running' past its lease goes back to
 * 'queued' (if it still has attempts left) or 'failed' (if it does not).
 * Called on startup and before each claim, so a crash is self-healing.
 */
export async function recoverExpiredJobs(client?: PoolClient): Promise<{ requeued: number; failed: number }> {
  const runner = client ?? getPool();
  const requeued = await runner.query(
    `UPDATE generation_jobs SET status='queued', lease_expires_at=NULL, available_at=now(), updated_at=now(),
            error_code='lease_expired_requeued',
            error_message='The worker stopped responding; the job was returned to the queue.'
      WHERE status='running' AND lease_expires_at IS NOT NULL AND lease_expires_at < now() AND attempts < max_attempts
      RETURNING id`,
  );
  const failed = await runner.query(
    `UPDATE generation_jobs SET status='failed', lease_expires_at=NULL, finished_at=now(), updated_at=now(),
            error_code='lease_expired_exhausted',
            error_message='The worker stopped responding and no attempts remained.'
      WHERE status='running' AND lease_expires_at IS NOT NULL AND lease_expires_at < now() AND attempts >= max_attempts
      RETURNING id`,
  );
  return { requeued: requeued.rowCount ?? 0, failed: failed.rowCount ?? 0 };
}

/**
 * Claim the next runnable job. Returns null when the queue is empty.
 * The caller owns the lease and must call completeJob/failJob.
 */
export async function claimNextJob(workerId: string): Promise<ClaimedJob | null> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await client.query<ClaimedJob>(`
      WITH next_job AS (
        SELECT id FROM generation_jobs
         WHERE status='queued' AND available_at <= now()
         ORDER BY available_at, created_at
         FOR UPDATE SKIP LOCKED
         LIMIT 1
      )
      UPDATE generation_jobs j
         SET status='running',
             attempts = j.attempts + 1,
             worker_id = $2,
             heartbeat_at = now(),
             started_at = COALESCE(j.started_at, now()),
             lease_expires_at = now() + ($1 || ' seconds')::interval,
             updated_at = now(),
             error_code = NULL,
             error_message = NULL
        FROM next_job
       WHERE j.id = next_job.id
      RETURNING j.id, j.catalogue_id, j.status, j.provider, j.model, j.attempts, j.max_attempts, j.input_snapshot, j.settings`,
      [String(LEASE_SECONDS), workerId],
    );
    await client.query(
      `INSERT INTO generation_job_attempts (job_id, attempt, status) VALUES ($1,$2,'running')`,
      [result.rows[0]?.id, result.rows[0]?.attempts],
    ).catch(() => undefined);
    await client.query('COMMIT');
    return result.rows[0] ?? null;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally { client.release(); }
}

/** Mark a job complete. Idempotent: an already-complete job is left alone. */
export async function completeJob(jobId: string): Promise<boolean> {
  const result = await getPool().query(
    `UPDATE generation_jobs SET status='complete', lease_expires_at=NULL, finished_at=now(), updated_at=now()
      WHERE id=$1 AND status='running' RETURNING id`, [jobId],
  );
  await getPool().query(`UPDATE generation_job_attempts SET status='complete', finished_at=now() WHERE job_id=$1 AND status='running'`, [jobId]).catch(() => undefined);
  return (result.rowCount ?? 0) > 0;
}

/**
 * Mark a job failed, scheduling a retry if attempts remain.
 * Returns whether it will be retried.
 */
export async function failJob(jobId: string, code: string, message: string, retryDelaySeconds = 30): Promise<{ retried: boolean }> {
  const pool = getPool();
  const job = await pool.query('SELECT attempts, max_attempts FROM generation_jobs WHERE id=$1', [jobId]);
  const row = job.rows[0];
  if (!row) return { retried: false };
  const retried = Number(row.attempts) < Number(row.max_attempts);
  await pool.query(
    `UPDATE generation_jobs
        SET status=$2, error_code=$3, error_message=$4, lease_expires_at=NULL, updated_at=now(),
            available_at = CASE WHEN $2='queued' THEN now() + ($5 || ' seconds')::interval ELSE available_at END,
            finished_at = CASE WHEN $2='failed' THEN now() ELSE NULL END
      WHERE id=$1`,
    [jobId, retried ? 'queued' : 'failed', code, message.slice(0, 1000), String(retryDelaySeconds)],
  );
  await pool.query(`UPDATE generation_job_attempts SET status='failed', error_code=$2, finished_at=now() WHERE job_id=$1 AND status='running'`, [jobId, code]).catch(() => undefined);
  return { retried };
}

/** Queue health for the settings screen. */
export async function generationQueueHealth(): Promise<{ queued: number; running: number; failed: number; blocked: number; complete: number; staleLeases: number }> {
  const result = await getPool().query(`
    SELECT count(*) FILTER (WHERE status='queued')::int AS queued,
           count(*) FILTER (WHERE status='running')::int AS running,
           count(*) FILTER (WHERE status='failed')::int AS failed,
           count(*) FILTER (WHERE status='blocked')::int AS blocked,
           count(*) FILTER (WHERE status='complete')::int AS complete,
           count(*) FILTER (WHERE status='running' AND lease_expires_at < now())::int AS stale
      FROM generation_jobs`);
  const row = result.rows[0] ?? {};
  return { queued: Number(row.queued ?? 0), running: Number(row.running ?? 0), failed: Number(row.failed ?? 0), blocked: Number(row.blocked ?? 0), complete: Number(row.complete ?? 0), staleLeases: Number(row.stale ?? 0) };
}
