import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getPool } from '@/lib/db';
import { authenticateToken, bearerFrom } from '@/lib/library-token';
import { verifyOriginalSignature } from '@/lib/library-signing';
import { env } from '@/lib/config';
import { getPrivateStorage } from '@/lib/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/library/products/{productId}/images/{imageId}/original
 *
 * Returns the EXACT original bytes that were uploaded, never a thumbnail,
 * preview, edited copy or generated image. Those live under a different storage
 * prefix (`derivatives/...`) and are not reachable from this route at all.
 *
 * Integrity: the bytes are re-hashed on every read and compared to the sha256
 * stored at upload time. A mismatch returns 503 instead of serving bytes we
 * cannot vouch for, because handing over a corrupted original would silently
 * poison any styling decision made from it.
 */
export async function GET(request: Request, context: { params: Promise<{ productId: string; imageId: string }> }) {
  const { productId, imageId } = await context.params;
  if (!z.uuid().safeParse(productId).success || !z.uuid().safeParse(imageId).success) {
    return NextResponse.json({ error: 'That is not a valid product or image id.' }, { status: 400 });
  }

  // Accept EITHER a bearer token (machine clients) OR a valid short-lived
  // signature (browser clicks, image fetchers). A signature is only consulted
  // when no Authorization header was sent, so a bad token never silently
  // downgrades to link auth.
  const hasBearer = bearerFrom(request) !== null;
  const token = hasBearer ? await authenticateToken(request) : null;
  let authorized = token !== null;
  if (!authorized && !hasBearer) {
    const verdict = verifyOriginalSignature({
      productId,
      imageId,
      exp: new URL(request.url).searchParams.get('exp'),
      sig: new URL(request.url).searchParams.get('sig'),
    });
    if (verdict === 'valid') {
      authorized = true;
    } else if (verdict !== 'missing') {
      return NextResponse.json(
        { error: verdict === 'expired' ? 'This image link has expired.' : 'This image link is invalid.' },
        { status: 403, headers: { 'Cache-Control': 'no-store' } },
      );
    }
  }
  if (!authorized) {
    return NextResponse.json(
      { error: 'A valid library token is required.' },
      { status: 401, headers: { 'WWW-Authenticate': 'Bearer realm="alveron-library"' } },
    );
  }

  const result = await getPool().query<{
    object_key: string; storage_provider: string | null; media_type: string;
    byte_size: string; sha256: string; original_filename: string;
  }>(
    `SELECT object_key, storage_provider, media_type, byte_size, sha256, original_filename
       FROM product_images WHERE id = $1 AND product_id = $2`,
    [imageId, productId],
  );
  const row = result.rows[0];
  if (!row) {
    return NextResponse.json({ error: 'No such image in the library.' }, { status: 404 });
  }

  try {
    const bytes = await getPrivateStorage((row.storage_provider ?? env.STORAGE_PROVIDER) as 'local' | 's3').get(row.object_key);

    // Verify before serving: size first (cheap), then the checksum.
    if (bytes.length !== Number(row.byte_size)) {
      return NextResponse.json({ error: 'Stored original does not match its recorded size. Refusing to serve it.' }, { status: 503 });
    }
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (digest !== row.sha256) {
      return NextResponse.json({ error: 'Stored original failed its checksum. Refusing to serve it.' }, { status: 503 });
    }

    // Content-Disposition: a filename the caller can trust, and `inline` so an
    // image-consuming client can render it directly.
    const safeName = row.original_filename.replaceAll('"', '').replaceAll('\n', ' ').slice(0, 180);
    return new Response(new Uint8Array(bytes), {
      headers: {
        'Content-Type': row.media_type,
        'Content-Length': String(bytes.length),
        'Content-Disposition': `inline; filename="${safeName}"`,
        // Short-lived cache: the original is immutable for a given image id.
        'Cache-Control': 'private, max-age=300',
        'X-Content-Type-Options': 'nosniff',
        'X-Original-SHA256': digest,
      },
    });
  } catch {
    return NextResponse.json({ error: 'The original file is unavailable in storage.' }, { status: 503 });
  }
}
