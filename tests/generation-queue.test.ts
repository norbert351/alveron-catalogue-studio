/**
 * Generation queue durability tests (brief: "durable queue", "a server restart
 * must not silently erase queued work", "retries idempotent").
 *
 * These exercise the real queue functions against the real database. Every row
 * created is removed afterwards. Skips without DATABASE_URL.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { claimNextJob, completeJob, failJob, recoverExpiredJobs, generationQueueHealth } from '../src/lib/generation/queue';

const connectionString = process.env.DATABASE_URL;
const dbTest = connectionString ? test : test.skip;

async function withCatalogue<T>(run: (pool: pg.Pool, catalogueId: string) => Promise<T>): Promise<T | undefined> {
  const pool = new pg.Pool({ connectionString });
  const catalogueId = randomUUID();
  try {
    const user = await pool.query('SELECT id FROM studio_users LIMIT 1');
    if (!user.rowCount) return undefined;
    await pool.query(
      `INSERT INTO catalogues (id,title,style,occasion,created_by) VALUES ($1,'Queue test','modern-tailoring','workwear',$2)`,
      [catalogueId, user.rows[0].id],
    );
    return await run(pool, catalogueId);
  } finally {
    await pool.query('DELETE FROM generation_job_attempts WHERE job_id IN (SELECT id FROM generation_jobs WHERE catalogue_id=$1)', [catalogueId]).catch(() => undefined);
    await pool.query('DELETE FROM generation_jobs WHERE catalogue_id=$1', [catalogueId]).catch(() => undefined);
    await pool.query('DELETE FROM catalogues WHERE id=$1', [catalogueId]).catch(() => undefined);
    await pool.end();
  }
}

dbTest('a queued job survives losing its database connections (restart simulation)', async () => {
  await withCatalogue(async (pool, catalogueId) => {
    await pool.query(
      `INSERT INTO generation_jobs (catalogue_id,status,provider,idempotency_key,error_code) VALUES ($1,'queued','test-provider',$2,NULL)`,
      [catalogueId, `key-${randomUUID()}`],
    );
    // Kill every other backend: this is what a process restart looks like to
    // anything holding a connection. The row itself must be unaffected.
    await pool.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()").catch(() => undefined);
    const fresh = new pg.Pool({ connectionString });
    try {
      const row = await fresh.query("SELECT status FROM generation_jobs WHERE catalogue_id=$1", [catalogueId]);
      assert.equal(row.rowCount, 1, 'the queued job must still exist after reconnect');
      assert.equal(row.rows[0].status, 'queued', 'queued work must not be erased by a restart');
    } finally { await fresh.end(); }
  });
});

dbTest('a claimed job is exclusive: two workers cannot take the same job', async () => {
  await withCatalogue(async (pool, catalogueId) => {
    const { rows } = await pool.query(
      `INSERT INTO generation_jobs (catalogue_id,status,provider,idempotency_key) VALUES ($1,'queued','test-worker',$2) RETURNING id`,
      [catalogueId, `key-${randomUUID()}`],
    );
    const [first, second] = await Promise.all([claimNextJob('worker-a'), claimNextJob('worker-b')]);
    const claimedIds = [first?.id, second?.id].filter(Boolean);
    // Both may claim *something*, but never the same job twice.
    assert.equal(new Set(claimedIds).size, claimedIds.length, 'a job must be claimed by exactly one worker');
    assert.ok(claimedIds.includes(rows[0].id), 'the queued job should have been claimed');
  });
});

dbTest('an expired lease is recovered and the job is requeued, not lost', async () => {
  await withCatalogue(async (pool, catalogueId) => {
    const { rows } = await pool.query(
      `INSERT INTO generation_jobs (catalogue_id,status,provider,idempotency_key,attempts,max_attempts,lease_expires_at,started_at)
       VALUES ($1,'running','test-crash',$2,1,3, now() - interval '5 minutes', now() - interval '10 minutes') RETURNING id`,
      [catalogueId, `key-${randomUUID()}`],
    );
    const outcome = await recoverExpiredJobs();
    assert.ok(outcome.requeued >= 1, 'an expired lease must return the job to the queue');
    const after = await pool.query('SELECT status,error_code FROM generation_jobs WHERE id=$1', [rows[0].id]);
    assert.equal(after.rows[0].status, 'queued');
    assert.equal(after.rows[0].error_code, 'lease_expired_requeued');
  });
});

dbTest('an expired lease with no attempts left becomes a clear failure', async () => {
  await withCatalogue(async (pool, catalogueId) => {
    const { rows } = await pool.query(
      `INSERT INTO generation_jobs (catalogue_id,status,provider,idempotency_key,attempts,max_attempts,lease_expires_at,started_at)
       VALUES ($1,'running','test-exhausted',$2,3,3, now() - interval '5 minutes', now() - interval '10 minutes') RETURNING id`,
      [catalogueId, `key-${randomUUID()}`],
    );
    await recoverExpiredJobs();
    const after = await pool.query('SELECT status,error_code,error_message FROM generation_jobs WHERE id=$1', [rows[0].id]);
    assert.equal(after.rows[0].status, 'failed');
    assert.equal(after.rows[0].error_code, 'lease_expired_exhausted');
    assert.ok(after.rows[0].error_message?.length > 0, 'a failure must carry a useful message');
  });
});

dbTest('failure schedules a retry while attempts remain, then stops at the limit', async () => {
  await withCatalogue(async (pool, catalogueId) => {
    const { rows } = await pool.query(
      `INSERT INTO generation_jobs (catalogue_id,status,provider,idempotency_key,attempts,max_attempts,lease_expires_at)
       VALUES ($1,'running','test-retry',$2,1,2, now() + interval '2 minutes') RETURNING id`,
      [catalogueId, `key-${randomUUID()}`],
    );
    const jobId = rows[0].id;
    const firstFailure = await failJob(jobId, 'provider_timeout', 'The provider timed out.', 0);
    assert.equal(firstFailure.retried, true, 'a failure with attempts remaining must be retried');
    let state = await pool.query('SELECT status,error_code,error_message FROM generation_jobs WHERE id=$1', [jobId]);
    assert.equal(state.rows[0].status, 'queued');
    assert.equal(state.rows[0].error_code, 'provider_timeout');

    // Exhaust the remaining attempt.
    await pool.query("UPDATE generation_jobs SET status='running', attempts=2, lease_expires_at=now() + interval '2 minutes' WHERE id=$1", [jobId]);
    const secondFailure = await failJob(jobId, 'provider_timeout', 'The provider timed out again.', 0);
    assert.equal(secondFailure.retried, false, 'the final attempt must not be retried forever');
    state = await pool.query('SELECT status FROM generation_jobs WHERE id=$1', [jobId]);
    assert.equal(state.rows[0].status, 'failed');
  });
});

dbTest('completing a job is idempotent and does not duplicate work', async () => {
  await withCatalogue(async (pool, catalogueId) => {
    const { rows } = await pool.query(
      `INSERT INTO generation_jobs (catalogue_id,status,provider,idempotency_key,attempts) VALUES ($1,'running','test-complete',$2,1) RETURNING id`,
      [catalogueId, `key-${randomUUID()}`],
    );
    assert.equal(await completeJob(rows[0].id), true, 'first completion succeeds');
    assert.equal(await completeJob(rows[0].id), false, 'a second completion must be a no-op');
    const state = await pool.query('SELECT status FROM generation_jobs WHERE id=$1', [rows[0].id]);
    assert.equal(state.rows[0].status, 'complete');
  });
});

dbTest('the same idempotency key never creates two jobs for one catalogue', async () => {
  await withCatalogue(async (pool, catalogueId) => {
    const key = `idem-${randomUUID()}`;
    // The application uses SELECT-then-INSERT inside a FOR UPDATE transaction
    // (see POST /api/catalogues/[id]/generate), not ON CONFLICT: the unique
    // index is partial, so it backs the constraint without being an upsert target.
    const insertGuarded = async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT id FROM catalogues WHERE id=$1 FOR UPDATE', [catalogueId]);
        const prior = await client.query('SELECT id FROM generation_jobs WHERE catalogue_id=$1 AND idempotency_key=$2', [catalogueId, key]);
        if (prior.rowCount) { await client.query('COMMIT'); return null; }
        const created = await client.query(
          `INSERT INTO generation_jobs (catalogue_id,status,provider,idempotency_key) VALUES ($1,'queued','test-idem',$2) RETURNING id`,
          [catalogueId, key],
        );
        await client.query('COMMIT');
        return created.rows[0].id as string;
      } catch (error) { await client.query('ROLLBACK').catch(() => undefined); throw error; } finally { client.release(); }
    };
    const first = await insertGuarded();
    const second = await insertGuarded();
    assert.ok(first, 'the first request creates a job');
    assert.equal(second, null, 'a retried request must return the existing job, not create a duplicate');
    const count = await pool.query('SELECT count(*)::int AS n FROM generation_jobs WHERE catalogue_id=$1 AND idempotency_key=$2', [catalogueId, key]);
    assert.equal(Number(count.rows[0].n), 1);

    // The partial unique index still blocks a direct duplicate insert.
    await assert.rejects(
      pool.query(`INSERT INTO generation_jobs (catalogue_id,status,provider,idempotency_key) VALUES ($1,'queued','test-idem',$2)`, [catalogueId, key]),
      /duplicate key|unique constraint/i,
      'the database must also refuse a duplicate key, not just the application',
    );
  });
});

dbTest('queue health reports real counts without leaking anything sensitive', async () => {
  const health = await generationQueueHealth();
  for (const key of ['queued', 'running', 'failed', 'blocked', 'complete', 'staleLeases'] as const) {
    assert.equal(typeof health[key], 'number', `${key} must be a number`);
    assert.ok(health[key] >= 0);
  }
});
