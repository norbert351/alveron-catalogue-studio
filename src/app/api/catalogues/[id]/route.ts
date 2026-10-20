import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser, isSameOrigin } from '@/lib/auth';
import { catalogueInputSchema } from '@/lib/catalogue-rules';
import { getPool } from '@/lib/db';
import { hasStudioAccess } from '@/lib/security-rules';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!hasStudioAccess(user)) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  if (!isSameOrigin(request)) return NextResponse.json({ error: 'Request origin could not be verified.' }, { status: 403 });
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: 'Draft not found.' }, { status: 404 });
  let raw: unknown;
  try { raw = await request.json(); } catch { return NextResponse.json({ error: 'Invalid outfit draft.' }, { status: 400 }); }
  const parsed = catalogueInputSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: 'Choose one style, one occasion and valid exact product-image pairs.' }, { status: 400 });
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('alveron-product-inventory'))");
    const catalogue = await client.query('SELECT revision,status FROM catalogues WHERE id=$1 FOR UPDATE', [id]);
    if (!catalogue.rowCount) { await client.query('ROLLBACK'); return NextResponse.json({ error: 'Draft not found.' }, { status: 404 }); }
    if (!['draft','rejected','failed'].includes(catalogue.rows[0].status)) { await client.query('ROLLBACK'); return NextResponse.json({ error: 'Only a draft can be changed. Request corrections from review first.' }, { status: 409 }); }
    const inventory = await client.query('SELECT revision FROM studio_inventory_state WHERE id=1');
    const pending = await client.query('SELECT EXISTS(SELECT 1 FROM product_images i LEFT JOIN product_image_reviews r ON r.product_image_id=i.id WHERE r.product_image_id IS NULL) AS pending');
    if (pending.rows[0].pending) { await client.query('ROLLBACK'); return NextResponse.json({ error: 'Review every accessible inventory image before saving this outfit.' }, { status: 409 }); }
    for (const item of parsed.data.items) {
      const valid = await client.query(`SELECT 1 FROM products p JOIN product_images i ON i.product_id=p.id
        JOIN product_image_reviews r ON r.product_image_id=i.id WHERE p.id=$1 AND i.id=$2 AND p.availability='active' AND i.is_current=true`, [item.productId, item.imageId]);
      if (!valid.rowCount) { await client.query('ROLLBACK'); return NextResponse.json({ error: 'A selected product is unavailable or its exact image view is no longer current and reviewed.' }, { status: 409 }); }
    }
    const nextRevision = Number(catalogue.rows[0].revision) + 1;
    await client.query(`UPDATE catalogues SET title=$2,style=$3,occasion=$4,mixed_style_requested=$5,status='draft',revision=$6,rejection_reason=NULL,
      source_snapshot=$7,updated_at=now() WHERE id=$1`, [id, parsed.data.title, parsed.data.style, parsed.data.occasion, parsed.data.mixedStyleRequested, nextRevision,
      JSON.stringify({ inventoryRevision: Number(inventory.rows[0].revision), items: parsed.data.items, style: parsed.data.style, occasion: parsed.data.occasion })]);
    await client.query('DELETE FROM catalogue_items WHERE catalogue_id=$1', [id]);
    for (const [position, item] of parsed.data.items.entries()) await client.query('INSERT INTO catalogue_items(catalogue_id,product_id,product_image_id,outfit_role,position) VALUES($1,$2,$3,$4,$5)', [id, item.productId, item.imageId, item.role, position]);
    await client.query(`UPDATE catalogue_approvals SET invalidated_at=now(),invalidation_reason='Outfit source selection changed' WHERE catalogue_id=$1 AND invalidated_at IS NULL`, [id]);
    await client.query('INSERT INTO audit_events(actor_id,action,entity_type,entity_id,detail) VALUES($1,$2,$3,$4,$5)', [user.id, 'catalogue.draft_updated', 'catalogue', id, JSON.stringify({ revision: nextRevision, style: parsed.data.style, occasion: parsed.data.occasion, productIds: parsed.data.items.map((item) => item.productId) })]);
    await client.query('COMMIT');
    return NextResponse.json({ id, revision: nextRevision });
  } catch {
    await client.query('ROLLBACK').catch(() => undefined);
    return NextResponse.json({ error: 'Outfit draft could not be updated.' }, { status: 503 });
  } finally { client.release(); }
}
