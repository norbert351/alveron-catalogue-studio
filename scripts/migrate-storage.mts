import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import pg from 'pg';
import { env } from '../src/lib/config';
import { getPrivateStorage, type PrivateStorage } from '../src/lib/storage';

type InventoryRow = { table_name: 'product_images' | 'generated_assets' | 'catalogue_exports'; id: string; object_key: string; storage_provider: 'local' | 's3' | null; sha256: string; byte_size: string; media_type: string };
const args = process.argv.slice(2);
const arg = (name: string) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
const from = arg('--from'); const to = arg('--to');
if (!['local', 's3'].includes(from ?? '') || !['local', 's3'].includes(to ?? '') || from === to) throw new Error('Usage: npm run storage:migrate -- --from local|s3 --to local|s3 [--report path]');
if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
const sourceProvider = from as 'local' | 's3'; const destinationProvider = to as 'local' | 's3';
const source = getPrivateStorage(sourceProvider, true); const destination = getPrivateStorage(destinationProvider, true);
const pool = new pg.Pool({ connectionString: env.DATABASE_URL });
const report: { startedAt: string; source: string; destination: string; inventoryCount: number; copied: number; resumed: number; failed: number; items: Array<Record<string, unknown>> } = { startedAt: new Date().toISOString(), source: sourceProvider, destination: destinationProvider, inventoryCount: 0, copied: 0, resumed: 0, failed: 0, items: [] };

async function sha(bytes: Buffer) { return createHash('sha256').update(bytes).digest('hex'); }
async function transfer(storage: PrivateStorage, key: string, bytes: Buffer, mime: string): Promise<'copied' | 'resumed'> {
  try { await storage.put(key, bytes, mime); return 'copied'; }
  catch (copyError) {
    let existing: Buffer;
    try { existing = await storage.get(key); }
    catch { throw copyError; }
    if (existing.length !== bytes.length || await sha(existing) !== await sha(bytes)) throw new Error(`Conflicting destination object exists at ${key}; it was not overwritten.`, { cause: copyError });
    return 'resumed';
  }
}

try {
  const inventory: InventoryRow[] = [];
  const queries = {
    product_images: 'SELECT id,object_key,storage_provider,sha256,byte_size,media_type FROM product_images',
    generated_assets: 'SELECT id,object_key,storage_provider,sha256,byte_size,media_type FROM generated_assets',
    catalogue_exports: `SELECT id,object_key,storage_provider,sha256,byte_size,CASE format WHEN 'png' THEN 'image/png' WHEN 'jpeg' THEN 'image/jpeg' ELSE 'application/pdf' END AS media_type FROM catalogue_exports`,
  } as const;
  for (const table of Object.keys(queries) as Array<keyof typeof queries>) {
    const rows = await pool.query(queries[table]);
    inventory.push(...rows.rows.map((row) => ({ ...row, table_name: table })));
  }
  report.inventoryCount = inventory.filter((row) => (row.storage_provider ?? sourceProvider) === sourceProvider).length;
  for (const row of inventory) {
    const currentProvider = row.storage_provider ?? sourceProvider;
    if (currentProvider !== sourceProvider) continue;
    try {
      const sourceBytes = await source.get(row.object_key);
      if (sourceBytes.length !== Number(row.byte_size) || await sha(sourceBytes) !== row.sha256) throw new Error(`Source size/checksum mismatch for ${row.object_key}.`);
      const outcome = await transfer(destination, row.object_key, sourceBytes, row.media_type);
      const copy = await destination.get(row.object_key);
      const stats = await destination.head(row.object_key);
      if (copy.length !== sourceBytes.length || stats.byteSize !== sourceBytes.length || await sha(copy) !== row.sha256) throw new Error(`Destination verification failed for ${row.object_key}.`);
      const changed = await pool.query(`UPDATE ${row.table_name} SET storage_provider=$1 WHERE id=$2 AND storage_provider IS NOT DISTINCT FROM $3`, [destinationProvider, row.id, row.storage_provider]);
      if (!changed.rowCount) {
        const latest = await pool.query(`SELECT storage_provider FROM ${row.table_name} WHERE id=$1`, [row.id]);
        if (latest.rows[0]?.storage_provider !== destinationProvider) throw new Error(`Storage reference changed before commit for ${row.object_key}.`);
      }
      if (outcome === 'copied') report.copied += 1; else report.resumed += 1;
      report.items.push({ table: row.table_name, id: row.id, key: row.object_key, status: outcome, byteSize: sourceBytes.length, sha256: row.sha256 });
    } catch (error) {
      report.failed += 1;
      report.items.push({ table: row.table_name, id: row.id, key: row.object_key, status: 'failed', error: error instanceof Error ? error.message : 'Unknown migration error' });
    }
  }
} finally { await pool.end(); }

const reportPath = resolve(arg('--report') ?? `.local-data/migration-reports/storage-${Date.now()}.json`);
await mkdir(dirname(reportPath), { recursive: true, mode: 0o700 });
await writeFile(reportPath, `${JSON.stringify({ ...report, completedAt: new Date().toISOString() }, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ ...report, reportPath }, null, 2));
if (report.failed) process.exitCode = 1;
