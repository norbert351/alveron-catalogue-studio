import 'server-only';
import pg from 'pg';
import { requireDatabaseUrl } from './config';

const globalForDb = globalThis as typeof globalThis & { alveronPool?: pg.Pool };

export function getPool(): pg.Pool {
  const connectionString = requireDatabaseUrl();
  if (!globalForDb.alveronPool) {
    globalForDb.alveronPool = new pg.Pool({
      connectionString,
      max: 8,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 3_000,
      ssl: process.env.PGSSLMODE === 'require' ? { rejectUnauthorized: true } : undefined,
    });
  }
  return globalForDb.alveronPool;
}

export async function checkDatabase(): Promise<boolean> {
  try {
    await getPool().query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}
