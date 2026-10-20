import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/auth';
import { env } from '@/lib/config';
import { getPool } from '@/lib/db';
import { hasStudioAccess } from '@/lib/security-rules';
import { getPrivateStorage } from '@/lib/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, context: { params: Promise<{ id: string; assetId: string }> }) {
  if (!hasStudioAccess(await getCurrentUser())) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  const { id, assetId } = await context.params;
  if (!z.uuid().safeParse(id).success || !z.uuid().safeParse(assetId).success) return NextResponse.json({ error: 'Catalogue output not found.' }, { status: 404 });
  const result = await getPool().query(`SELECT object_key,storage_provider,media_type,byte_size,sha256 FROM generated_assets WHERE catalogue_id=$1 AND id=$2`, [id, assetId]);
  if (!result.rowCount) return NextResponse.json({ error: 'Catalogue output not found.' }, { status: 404 });
  try {
    const row = result.rows[0];
    const bytes = await getPrivateStorage(row.storage_provider ?? env.STORAGE_PROVIDER).get(row.object_key);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (bytes.length !== Number(row.byte_size) || sha256 !== row.sha256) return NextResponse.json({ error: 'Catalogue output failed its checksum check.' }, { status: 503 });
    return new Response(new Uint8Array(bytes), { headers: { 'Content-Type': row.media_type, 'Content-Length': String(bytes.length), 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'X-Output-SHA256': sha256 } });
  } catch { return NextResponse.json({ error: 'Catalogue output is unavailable. Check private storage health.' }, { status: 503 }); }
}
