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
const uuid = z.uuid();
const kinds = z.enum(['thumbnail', 'preview']);

/**
 * Serves an authenticated display derivative.
 *
 * The derivative is verified against its own recorded checksum AND against the
 * checksum of the original it was made from. If either check fails, we answer
 * 409 and the client falls back to the original image route, so a bad
 * derivative can never make a real photograph silently disappear.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string; imageId: string; kind: string }> },
) {
  if (!hasStudioAccess(await getCurrentUser())) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  const { id, imageId, kind } = await context.params;
  if (!uuid.safeParse(id).success || !uuid.safeParse(imageId).success || !kinds.safeParse(kind).success) {
    return NextResponse.json({ error: 'Image derivative not found.' }, { status: 404 });
  }

  let row;
  try {
    const result = await getPool().query(
      `SELECT d.object_key, d.media_type, d.byte_size, d.sha256, d.storage_provider, d.source_sha256, i.sha256 AS original_sha256
         FROM product_image_derivatives d
         JOIN product_images i ON i.id = d.product_image_id
        WHERE d.product_image_id = $1 AND d.kind = $2 AND i.product_id = $3`,
      [imageId, kind, id],
    );
    row = result.rows[0];
  } catch {
    return NextResponse.json({ error: 'Image derivative is unavailable.' }, { status: 503 });
  }
  if (!row) return NextResponse.json({ error: 'Image derivative not found.' }, { status: 404 });

  // A derivative made from a superseded original must not be shown as current.
  if (row.source_sha256 !== row.original_sha256) {
    return NextResponse.json({ error: 'This preview was made from an older version of the image.' }, { status: 409 });
  }

  try {
    const bytes = await getPrivateStorage(row.storage_provider ?? env.STORAGE_PROVIDER).get(row.object_key);
    const checksum = createHash('sha256').update(bytes).digest('hex');
    if (bytes.length !== Number(row.byte_size) || checksum !== row.sha256) {
      return NextResponse.json({ error: 'Image derivative failed its integrity check.' }, { status: 409 });
    }
    return new Response(new Uint8Array(bytes), {
      headers: {
        'Content-Type': row.media_type,
        'Content-Length': String(bytes.length),
        // Private and revalidated: previews are display-only and never cached publicly.
        'Cache-Control': 'private, max-age=300',
        'X-Content-Type-Options': 'nosniff',
        'X-Derivative-SHA256': checksum,
        'X-Source-SHA256': row.source_sha256,
      },
    });
  } catch {
    return NextResponse.json({ error: 'Image derivative is unavailable.' }, { status: 503 });
  }
}
