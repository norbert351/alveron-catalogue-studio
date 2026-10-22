import { createHash, randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser, isSameOrigin } from '@/lib/auth';
import { env } from '@/lib/config';
import { getPool } from '@/lib/db';
import { hasStudioAccess } from '@/lib/security-rules';
import { configuredStorageProvider, getPrivateStorage } from '@/lib/storage';
import { clearRecoveryObject, discardRecoveryObject, reserveRecoveryObject } from '@/lib/storage-recovery';
import { extractDetailPanels, renderEditorialCatalogue } from '@/lib/editorial-renderer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * Compose the publishable Alveron editorial layout from a REAL generated asset.
 *
 * Deliberately separate from /compose (original-photo composition): this route
 * refuses to run unless it is given an asset that a provider actually generated,
 * so the editorial layout can never be faked out of stock images.
 *
 * Body: { assetId: string }
 * The resulting composite is a NEW generated_assets row; the hero is not modified,
 * which keeps every generated output individually reviewable and traceable.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!hasStudioAccess(user)) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  if (!isSameOrigin(request)) return NextResponse.json({ error: 'Request origin could not be verified.' }, { status: 403 });
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: 'Catalogue not found.' }, { status: 404 });
  const body = await request.json().catch(() => ({})) as { assetId?: string };
  if (!body.assetId || !z.uuid().safeParse(body.assetId).success) return NextResponse.json({ error: 'Choose a generated output to compose.' }, { status: 400 });

  const pool = getPool();
  const storage = getPrivateStorage(configuredStorageProvider());
  const client = await pool.connect();
  try {
    const catalogue = await pool.query<{ id: string; title: string; style: string; occasion: string; revision: number; created_at: Date }>(
      'SELECT id,title,style,occasion,revision,created_at FROM catalogues WHERE id=$1', [id]);
    if (!catalogue.rowCount) return NextResponse.json({ error: 'Catalogue not found.' }, { status: 404 });

    const asset = await pool.query<{
      id: string; object_key: string; storage_provider: string | null; media_type: string; sha256: string; byte_size: string;
      output_kind: string; fidelity_ratio: string | null; fidelity_method: string | null; provider: string | null; provider_model: string | null;
    }>('SELECT id,object_key,storage_provider,media_type,sha256,byte_size,output_kind,fidelity_ratio,fidelity_method,provider,provider_model FROM generated_assets WHERE id=$1 AND catalogue_id=$2',
      [body.assetId, id]);
    if (!asset.rowCount) return NextResponse.json({ error: 'That output does not belong to this catalogue.' }, { status: 404 });
    const hero = asset.rows[0];
    if (hero.output_kind !== 'generated') {
      return NextResponse.json({ error: 'The editorial layout must be built from a provider-generated image, not an original-photo composition.' }, { status: 409 });
    }

    const heroBytes = await storage.get(hero.object_key);
    if (createHash('sha256').update(heroBytes).digest('hex') !== hero.sha256) {
      return NextResponse.json({ error: 'The generated output failed its checksum check.' }, { status: 503 });
    }

    const items = await pool.query<{ name: string; role: string; category: string; colour: string | null; object_key: string; storage_provider: string | null; sha256: string; byte_size: string }>(
      `SELECT p.name, ci.outfit_role AS role, p.category, p.color AS colour, i.object_key, i.storage_provider, i.sha256, i.byte_size
         FROM catalogue_items ci
         JOIN products p ON p.id = ci.product_id
         JOIN product_images i ON i.id = ci.product_image_id
        WHERE ci.catalogue_id = $1 ORDER BY ci.position`, [id]);
    if (!items.rowCount) return NextResponse.json({ error: 'This catalogue has no source products.' }, { status: 409 });
    // Same shape the approval gate validates against, or approving this composite
    // would always report a stale source snapshot.
    const inventoryRevision = Number((await pool.query('SELECT revision FROM studio_inventory_state WHERE id=1')).rows[0]?.revision ?? 0);
    const snapshotItems = await pool.query<{ product_id: string; image_id: string; sha256: string; role: string }>(
      `SELECT ci.product_id, ci.product_image_id AS image_id, i.sha256, ci.outfit_role AS role
         FROM catalogue_items ci JOIN product_images i ON i.id = ci.product_image_id
        WHERE ci.catalogue_id = $1 ORDER BY ci.position`, [id]);

    // Detail panels come from the FIRST real source photograph — genuine garment detail.
    const primary = items.rows[0];
    const primaryBytes = await storage.get(primary.object_key);
    if (createHash('sha256').update(primaryBytes).digest('hex') !== primary.sha256) {
      return NextResponse.json({ error: 'A source product image failed its checksum check.' }, { status: 409 });
    }
    const details = await extractDetailPanels(primaryBytes, 2, (index) => `${primary.name} · ${['upper detail', 'lower detail'][index] ?? 'detail'}`);

    const fidelityNote = hero.fidelity_ratio === null
      ? 'GARMENT FIDELITY NOT MEASURED — MANUAL REVIEW REQUIRED BEFORE PUBLISHING'
      : `GARMENT FIDELITY: MACHINE-ESTIMATED ${Math.round(Number(hero.fidelity_ratio) * 100)}% OF SOURCE DETAILS PRESERVED — VERIFY VISUALLY`;

    const issue = `№ ${String(new Date(catalogue.rows[0].created_at).getUTCFullYear()).slice(2)}·${String(catalogue.rows[0].revision).padStart(3, '0')}`;
    const rendered = await renderEditorialCatalogue({
      title: catalogue.rows[0].title,
      style: catalogue.rows[0].style,
      occasion: catalogue.rows[0].occasion,
      issue,
      heroBytes,
      items: items.rows.map((row) => ({ name: row.name, role: row.role, category: row.category, colour: row.colour })),
      details,
      fidelityNote,
    });

    const key = `catalogues/${id}/outputs/${randomUUID()}.png`;
    const sha256 = createHash('sha256').update(rendered.bytes).digest('hex');
    const provider = configuredStorageProvider();
    const recoveryId = await reserveRecoveryObject(pool, { objectKey: key, provider, purpose: 'catalogue-output', entityId: id, sha256, byteSize: rendered.bytes.length });
    try {
      await storage.put(key, rendered.bytes, 'image/png');
      await client.query('BEGIN');
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO generated_assets
           (catalogue_id, object_key, sha256, width, height, media_type, byte_size, output_kind,
            input_snapshot, created_by, storage_provider, provider, provider_model, fidelity_ratio, fidelity_method,
            source_sha256, supersedes_asset_id)
         VALUES ($1,$2,$3,$4,$5,'image/png',$6,'generated',$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
        [id, key, sha256, rendered.width, rendered.height, rendered.bytes.length,
          JSON.stringify({
            kind: 'editorial-composite',
            revision: catalogue.rows[0].revision,
            inventoryRevision,
            heroAssetId: hero.id, heroSha256: hero.sha256, detailCount: details.length,
            items: snapshotItems.rows.map((row) => ({ productId: row.product_id, imageId: row.image_id, sha256: row.sha256, role: row.role })),
          }),
          user.id, provider, hero.provider, hero.provider_model, hero.fidelity_ratio, hero.fidelity_method, hero.sha256, hero.id],
      );
      // A new output invalidates any prior approval: what was approved is no longer what exists.
      await client.query("UPDATE catalogue_approvals SET invalidated_at=now(), invalidation_reason='A newer editorial output was created' WHERE catalogue_id=$1 AND invalidated_at IS NULL", [id]);
      await client.query("UPDATE catalogues SET status='review', rejection_reason=NULL, updated_at=now() WHERE id=$1", [id]);
      await client.query('INSERT INTO audit_events (actor_id,action,entity_type,entity_id,detail) VALUES ($1,$2,$3,$4,$5)',
        [user.id, 'catalogue.editorial_composed', 'catalogue', id, JSON.stringify({ assetId: inserted.rows[0].id, heroAssetId: hero.id, sha256, details: details.length })]);
      await client.query('COMMIT');
      await clearRecoveryObject(pool, recoveryId);
      return NextResponse.json({
        assetId: inserted.rows[0].id, kind: 'editorial-composite', sha256,
        width: rendered.width, height: rendered.height, detailPanels: details.length,
        fidelityRatio: hero.fidelity_ratio, fidelityMethod: hero.fidelity_method,
      }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      await discardRecoveryObject(pool, storage, recoveryId, key);
      throw error;
    }
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'The editorial layout could not be composed.' }, { status: 409 });
  } finally { client.release(); }
}
