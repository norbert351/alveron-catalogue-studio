import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import pg from 'pg';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required. Copy .env.example to .env.local and set it.');

const client = new pg.Client({ connectionString });
await client.connect();
try {
  await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
  const files = (await readdir('migrations')).filter((file) => file.endsWith('.sql')).sort();
  for (const name of files) {
    const exists = await client.query('SELECT 1 FROM schema_migrations WHERE name = $1', [name]);
    if (exists.rowCount) continue;
    await client.query('BEGIN');
    try {
      await client.query(await readFile(join('migrations', name), 'utf8'));
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
      await client.query('COMMIT');
      console.log(`Applied ${name}`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }
  console.log('Database migrations are current.');
} finally {
  await client.end();
}
