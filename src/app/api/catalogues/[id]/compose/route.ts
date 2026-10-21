import { createHash, randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser, isSameOrigin } from '@/lib/auth';
import { getPool } from '@/lib/db';
import { renderOriginalPhotoCatalogue } from '@/lib/catalogue-renderer';
import { hasStudioAccess } from '@/lib/security-rules';
import { env } from '@/lib/config';
import { configuredStorageProvider, getPrivateStorage } from '@/lib/storage';
import { clearRecoveryObject, discardRecoveryObject, reserveRecoveryObject } from '@/lib/storage-recovery';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!hasStudioAccess(user)) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  if (!isSameOrigin(request)) return NextResponse.json({ error: 'Request origin could not be verified.' }, { status: 403 });
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: 'Catalogue draft not found.' }, { status: 404 });
  const client = await getPool().connect();
  try {
    const inventoryState = await getPool().query('SELECT revision FROM studio_inventory_state WHERE id=1');
    const inventoryRevision = Number(inventoryState.rows[0]?.revision ?? 0);
    if (!inventoryRevision) return NextResponse.json({ error: 'Inventory revision state is missing; apply database migrations.' }, { status: 503 });
    const result = await client.query(`SELECT c.id,c.title,c.style,c.occasion,c.revision,
      p.id AS product_id,p.name AS product_name,p.availability,ci.outfit_role,
      i.id AS image_id,i.view_label,i.object_key,i.storage_provider,i.media_type,i.byte_size,i.sha256,i.is_current,
      (r.product_image_id IS NOT NULL) AS reviewed
      FROM catalogues c JOIN catalogue_items ci ON ci.catalogue_id=c.id
      JOIN products p ON p.id=ci.product_id JOIN product_images i ON i.id=ci.product_image_id
      LEFT JOIN product_image_reviews r ON r.product_image_id=i.id
      WHERE c.id=$1 ORDER BY ci.position`, [id]);
    if (!result.rowCount) return NextResponse.json({ error: 'Catalogue draft not found.' }, { status: 404 });
    const first = result.rows[0];
    if (result.rows.length < 2 || result.rows.some((row) => row.availability !== 'active' || !row.is_current || !row.reviewed)) return NextResponse.json({ error: 'All selected source images must be current, reviewed, and attached to active products.' }, { status: 409 });
    const pending = await getPool().query(`SELECT EXISTS(SELECT 1 FROM product_images i LEFT JOIN product_image_reviews r ON r.product_image_id=i.id WHERE r.product_image_id IS NULL) AS pending`);
    if (pending.rows[0].pending) return NextResponse.json({ error: 'Review every accessible inventory image before creating a catalogue layout.' }, { status: 409 });
    const sources = [];
    for (const row of result.rows) {
      const bytes = await getPrivateStorage(row.storage_provider ?? env.STORAGE_PROVIDER).get(row.object_key);
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      if (bytes.length !== Number(row.byte_size) || sha256 !== row.sha256) return NextResponse.json({ error: `Source image ${row.image_id} failed its checksum check.` }, { status: 409 });
      sources.push({ name: row.product_name as string, role: row.outfit_role as string, view: row.view_label as string, bytes, productId: row.product_id as string, imageId: row.image_id as string, sha256 });
    }
    const rendered = await renderOriginalPhotoCatalogue({ title: first.title, style: first.style, occasion: first.occasion, items: sources });
    const key = `catalogues/${id}/outputs/${randomUUID()}.png`;
    const sha256 = createHash('sha256').update(rendered.bytes).digest('hex');
    const provider = configuredStorageProvider();
    const storage = getPrivateStorage(provider);
    const recoveryId = await reserveRecoveryObject(getPool(), { objectKey: key, provider, purpose: 'catalogue-output', entityId: id, sha256, byteSize: rendered.bytes.length });
    try {
      await storage.put(key, rendered.bytes, 'image/png');
      await client.query('BEGIN');
      await client.query("SELECT pg_advisory_xact_lock(hashtext('alveron-product-inventory'))");
      const locked = await client.query('SELECT revision,status FROM catalogues WHERE id=$1 FOR UPDATE', [id]);
      if (!locked.rowCount || locked.rows[0].revision !== first.revision || !['draft','review','rejected','failed'].includes(locked.rows[0].status)) throw new Error('The catalogue source changed while the output was being composed. Reopen the latest draft.');
      const currentInventory = await client.query('SELECT revision FROM studio_inventory_state WHERE id=1');
      if (Number(currentInventory.rows[0]?.revision) !== inventoryRevision) throw new Error('Inventory changed while the layout was being composed. Review the latest inventory and try again.');
      const snapshot = { revision: first.revision, inventoryRevision, items: sources.map(({ productId, imageId, sha256, role }) => ({ productId, imageId, sha256, role })), style: first.style, occasion: first.occasion, outputKind: 'original-photo-composition' };
      const asset = await client.query(`INSERT INTO generated_assets (catalogue_id,object_key,sha256,width,height,generation_job_id,media_type,byte_size,output_kind,input_snapshot,created_by,storage_provider)
        VALUES ($1,$2,$3,$4,$5,NULL,'image/png',$6,'original-photo-composition',$7,$8,$9) RETURNING id`, [id, key, sha256, rendered.width, rendered.height, rendered.bytes.length, JSON.stringify(snapshot), user.id, provider]);
      await client.query(`UPDATE catalogue_approvals SET invalidated_at=now(),invalidation_reason='A newer output version was created' WHERE catalogue_id=$1 AND invalidated_at IS NULL`, [id]);
      await client.query(`UPDATE catalogues SET status='review',rejection_reason=NULL,source_snapshot=$2,updated_at=now() WHERE id=$1`, [id, JSON.stringify(snapshot)]);
      await client.query('INSERT INTO audit_events (actor_id,action,entity_type,entity_id,detail) VALUES ($1,$2,$3,$4,$5)', [user.id, 'catalogue.original_composition_created', 'catalogue', id, JSON.stringify({ assetId: asset.rows[0].id, sha256, revision: first.revision })]);
      await client.query('COMMIT');
      await clearRecoveryObject(getPool(), recoveryId);
      return NextResponse.json({ assetId: asset.rows[0].id, kind: 'original-photo-composition', sha256 }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      // The output was never committed to generated_assets, so its bytes must not
      // remain in storage unreferenced. Remove them, then the recovery row.
      await discardRecoveryObject(getPool(), storage, recoveryId, key);
      throw error;
    }
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'The original-photo composition could not be created.' }, { status: 409 });
  } finally { client.release(); }
}
