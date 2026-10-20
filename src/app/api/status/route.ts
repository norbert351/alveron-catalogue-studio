import { NextResponse } from 'next/server';
import { checkDatabase } from '@/lib/db';
import { env } from '@/lib/config';
import { getImageGenerationProvider } from '@/lib/generation/provider';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const database = await checkDatabase();
  return NextResponse.json({
    application: 'Alveron Catalogue Studio',
    database: database ? 'ready' : 'unavailable',
    storage: env.STORAGE_PROVIDER === 's3' ? (env.S3_BUCKET && env.S3_REGION ? 's3-settings-present' : 's3-configuration-incomplete') : 'local-private-files',
    imageGeneration: getImageGenerationProvider()?.id ?? 'disabled-no-provider-configured',
  }, { status: database ? 200 : 503, headers: { 'Cache-Control': 'no-store' } });
}
