import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getPool } from '@/lib/db';
import { authenticateToken } from '@/lib/library-token';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/library/products/{productId} — full metadata for one product.
 *
 * Returns every current image with its own originalUrl, so a styling request can
 * distinguish colour variants and multiple views of the same garment. Metadata
 * is returned exactly as stored: optional fields are null when the owner never
 * filled them, never guessed.
 */
export async function GET(request: Request, context: { params: Promise<{ productId: string }> }) {
  const token = await authenticateToken(request);
  if (!token) {
    return NextResponse.json({ error: 'A valid library token is required.' }, { status: 401 });
  }
  const { productId } = await context.params;
  if (!z.uuid().safeParse(productId).success) {
    return NextResponse.json({ error: 'That is not a valid product id.' }, { status: 400 });
  }

  const pool = getPool();
  const product = await pool.query<{
    id: string; name: string; sku: string | null; category: string; colour: string | null;
    pattern: string | null; fabric: string | null; fit: string | null; notes: string | null;
    tags: string[]; availability: string; created_at: Date; updated_at: Date;
  }>(
    `SELECT id, name, sku, category, color AS colour, pattern, fabric, fit, notes, tags,
            availability, created_at, updated_at
       FROM products WHERE id = $1`,
    [productId],
  );
  const row = product.rows[0];
  if (!row) {
    // Explicit 404 so the calling model reports "not in library" instead of guessing.
    return NextResponse.json({ error: 'No product with that id exists in the library.' }, { status: 404 });
  }

  const images = await pool.query<{
    id: string; original_filename: string; media_type: string; byte_size: string; sha256: string;
    width: number; height: number; view_label: string; is_current: boolean; created_at: Date;
  }>(
    `SELECT id, original_filename, media_type, byte_size, sha256, width, height,
            view_label, is_current, created_at
       FROM product_images WHERE product_id = $1
      ORDER BY is_current DESC, created_at ASC, id ASC`,
    [productId],
  );

  const origin = request.headers.get('x-forwarded-proto') && request.headers.get('x-forwarded-host')
    ? `${request.headers.get('x-forwarded-proto')}://${request.headers.get('x-forwarded-host')}`
    : new URL(request.url).origin;

  return NextResponse.json({
    id: row.id,
    name: row.name,
    sku: row.sku,
    category: row.category,
    colour: row.colour,
    pattern: row.pattern,
    fabric: row.fabric,
    fit: row.fit,
    notes: row.notes,
    tags: row.tags ?? [],
    availability: row.availability,
    uploadedAt: row.created_at,
    updatedAt: row.updated_at,
    images: images.rows.map((image) => ({
      imageId: image.id,
      filename: image.original_filename,
      mediaType: image.media_type,
      byteSize: Number(image.byte_size),
      sha256: image.sha256,
      width: image.width,
      height: image.height,
      viewLabel: image.view_label,
      isCurrent: image.is_current,
      uploadedAt: image.created_at,
      originalUrl: `${origin}/api/library/products/${row.id}/images/${image.id}/original`,
    })),
  }, { headers: { 'Cache-Control': 'no-store' } });
}
