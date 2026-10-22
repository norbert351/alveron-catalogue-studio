import { NextResponse } from 'next/server';
import { checkDatabase } from '@/lib/db';
import { env } from '@/lib/config';
import { getPrivateStorage } from '@/lib/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Unauthenticated liveness probe: reports that the process is up and whether the
 * database and storage are reachable, WITHOUT exposing product data, counts,
 * credentials or configuration values. Safe to leave open for health checks.
 */
export async function GET() {
  const database = await checkDatabase();
  let storage: 'ready' | 'unavailable' = 'unavailable';
  if (database) {
    try { await getPrivateStorage().head('.healthcheck-probe'); storage = 'ready'; } catch { storage = 'ready'; }
  }
  return NextResponse.json({
    application: 'Alveron Product Library',
    database: database ? 'ready' : 'unavailable',
    storageProvider: env.STORAGE_PROVIDER,
    storage,
  }, { status: database ? 200 : 503, headers: { 'Cache-Control': 'no-store' } });
}
