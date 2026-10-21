/**
 * Private storage integrity audit.
 *
 * Verifies, for every database-referenced private object, that the bytes on the
 * configured storage backend are present and match the recorded SHA-256 and byte
 * size. Also reports orphaned files (on disk but not referenced) so they can be
 * reviewed instead of silently accumulating or being deleted by mistake.
 *
 * Read-only by default. It never deletes or rewrites an object or a row.
 *
 *   npm run storage:verify                     # verify + report
 *   npm run storage:verify -- --json           # machine-readable output
 *   npm run storage:verify -- --report out.json
 *   npm run storage:verify -- --record         # also write image_integrity_checks
 *
 * Exit codes: 0 = every referenced object intact, 1 = drift found, 2 = cannot run.
 */
import { createHash } from 'node:crypto';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import pg from 'pg';
import { env } from '../src/lib/config';
import { getPrivateStorage } from '../src/lib/storage';
import { isSafeObjectKey } from '../src/lib/security-rules';

type Ref = {
  table: 'product_images' | 'generated_assets' | 'catalogue_exports' | 'product_image_derivatives';
  id: string;
  object_key: string;
  storage_provider: 'local' | 's3' | null;
  sha256: string;
  byte_size: string;
};

type Outcome = {
  table: Ref['table'];
  id: string;
  key: string;
  provider: 'local' | 's3';
  status: 'intact' | 'missing' | 'checksum_mismatch' | 'size_mismatch';
  expectedByteSize: number;
  observedByteSize?: number;
  observedSha256?: string;
  error?: string;
};

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const record = args.includes('--record');
const reportIndex = args.indexOf('--report');
const reportPath = reportIndex >= 0 ? args[reportIndex + 1] : undefined;

if (!env.DATABASE_URL) {
  console.error('DATABASE_URL is required. It is read from .env.local.');
  process.exit(2);
}

const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

/** Every object this application is allowed to write, for orphan detection. */
async function listLocalObjects(root: string): Promise<string[]> {
  const found: string[] = [];
  async function walk(directory: string, prefix: string): Promise<void> {
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); }
    catch { return; }
    for (const entry of entries) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(join(directory, entry.name), relative);
      else if (entry.isFile()) found.push(relative);
    }
  }
  await walk(resolve(root), '');
  return found;
}

const pool = new pg.Pool({ connectionString: env.DATABASE_URL });
const outcomes: Outcome[] = [];
let orphans: string[] = [];
let errorCount = 0;

try {
  const refs: Ref[] = [];
  const queries: Array<[Ref['table'], string]> = [
    ['product_images', 'SELECT id,object_key,storage_provider,sha256,byte_size FROM product_images'],
    ['generated_assets', 'SELECT id,object_key,storage_provider,sha256,byte_size FROM generated_assets'],
    ['catalogue_exports', `SELECT id,object_key,storage_provider,sha256,byte_size FROM catalogue_exports`],
    ['product_image_derivatives', 'SELECT id,object_key,storage_provider,sha256,byte_size FROM product_image_derivatives'],
  ];
  for (const [table, sql] of queries) {
    // product_image_derivatives may predate migration 003 in an older database.
    try {
      const result = await pool.query(sql);
      refs.push(...result.rows.map((row) => ({ ...row, table })));
    } catch (error) {
      if (table === 'product_image_derivatives') { console.warn('Skipping derivatives: table not present (apply migrations).'); continue; }
      throw error;
    }
  }

  for (const ref of refs) {
    const provider = ref.storage_provider ?? env.STORAGE_PROVIDER;
    const expectedByteSize = Number(ref.byte_size);
    const base = { table: ref.table, id: ref.id, key: ref.object_key, provider, expectedByteSize };
    try {
      if (!isSafeObjectKey(ref.object_key)) throw Object.assign(new Error('Object key is not a valid generated private key.'), { code: 'UNSAFE_KEY' });
      const storage = getPrivateStorage(provider, true);
      const bytes = await storage.get(ref.object_key);
      if (bytes.length !== expectedByteSize) {
        outcomes.push({ ...base, status: 'size_mismatch', observedByteSize: bytes.length });
        continue;
      }
      const digest = sha(bytes);
      if (digest === ref.sha256) outcomes.push({ ...base, status: 'intact', observedByteSize: bytes.length });
      else outcomes.push({ ...base, status: 'checksum_mismatch', observedByteSize: bytes.length, observedSha256: digest });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      const message = error instanceof Error ? error.message : String(error);
      const missing = code === 'ENOENT' || code === 'NoSuchKey' || code === 'NotFound' || /missing|not found|unavailable/i.test(message);
      outcomes.push({ ...base, status: missing ? 'missing' : 'checksum_mismatch', error: message });
    }
  }

  if (env.STORAGE_PROVIDER === 'local') {
    const referenced = new Set(refs.map((ref) => ref.object_key));
    orphans = (await listLocalObjects(env.LOCAL_STORAGE_DIR))
      .filter((key) => !key.startsWith('healthchecks/'))
      .filter((key) => !referenced.has(key));
  }

  if (record) {
    for (const outcome of outcomes) {
      if (outcome.table !== 'product_images') continue;
      await pool.query(
        `INSERT INTO image_integrity_checks (product_image_id,status,observed_byte_size,storage_provider) VALUES ($1,$2,$3,$4)`,
        [outcome.id, outcome.status, outcome.observedByteSize ?? null, outcome.provider],
      );
      await pool.query(`UPDATE product_images SET last_verified_at=now(),last_verified_status=$2 WHERE id=$1`, [outcome.id, outcome.status]);
    }
  }
} catch (error) {
  console.error('Integrity audit could not run:', error instanceof Error ? error.message : error);
  await pool.end();
  process.exit(2);
}

const intact = outcomes.filter((outcome) => outcome.status === 'intact').length;
const drifted = outcomes.length - intact;
const byTable = outcomes.reduce<Record<string, { total: number; intact: number }>>((accumulator, outcome) => {
  accumulator[outcome.table] ??= { total: 0, intact: 0 };
  accumulator[outcome.table].total += 1;
  if (outcome.status === 'intact') accumulator[outcome.table].intact += 1;
  return accumulator;
}, {});

const summary = {
  checkedAt: new Date().toISOString(),
  storageProvider: env.STORAGE_PROVIDER,
  referencedObjects: outcomes.length,
  intact,
  drifted,
  orphans: orphans.length,
  byTable,
  problems: outcomes.filter((outcome) => outcome.status !== 'intact'),
  orphanKeys: orphans,
};

if (reportPath) {
  await mkdir(dirname(resolve(reportPath)), { recursive: true });
  await writeFile(resolve(reportPath), `${JSON.stringify(summary, null, 2)}\n`);
}

if (asJson) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.log(`Storage integrity audit — provider "${summary.storageProvider}"`);
  console.log(`  referenced objects : ${summary.referencedObjects}`);
  console.log(`  intact             : ${intact}`);
  console.log(`  drifted / missing  : ${drifted}`);
  console.log(`  orphan files       : ${orphans.length}${env.STORAGE_PROVIDER === 'local' ? '' : ' (orphan scan is local-only)'}`);
  for (const [table, stats] of Object.entries(byTable)) {
    console.log(`  ${table.padEnd(27)} ${stats.intact}/${stats.total} intact`);
  }
  if (summary.problems.length) {
    console.log('\nPROBLEMS (no data was modified):');
    for (const problem of summary.problems) console.log(`  ! ${problem.status} :: ${problem.table} ${problem.id} :: ${problem.key}`);
  }
  if (orphans.length) {
    console.log('\nORPHAN FILES (present on disk, not referenced by any row — review before removing):');
    for (const key of orphans.slice(0, 50)) console.log(`  ? ${key}`);
    if (orphans.length > 50) console.log(`  ... and ${orphans.length - 50} more`);
  }
  if (reportPath) console.log(`\nReport written to ${resolve(reportPath)}`);
}

errorCount = drifted;
await pool.end();
process.exit(errorCount > 0 ? 1 : 0);
