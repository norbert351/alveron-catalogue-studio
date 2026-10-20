import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser, isSameOrigin } from '@/lib/auth';
import { getPool } from '@/lib/db';
import { hasStudioAccess } from '@/lib/security-rules';
import { productInputSchema } from '@/lib/product-rules';
import { bumpInventoryRevision } from '@/lib/inventory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const updateSchema = productInputSchema.extend({
  availability: z.enum(['active', 'unavailable', 'archived']),
});

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!hasStudioAccess(user)) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  if (!isSameOrigin(request)) return NextResponse.json({ error: 'Request origin could not be verified.' }, { status: 403 });
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: 'Product not found.' }, { status: 404 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid product update.' }, { status: 400 }); }
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Check product details and availability.' }, { status: 400 });
  const { name, sku, category, color, fabric, pattern, fit, notes, tags, availability } = parsed.data;
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('alveron-product-inventory'))");
    await bumpInventoryRevision(client, 'Inventory revision changed after product metadata or availability changed');
    const result = await client.query(`UPDATE products SET name=$2, sku=$3, category=$4, color=$5, fabric=$6,
      pattern=$7, fit=$8, notes=$9, tags=$10, availability=$11,owner_attributes=$12,
      archived_at=CASE WHEN $11='archived' THEN COALESCE(archived_at,now()) ELSE NULL END, updated_at=now()
      WHERE id=$1 RETURNING id`, [id, name, sku, category, color, fabric, pattern, fit, notes, tags, availability, JSON.stringify({ color, fabric, pattern, fit, tags })]);
    if (!result.rowCount) { await client.query('ROLLBACK'); return NextResponse.json({ error: 'Product not found.' }, { status: 404 }); }
    await client.query(`INSERT INTO audit_events (actor_id, action, entity_type, entity_id, detail)
      VALUES ($1,$2,'product',$3,$4)`, [user.id, availability === 'archived' ? 'product.archived' : 'product.updated', id, JSON.stringify({ availability })]);
    await client.query('COMMIT');
    return NextResponse.json({ saved: true });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    const message = error instanceof Error && error.message.includes('duplicate key') ? 'That SKU is already in the library.' : 'Product update could not be saved.';
    return NextResponse.json({ error: message }, { status: 409 });
  } finally { client.release(); }
}
