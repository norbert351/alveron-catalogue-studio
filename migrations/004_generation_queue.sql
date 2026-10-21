-- Durable generation queue support.
--
-- The job table already carries lease/attempt fields. This migration adds the
-- indexes the queue worker needs to claim and recover jobs efficiently, plus a
-- record of worker identity so a stale lease can be attributed.

ALTER TABLE generation_jobs
  ADD COLUMN IF NOT EXISTS worker_id TEXT,
  ADD COLUMN IF NOT EXISTS heartbeat_at TIMESTAMPTZ;

-- Claim path: find the oldest runnable job without scanning history.
CREATE INDEX IF NOT EXISTS generation_jobs_claimable_idx
  ON generation_jobs(status, available_at, created_at)
  WHERE status = 'queued';

-- Recovery path: find running jobs whose lease has expired.
CREATE INDEX IF NOT EXISTS generation_jobs_lease_idx
  ON generation_jobs(lease_expires_at)
  WHERE status = 'running';

-- A job may only be in flight once per attempt number.
CREATE UNIQUE INDEX IF NOT EXISTS generation_job_attempts_unique_idx
  ON generation_job_attempts(job_id, attempt);
