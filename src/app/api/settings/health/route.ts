import { NextResponse } from 'next/server';
import { getCurrentUser, isSameOrigin } from '@/lib/auth';
import { env } from '@/lib/config';
import { checkDatabase, getPool } from '@/lib/db';
import { hasStudioAccess } from '@/lib/security-rules';
import { getPrivateStorage } from '@/lib/storage';
import { providerAvailability } from '@/lib/generation/provider';
import { visionAvailability } from '@/lib/generation/vision';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  if (!hasStudioAccess(await getCurrentUser())) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  const database = await checkDatabase();
  let storage: 'ready' | 'unavailable' | 'not-configured' = 'not-configured';
  let uploads: { receiving: number; failed: number } | null = null;
  let jobs: { queued: number; running: number; failed: number; blocked: number } | null = null;
  if (database) {
    try { await getPrivateStorage().health(); storage = 'ready'; } catch { storage = 'unavailable'; }
    try {
      const [uploadRows, jobRows] = await Promise.all([
        getPool().query("SELECT count(*) FILTER(WHERE status='receiving')::int AS receiving,count(*) FILTER(WHERE status='failed')::int AS failed FROM product_upload_requests"),
        getPool().query("SELECT count(*) FILTER(WHERE status='queued')::int AS queued,count(*) FILTER(WHERE status='running')::int AS running,count(*) FILTER(WHERE status='failed')::int AS failed,count(*) FILTER(WHERE status='blocked')::int AS blocked FROM generation_jobs"),
      ]);
      uploads = uploadRows.rows[0]; jobs = jobRows.rows[0];
    } catch { /* Older schema; the screen reports migration status without leaking details. */ }
  }
  return NextResponse.json({
    database: database ? 'ready' : 'unavailable',
    storageProvider: env.STORAGE_PROVIDER,
    storage,
    uploads,
    jobs,
    generationProvider: providerAvailability(),
    vision: visionAvailability(),
  }, { headers: { 'Cache-Control': 'private, no-store' }, status: database && storage === 'ready' ? 200 : 503 });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!hasStudioAccess(user)) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  if (!isSameOrigin(request)) return NextResponse.json({ error: 'Request origin could not be verified.' }, { status: 403 });
  return GET();
}
