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
  // Partial update: only the fields actually sent are changed. A metadata edit
  // ("change the colour", "add a tag") must not require resending the whole
  // product, and must not silently blank a field the caller omitted.
  const partial = updateSchema.partial().safeParse(body);
  if (!partial.success) return NextResponse.json({ error: 'Check product details and availability.' }, { status: 400 });
  if (Object.keys(partial.data).length === 0) return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 });
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('alveron-product-inventory'))");
    const current = await client.query<{ name: string; sku: string | null; category: string; color: string | null; fabric: string | null; pattern: string | null; fit: string | null; notes: string | null; tags: string[]; availability: string }>(
      'SELECT name, sku, category, color, fabric, pattern, fit, notes, tags, availability FROM products WHERE id=$1 FOR UPDATE', [id]);
    if (!current.rowCount) { await client.query('ROLLBACK'); return NextResponse.json({ error: 'Product not found.' }, { status: 404 }); }
    const existing = current.rows[0];
    const merged = {
      name: partial.data.name ?? existing.name,
      sku: partial.data.sku ?? existing.sku,
      category: partial.data.category ?? existing.category,
      color: partial.data.color !== undefined ? partial.data.color : existing.color,
      fabric: partial.data.fabric !== undefined ? partial.data.fabric : existing.fabric,
      pattern: partial.data.pattern !== undefined ? partial.data.pattern : existing.pattern,
      fit: partial.data.fit !== undefined ? partial.data.fit : existing.fit,
      notes: partial.data.notes !== undefined ? partial.data.notes : existing.notes,
      tags: partial.data.tags ?? existing.tags,
      availability: partial.data.availability ?? existing.availability,
    };
    await bumpInventoryRevision(client, 'Inventory revision changed after product metadata or availability changed');
    const { name, sku, category, color, fabric, pattern, fit, notes, tags, availability } = merged;
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

/**
 * DELETE /api/products/{id} — permanently remove a product and its images.
 *
 * Requires an owner/editor session and a same-origin request. A read-only
 * library token deliberately cannot reach this route.
 *
 * Rows are deleted in a transaction, then the files. If a file cannot be
 * removed, the response says so per key instead of reporting a clean success —
 * a leftover object is a reclaimable orphan, not a silent lie.
 */
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!hasStudioAccess(user)) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  if (!isSameOrigin(request)) return NextResponse.json({ error: 'Request origin could not be verified.' }, { status: 403 });
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: 'Product not found.' }, { status: 404 });

  const { deleteProducts } = await import('@/lib/product-deletion');
  try {
    const result = await deleteProducts([id]);
    if (!result.deletedProducts.length) return NextResponse.json({ error: 'Product not found.' }, { status: 404 });
    await getPool().query(
      `INSERT INTO audit_events (actor_id, action, entity_type, entity_id, detail) VALUES ($1,'product.deleted','product',$2,$3)`,
      [user!.id, id, JSON.stringify({ objectsRemoved: result.objectsRemoved, objectsFailed: result.objectsFailed.length })],
    ).catch(() => undefined);
    return NextResponse.json({
      deleted: result.deletedProducts,
      objectsRemoved: result.objectsRemoved,
      objectsFailed: result.objectsFailed,
    }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ error: `Delete failed: ${(error as Error).message.slice(0, 200)}` }, { status: 409 });
  }
}
