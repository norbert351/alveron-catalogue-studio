import { NextResponse } from 'next/server';
import { checkDatabase } from '@/lib/db';
import { env } from '@/lib/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const database = await checkDatabase();
  return NextResponse.json({
    application: 'Alveron Catalogue Studio',
    database: database ? 'ready' : 'unavailable',
    storage: env.STORAGE_PROVIDER === 's3' ? 's3-configured' : 'local-private-files',
    imageGeneration: 'disabled-no-provider-configured',
  }, { status: database ? 200 : 503, headers: { 'Cache-Control': 'no-store' } });
}
