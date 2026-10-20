import { NextResponse } from 'next/server';
import { getCurrentUser, isSameOrigin } from '@/lib/auth';
import { getPool } from '@/lib/db';
import { getPrivateStorage } from '@/lib/storage';
import { hasStudioAccess } from '@/lib/security-rules';
import { z } from 'zod';
import { env } from '@/lib/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const uuid = z.uuid();

type ImageRouteContext = { params: Promise<{ id: string; imageId: string }> };

export async function GET(_request: Request, context: ImageRouteContext) {
  if (!hasStudioAccess(await getCurrentUser())) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  const { id, imageId } = await context.params;
  if (!uuid.safeParse(id).success || !uuid.safeParse(imageId).success) return NextResponse.json({ error: 'Image not found.' }, { status: 404 });
  const result = await getPool().query('SELECT object_key, storage_provider, media_type, byte_size, sha256 FROM product_images WHERE id = $1 AND product_id = $2', [imageId, id]);
  const image = result.rows[0];
  if (!image) return NextResponse.json({ error: 'Image not found.' }, { status: 404 });
  try {
    const bytes = await getPrivateStorage(image.storage_provider ?? env.STORAGE_PROVIDER).get(image.object_key);
    const checksum = createHash('sha256').update(bytes).digest('hex');
    if (bytes.length !== Number(image.byte_size) || checksum !== image.sha256) return NextResponse.json({ error: 'Original image failed its integrity check. Contact the studio owner before using this file.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
    return new Response(new Uint8Array(bytes), { headers: { 'Content-Type': image.media_type, 'Content-Length': String(bytes.length), 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'X-Original-SHA256': checksum } });
  } catch {
    return NextResponse.json({ error: 'Original image is unavailable.' }, { status: 503 });
  }
}

export async function POST(request: Request, context: ImageRouteContext) {
  const user = await getCurrentUser();
  if (!hasStudioAccess(user)) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  if (!isSameOrigin(request)) return NextResponse.json({ error: 'Request origin could not be verified.' }, { status: 403 });
  const { id, imageId } = await context.params;
  if (!uuid.safeParse(id).success || !uuid.safeParse(imageId).success) return NextResponse.json({ error: 'Image not found.' }, { status: 404 });
  try {
    const result = await getPool().query(
      `INSERT INTO product_image_reviews (product_image_id, reviewed_by)
       SELECT id, $3 FROM product_images WHERE id = $1 AND product_id = $2
       ON CONFLICT (product_image_id) DO UPDATE SET reviewed_by = EXCLUDED.reviewed_by, reviewed_at = now()
       RETURNING product_image_id`,
      [imageId, id, user.id],
    );
    if (!result.rowCount) return NextResponse.json({ error: 'Image not found.' }, { status: 404 });
    await getPool().query('INSERT INTO audit_events (actor_id, action, entity_type, entity_id) VALUES ($1,$2,$3,$4)', [user.id, 'product_image.reviewed', 'product_image', imageId]);
    return NextResponse.json({ reviewed: true });
  } catch {
    return NextResponse.json({ error: 'Image review could not be saved.' }, { status: 503 });
  }
}
import { createHash } from 'node:crypto';
