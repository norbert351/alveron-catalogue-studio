import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { authenticateToken } from '@/lib/library-token';
import { signedOriginalUrl as signOriginalUrl } from '@/lib/library-signing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/library/search — read-only catalogue search for external retrieval.
 *
 * Auth: `Authorization: Bearer alv_lib_...` (scope library:read). A browser
 * session cookie is NOT accepted here; this route exists for machines.
 *
 * Query params:
 *   q          free text over name, sku, original filename, notes, tags
 *   category   exact category (t-shirt, shirt, jeans, ...)
 *   colour     substring match on colour
 *   tag        one tag, repeatable
 *   ids        one or more product UUIDs, repeatable or comma-separated
 *   limit      1..100 (default 24)
 *   offset     default 0
 *
 * Returns metadata plus a per-product `originalUrl` the caller can GET to fetch
 * the real original bytes. It never returns generated or derivative images as
 * originals, and it never invents a product that is not in the library.
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
  const q = url.searchParams.get('q')?.trim() || null;
  const category = url.searchParams.get('category')?.trim() || null;
  const colour = url.searchParams.get('colour')?.trim() || null;
  const tags = url.searchParams.getAll('tag').map((tag) => tag.trim()).filter(Boolean);
  const rawIds = [
    ...url.searchParams.getAll('ids').flatMap((value) => value.split(',')),
    ...url.searchParams.getAll('id'),
  ].map((value) => value.trim()).filter(Boolean);

  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const invalidIds = rawIds.filter((id) => !UUID.test(id));
  if (invalidIds.length) {
    return NextResponse.json({ error: `Not a valid product id: ${invalidIds.join(', ')}` }, { status: 400 });
  }

  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 24) || 24, 1), 100);
  const offset = Math.max(Number(url.searchParams.get('offset') ?? 0) || 0, 0);

  // Build the filter with positional params so nothing is concatenated into SQL.
  const where: string[] = ["p.availability <> 'archived'"];
  const params: unknown[] = [];
  const add = (value: unknown): string => `$${params.push(value)}`;

  if (rawIds.length) where.push(`p.id = ANY(${add(rawIds)}::uuid[])`);
  if (category) where.push(`p.category = ${add(category)}`);
  if (colour) where.push(`p.color ILIKE ${add(`%${colour}%`)}`);
  if (tags.length) where.push(`p.tags && ${add(tags)}::text[]`);
  if (q) {
    const like = `%${q}%`;
    // Search covers the fields the brief names: name, filename, product id, tags.
    where.push(`(
      p.name ILIKE ${add(like)}
      OR COALESCE(p.sku,'') ILIKE ${add(like)}
      OR COALESCE(p.notes,'') ILIKE ${add(like)}
      OR COALESCE(p.color,'') ILIKE ${add(like)}
      OR p.id::text ILIKE ${add(like)}
      OR EXISTS (SELECT 1 FROM unnest(p.tags) AS tag WHERE tag ILIKE ${add(like)})
      OR EXISTS (
        SELECT 1 FROM product_images pi
         WHERE pi.product_id = p.id
           AND (pi.original_filename ILIKE ${add(like)} OR pi.colour_design_label ILIKE ${add(like)})
      )
    )`);
  }

  const pool = getPool();
  const clause = where.join(' AND ');

  const total = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM products p WHERE ${clause}`, params,
  );

  const rows = await pool.query<{
    id: string; name: string; sku: string | null; category: string; colour: string | null;
    pattern: string | null; fabric: string | null; fit: string | null; notes: string | null;
    tags: string[]; created_at: Date; image_id: string | null; original_filename: string | null;
    media_type: string | null; byte_size: string | null; sha256: string | null;
    width: number | null; height: number | null; view_label: string | null; image_count: string;
  }>(
    `SELECT p.id, p.name, p.sku, p.category, p.color AS colour, p.pattern, p.fabric, p.fit, p.notes,
            p.tags, p.created_at,
            i.id AS image_id, i.original_filename, i.media_type, i.byte_size, i.sha256,
            i.width, i.height, i.view_label,
            (SELECT count(*)::text FROM product_images c WHERE c.product_id = p.id AND c.is_current) AS image_count
       FROM products p
       LEFT JOIN LATERAL (
         SELECT * FROM product_images pi
          WHERE pi.product_id = p.id AND pi.is_current
          ORDER BY pi.created_at ASC, pi.id ASC
          LIMIT 1
       ) i ON TRUE
      WHERE ${clause}
      ORDER BY p.created_at DESC, p.id DESC
      LIMIT ${add(limit)} OFFSET ${add(offset)}`,
    params,
  );

  const origin = request.headers.get('x-forwarded-proto') && request.headers.get('x-forwarded-host')
    ? `${request.headers.get('x-forwarded-proto')}://${request.headers.get('x-forwarded-host')}`
    : new URL(request.url).origin;

  return NextResponse.json({
    scope: token.scope,
    returned: rows.rows.length,
    total: Number(total.rows[0]?.count ?? 0),
    limit,
    offset,
    hasMore: offset + rows.rows.length < Number(total.rows[0]?.count ?? 0),
    products: rows.rows.map((row) => {
      const signed = row.image_id ? signOriginalUrl(origin, row.id, row.image_id) : null;
      return {
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
        uploadedAt: row.created_at,
        imageCount: Number(row.image_count),
        // The first current image, with the stable id needed to fetch its bytes.
        primaryImage: row.image_id ? {
          imageId: row.image_id,
          filename: row.original_filename,
          mediaType: row.media_type,
          byteSize: Number(row.byte_size),
          sha256: row.sha256,
          width: row.width,
          height: row.height,
          viewLabel: row.view_label,
          originalUrl: `${origin}/api/library/products/${row.id}/images/${row.image_id}/original`,
          ...(signed ? { signedOriginalUrl: signed } : {}),
          metadataUrl: `${origin}/api/library/products/${row.id}`,
        } : null,
      };
    }),
    // Explicit so a calling model does not treat an empty result as "no products
    // exist anywhere" or invent one to fill the gap.
    note: rows.rows.length === 0
      ? 'No products matched. The library has no record of this item; do not invent one.'
      : 'originalUrl returns the exact uploaded bytes. Never substitute a generated or derivative image.',
  }, { headers: { 'Cache-Control': 'no-store' } });
}
