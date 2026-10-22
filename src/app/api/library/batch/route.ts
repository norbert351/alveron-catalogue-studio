import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getPool } from '@/lib/db';
import { authenticateToken } from '@/lib/library-token';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  ids: z.array(z.uuid()).min(1).max(50),
});

/**
 * POST /api/library/batch — resolve several products in one call.
 *
 * A styling request usually names more than one garment ("this shirt with those
 * jeans"). This returns each product exactly as stored, plus an explicit
 * `missing` array for ids that are not in the library, so the caller can say
 * "not in the library" instead of silently dropping or inventing an item.
 *
 * Read-only despite being a POST: POST is used only because the id list is too
 * long for a query string. The token scope is still library:read.
 */
export async function POST(request: Request) {
  const token = await authenticateToken(request);
  if (!token) {
    return NextResponse.json({ error: 'A valid library token is required.' }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Send JSON: {"ids": ["<uuid>", ...]}' }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Send 1 to 50 product ids as UUIDs.', detail: parsed.error.issues.map((issue) => issue.message) }, { status: 400 });
  }

  const ids = [...new Set(parsed.data.ids)];
  const pool = getPool();
  const products = await pool.query<{
    id: string; name: string; sku: string | null; category: string; colour: string | null;
    pattern: string | null; fabric: string | null; notes: string | null; tags: string[]; created_at: Date;
  }>(
    `SELECT id, name, sku, category, color AS colour, pattern, fabric, notes, tags, created_at
       FROM products WHERE id = ANY($1::uuid[])`,
    [ids],
  );

  const images = await pool.query<{
    id: string; product_id: string; original_filename: string; media_type: string;
    byte_size: string; sha256: string; width: number; height: number; view_label: string;
  }>(
    `SELECT id, product_id, original_filename, media_type, byte_size, sha256, width, height, view_label
       FROM product_images WHERE product_id = ANY($1::uuid[]) AND is_current
      ORDER BY created_at ASC, id ASC`,
    [ids],
  );

  const origin = request.headers.get('x-forwarded-proto') && request.headers.get('x-forwarded-host')
    ? `${request.headers.get('x-forwarded-proto')}://${request.headers.get('x-forwarded-host')}`
    : new URL(request.url).origin;

  const found = new Set(products.rows.map((row) => row.id));
  const missing = ids.filter((id) => !found.has(id));

  return NextResponse.json({
    requested: ids.length,
    found: products.rows.length,
    missing,
    products: products.rows.map((row) => ({
      id: row.id,
      name: row.name,
      sku: row.sku,
      category: row.category,
      colour: row.colour,
      pattern: row.pattern,
      fabric: row.fabric,
      notes: row.notes,
      tags: row.tags ?? [],
      uploadedAt: row.created_at,
      images: images.rows
        .filter((image) => image.product_id === row.id)
        .map((image) => ({
          imageId: image.id,
          filename: image.original_filename,
          mediaType: image.media_type,
          byteSize: Number(image.byte_size),
          sha256: image.sha256,
          width: image.width,
          height: image.height,
          viewLabel: image.view_label,
          originalUrl: `${origin}/api/library/products/${row.id}/images/${image.id}/original`,
        })),
    })),
    note: missing.length
      ? `${missing.length} requested id(s) are not in the library. Report them as unavailable; do not substitute generated images.`
      : 'All requested products resolved to real originals.',
  }, { headers: { 'Cache-Control': 'no-store' } });
}
