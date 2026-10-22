import { NextResponse } from 'next/server';
import { getCurrentUser, isSameOrigin } from '@/lib/auth';
import { env } from '@/lib/config';
import { checkDatabase, getPool } from '@/lib/db';
import { hasStudioAccess } from '@/lib/security-rules';
import { getPrivateStorage } from '@/lib/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Library health and capacity. Owner-only (session), never bearer-authenticated.
 *
 * Reports two things the brief asks for:
 *  - storage health (can we read/write the backend);
 *  - capacity, so the owner can see how much room is left before they hit a
 *    limit. Disk usage is read from the actual storage volume when the backend is
 *    local; for S3 only the object total is known, and it says so rather than
 *    inventing a quota.
 */
export async function GET() {
  if (!hasStudioAccess(await getCurrentUser())) {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  const database = await checkDatabase();
  let storage: 'ready' | 'unavailable' = 'unavailable';
  let library = { products: 0, images: 0, originalBytes: 0, derivativeBytes: 0, pendingUploads: 0, failedUploads: 0 };
  let disk: { totalBytes: number; freeBytes: number } | null = null;

  if (database) {
    try { await getPrivateStorage().health(); storage = 'ready'; } catch { storage = 'unavailable'; }
    try {
      const [counts, uploads] = await Promise.all([
        getPool().query(`
          SELECT
            (SELECT count(*) FROM products WHERE availability <> 'archived')::int AS products,
            (SELECT count(*) FROM product_images)::int AS images,
            (SELECT COALESCE(sum(byte_size),0) FROM product_images)::bigint AS original_bytes,
            (SELECT COALESCE(sum(byte_size),0) FROM product_image_derivatives)::bigint AS derivative_bytes`),
        getPool().query(`
          SELECT count(*) FILTER (WHERE status='receiving')::int AS pending,
                 count(*) FILTER (WHERE status='failed')::int AS failed
            FROM product_upload_requests`),
      ]);
      const row = counts.rows[0] ?? {};
      library = {
        products: Number(row.products ?? 0),
        images: Number(row.images ?? 0),
        originalBytes: Number(row.original_bytes ?? 0),
        derivativeBytes: Number(row.derivative_bytes ?? 0),
        pendingUploads: Number(uploads.rows[0]?.pending ?? 0),
        failedUploads: Number(uploads.rows[0]?.failed ?? 0),
      };
    } catch { /* older schema: report what we can without leaking details */ }
  }

  if (storage === 'ready' && env.STORAGE_PROVIDER === 'local') {
    try {
      const { statfs } = await import('node:fs/promises');
      const stats = await statfs(process.env.ALVERON_PROJECT_ROOT ? process.cwd() : process.cwd());
      disk = { totalBytes: Number(stats.blocks) * Number(stats.bsize), freeBytes: Number(stats.bavail) * Number(stats.bsize) };
    } catch { disk = null; }
  }

  return NextResponse.json({
    database: database ? 'ready' : 'unavailable',
    storageProvider: env.STORAGE_PROVIDER,
    storage,
    library,
    disk,
    limits: {
      perFileBytes: 15 * 1024 * 1024,
      acceptedTypes: ['image/jpeg', 'image/png', 'image/webp'],
      // No product-count cap by design; capacity is bounded by the storage volume.
      maxProducts: null,
    },
  }, { headers: { 'Cache-Control': 'private, no-store' }, status: database && storage === 'ready' ? 200 : 503 });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!hasStudioAccess(user)) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  if (!isSameOrigin(request)) return NextResponse.json({ error: 'Request origin could not be verified.' }, { status: 403 });
  return GET();
}
