import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getPool } from '@/lib/db';
import { authenticateToken } from '@/lib/library-token';
import { signedOriginalUrl } from '@/lib/library-signing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function publicOrigin(request: Request): string {
  const proto = request.headers.get('x-forwarded-proto');
  const host = request.headers.get('x-forwarded-host');
  return proto && host ? `${proto}://${host}` : new URL(request.url).origin;
}

/**
 * GET /api/library/images — every original product image in the library.
 *
 * Auth: `Authorization: Bearer alv_lib_...` (scope library:read). A browser
 * session is not accepted here.
 *
 * Query params:
 *   limit      1..100 (default 100)
 *   offset     default 0
 *   productId  optional UUID; list only that product's images
 *
 * Each item contains only the product id, image id and a short-lived signed
 * URL to the exact uploaded original. No names, categories or generated
 * metadata are returned, and this route is read-only.
 */
export async function GET(request: Request) {
  const token = await authenticateToken(request);
  if (!token) {
    return NextResponse.json(
      { error: 'A valid library token is required. Send Authorization: Bearer alv_lib_<token>.' },
      { status: 401, headers: { 'WWW-Authenticate': 'Bearer realm="alveron-library"' } },
    );
  }

  const url = new URL(request.url);
  const productId = url.searchParams.get('productId')?.trim() || null;
  if (productId && !z.uuid().safeParse(productId).success) {
    return NextResponse.json({ error: 'That is not a valid product id.' }, { status: 400 });
  }

  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 100) || 100, 1), 100);
  const offset = Math.max(Number(url.searchParams.get('offset') ?? 0) || 0, 0);

  const where: string[] = [];
  const params: unknown[] = [];
  const add = (value: unknown): string => `$${params.push(value)}`;
  if (productId) where.push(`i.product_id = ${add(productId)}`);
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const pool = getPool();
  const total = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM product_images i ${clause}`,
    params,
  );

  const rows = await pool.query<{ product_id: string; image_id: string }>(
    `SELECT i.product_id, i.id AS image_id
       FROM product_images i
       ${clause}
      ORDER BY i.product_id, i.created_at ASC, i.id ASC
      LIMIT ${add(limit)} OFFSET ${add(offset)}`,
    params,
  );

  const origin = publicOrigin(request);
  const totalCount = Number(total.rows[0]?.count ?? 0);

  return NextResponse.json({
    items: rows.rows.map((row) => ({
      productId: row.product_id,
      imageId: row.image_id,
      originalUrl: signedOriginalUrl(origin, row.product_id, row.image_id)
        ?? `${origin}/api/library/products/${row.product_id}/images/${row.image_id}/original`,
    })),
    returned: rows.rows.length,
    total: totalCount,
    limit,
    offset,
    hasMore: offset + rows.rows.length < totalCount,
    nextOffset: offset + rows.rows.length < totalCount ? offset + rows.rows.length : null,
  }, { headers: { 'Cache-Control': 'no-store' } });
}
