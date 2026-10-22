/**
 * Standalone generation worker.
 *
 * Runs the same tick the generate route runs inline, on an interval, so queued
 * work still completes when the studio has no web request in flight (and after a
 * crash, once the lease logic returns the job to the queue).
 *
 *   npm run generation:worker            # one tick, then exit
 *   npm run generation:worker -- --loop  # poll every N seconds
 */
import { runGenerationTick } from '@/lib/generation/worker';
import { checkDatabase } from '@/lib/db';

const loop = process.argv.includes('--loop');
const intervalMs = Number(process.env.GENERATION_WORKER_INTERVAL_MS || '15000');

async function tick(): Promise<void> {
  const ready = await checkDatabase().catch(() => false);
  if (!ready) {
    console.error(JSON.stringify({ at: new Date().toISOString(), event: 'db_unavailable' }));
    return;
  }
  const result = await runGenerationTick();
  if (result.processed.length || result.recovered.requeued || result.recovered.failed) {
    console.log(JSON.stringify({ at: new Date().toISOString(), event: 'tick', ...result }));
  }
}

if (!loop) {
  await tick();
  process.exit(0);
}

console.log(JSON.stringify({ event: 'worker_started', intervalMs, pid: process.pid }));
let stopping = false;
process.on('SIGINT', () => { stopping = true; });
process.on('SIGTERM', () => { stopping = true; });

// A long-lived worker must never die on a single bad job: log and keep going.
while (!stopping) {
  try { await tick(); } catch (error) {
    console.error(JSON.stringify({ at: new Date().toISOString(), event: 'tick_failed', message: (error as Error).message.slice(0, 300) }));
  }
  await new Promise((resolve) => setTimeout(resolve, intervalMs));
}
console.log(JSON.stringify({ event: 'worker_stopped' }));
