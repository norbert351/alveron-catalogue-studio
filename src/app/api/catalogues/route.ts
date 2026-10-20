import { NextResponse } from 'next/server';
import { getCurrentUser, isSameOrigin } from '@/lib/auth';
import { getPool } from '@/lib/db';
import { catalogueInputSchema } from '@/lib/catalogue-rules';
import { hasStudioAccess } from '@/lib/security-rules';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  if (!hasStudioAccess(await getCurrentUser())) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  try {
    const result = await getPool().query(`
      SELECT c.id, c.title, c.style, c.occasion, c.mixed_style_requested AS "mixedStyleRequested", c.status, c.created_at,
             count(ci.product_id)::int AS item_count
        FROM catalogues c LEFT JOIN catalogue_items ci ON ci.catalogue_id = c.id
       GROUP BY c.id ORDER BY c.created_at DESC`);
    return NextResponse.json({ catalogues: result.rows }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch {
    return NextResponse.json({ error: 'Catalogue list is unavailable. Check database migrations.' }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!hasStudioAccess(user)) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  if (!isSameOrigin(request)) return NextResponse.json({ error: 'Request origin could not be verified.' }, { status: 403 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 }); }
  const parsed = catalogueInputSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Choose a title, one style, one occasion and at least two distinct products.' }, { status: 400 });

  const pool = getPool();
  const client = await pool.connect();
  const objectPairs = parsed.data.items.map((item) => [item.productId, item.imageId]);
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('alveron-product-inventory'))");
    const pending = await client.query(`SELECT count(*)::int AS count FROM product_images i LEFT JOIN product_image_reviews r ON r.product_image_id = i.id WHERE r.product_image_id IS NULL`);
    if (pending.rows[0].count > 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Review every accessible product image before creating an outfit.' }, { status: 409 });
    }
    for (const [productId, imageId] of objectPairs) {
      const image = await client.query('SELECT 1 FROM product_images WHERE id = $1 AND product_id = $2', [imageId, productId]);
      if (!image.rowCount) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'A selected original image does not belong to its product.' }, { status: 400 });
      }
    }
    const catalogue = await client.query(
      `INSERT INTO catalogues (title, style, occasion, mixed_style_requested, created_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [parsed.data.title, parsed.data.style, parsed.data.occasion, parsed.data.mixedStyleRequested, user.id],
    );
    for (const [position, item] of parsed.data.items.entries()) {
      await client.query(
        `INSERT INTO catalogue_items (catalogue_id, product_id, product_image_id, outfit_role, position)
         VALUES ($1,$2,$3,$4,$5)`,
        [catalogue.rows[0].id, item.productId, item.imageId, item.role, position],
      );
    }
    await client.query('INSERT INTO audit_events (actor_id, action, entity_type, entity_id, detail) VALUES ($1,$2,$3,$4,$5)', [user.id, 'catalogue.draft_created', 'catalogue', catalogue.rows[0].id, JSON.stringify({ style: parsed.data.style, occasion: parsed.data.occasion, productIds: parsed.data.items.map((item) => item.productId) })]);
    await client.query('COMMIT');
    return NextResponse.json({ id: catalogue.rows[0].id }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch {
    await client.query('ROLLBACK').catch(() => undefined);
    return NextResponse.json({ error: 'Outfit draft could not be saved.' }, { status: 503 });
  } finally {
    client.release();
  }
}
