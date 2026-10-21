import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser, isSameOrigin } from '@/lib/auth';
import { env } from '@/lib/config';
import { getPool } from '@/lib/db';
import { hasStudioAccess } from '@/lib/security-rules';
import { getPrivateStorage } from '@/lib/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const bodySchema = z.discriminatedUnion('decision', [
  z.object({ decision: z.literal('approve'), assetId: z.uuid() }),
  z.object({ decision: z.literal('reject'), assetId: z.uuid(), reason: z.string().trim().min(3).max(2000) }),
  z.object({ decision: z.literal('correction'), reason: z.string().trim().min(3).max(2000) }),
]);

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!hasStudioAccess(user)) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  if (!isSameOrigin(request)) return NextResponse.json({ error: 'Request origin could not be verified.' }, { status: 403 });
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: 'Catalogue not found.' }, { status: 404 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid review decision.' }, { status: 400 }); }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Choose an output and a valid review decision.' }, { status: 400 });
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const catalogue = await client.query('SELECT status,revision FROM catalogues WHERE id=$1 FOR UPDATE', [id]);
    if (!catalogue.rowCount) { await client.query('ROLLBACK'); return NextResponse.json({ error: 'Catalogue not found.' }, { status: 404 }); }
    const decision = parsed.data;
    if (decision.decision === 'correction') {
      await client.query(`UPDATE catalogue_approvals SET invalidated_at=now(),invalidation_reason='Corrections requested'
        WHERE catalogue_id=$1 AND invalidated_at IS NULL`, [id]);
      await client.query('UPDATE catalogues SET status=$2,rejection_reason=$3,revision=revision+1,updated_at=now() WHERE id=$1', [id, 'draft', decision.reason]);
      await client.query('INSERT INTO audit_events(actor_id,action,entity_type,entity_id,detail) VALUES($1,$2,$3,$4,$5)', [user.id, 'catalogue.correction_requested', 'catalogue', id, JSON.stringify({ reason: decision.reason })]);
      await client.query('COMMIT');
      return NextResponse.json({ status: 'draft', correctionRequested: true });
    }
    const asset = await client.query(`SELECT id,object_key,storage_provider,media_type,byte_size,sha256,input_snapshot,output_kind
      FROM generated_assets WHERE catalogue_id=$1 AND id=$2 FOR UPDATE`, [id, decision.assetId]);
    if (!asset.rowCount) { await client.query('ROLLBACK'); return NextResponse.json({ error: 'That output does not belong to this catalogue.' }, { status: 404 }); }
    const row = asset.rows[0];
    const bytes = await getPrivateStorage(row.storage_provider ?? env.STORAGE_PROVIDER).get(row.object_key);
    const actualSha = createHash('sha256').update(bytes).digest('hex');
    if (bytes.length !== Number(row.byte_size) || actualSha !== row.sha256) { await client.query('ROLLBACK'); return NextResponse.json({ error: 'Output integrity check failed; approval is blocked.' }, { status: 409 }); }
    const snapshot = row.input_snapshot as { revision?: number; inventoryRevision?: number; items?: Array<{ productId: string; imageId: string; sha256: string; role: string }> };
    const inventory = await client.query('SELECT revision FROM studio_inventory_state WHERE id=1');
    const current = await client.query(`SELECT p.availability,i.id AS image_id,i.sha256,i.is_current,ci.outfit_role AS role,
      (r.product_image_id IS NOT NULL) AS reviewed
      FROM catalogue_items ci JOIN products p ON p.id=ci.product_id JOIN product_images i ON i.id=ci.product_image_id
      LEFT JOIN product_image_reviews r ON r.product_image_id=i.id WHERE ci.catalogue_id=$1 ORDER BY ci.position`, [id]);
    const inputsMatch = snapshot?.revision === Number(catalogue.rows[0].revision) && snapshot.inventoryRevision === Number(inventory.rows[0]?.revision) && snapshot.items?.length === current.rows.length && snapshot.items.every((source, index) => source.imageId === current.rows[index].image_id && source.sha256 === current.rows[index].sha256 && source.role === current.rows[index].role && current.rows[index].availability === 'active' && current.rows[index].reviewed);
    if (!inputsMatch) { await client.query('ROLLBACK'); return NextResponse.json({ error: 'The selected source snapshot is stale. Reopen and compose a new version before review.' }, { status: 409 }); }
    if (decision.decision === 'approve') {
      if (catalogue.rows[0].status !== 'review') { await client.query('ROLLBACK'); return NextResponse.json({ error: 'Only an output in Catalogue Review can be approved.' }, { status: 409 }); }
      await client.query(`UPDATE catalogue_approvals SET invalidated_at=now(),invalidation_reason='A newer output was approved'
        WHERE catalogue_id=$1 AND invalidated_at IS NULL`, [id]);
      const approval = await client.query(`INSERT INTO catalogue_approvals (catalogue_id,generated_asset_id,approved_by,approved_revision,output_sha256)
        VALUES ($1,$2,$3,$4,$5) RETURNING id`, [id, decision.assetId, user.id, catalogue.rows[0].revision, row.sha256]);
      await client.query("UPDATE catalogues SET status='approved',rejection_reason=NULL,updated_at=now() WHERE id=$1", [id]);
      await client.query('INSERT INTO audit_events(actor_id,action,entity_type,entity_id,detail) VALUES($1,$2,$3,$4,$5)', [user.id, 'catalogue.output_approved', 'catalogue', id, JSON.stringify({ assetId: decision.assetId, sha256: row.sha256, approvalId: approval.rows[0].id })]);
      await client.query('COMMIT');
      return NextResponse.json({ status: 'approved', approvalId: approval.rows[0].id, assetId: decision.assetId, sha256: row.sha256 });
    }
    if (catalogue.rows[0].status !== 'review') { await client.query('ROLLBACK'); return NextResponse.json({ error: 'Only an output in Catalogue Review can be rejected.' }, { status: 409 }); }
    await client.query(`INSERT INTO catalogue_rejections(catalogue_id,generated_asset_id,rejected_by,reason) VALUES($1,$2,$3,$4)`, [id, decision.assetId, user.id, decision.reason]);
    await client.query(`UPDATE catalogue_approvals SET invalidated_at=now(),invalidation_reason='Output rejected'
      WHERE catalogue_id=$1 AND invalidated_at IS NULL`, [id]);
    await client.query("UPDATE catalogues SET status='rejected',rejection_reason=$2,updated_at=now() WHERE id=$1", [id, decision.reason]);
    await client.query('INSERT INTO audit_events(actor_id,action,entity_type,entity_id,detail) VALUES($1,$2,$3,$4,$5)', [user.id, 'catalogue.output_rejected', 'catalogue', id, JSON.stringify({ assetId: decision.assetId, reason: decision.reason })]);
    await client.query('COMMIT');
    return NextResponse.json({ status: 'rejected' });
  } catch {
    await client.query('ROLLBACK').catch(() => undefined);
    return NextResponse.json({ error: 'Review decision could not be saved. Recheck the draft and output before trying again.' }, { status: 503 });
  } finally { client.release(); }
}
