import { createHash, randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import sharp from 'sharp';
import { z } from 'zod';
import { getCurrentUser, isSameOrigin } from '@/lib/auth';
import { env } from '@/lib/config';
import { getPool } from '@/lib/db';
import { isApprovalCurrent } from '@/lib/approval-rules';
import { jpegPagePdf } from '@/lib/pdf';
import { hasStudioAccess } from '@/lib/security-rules';
import { configuredStorageProvider, getPrivateStorage } from '@/lib/storage';
import { clearRecoveryObject, discardRecoveryObject, reserveRecoveryObject } from '@/lib/storage-recovery';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const schema = z.object({ assetId: z.uuid(), format: z.enum(['png', 'jpeg', 'pdf']), dimensions: z.enum(['1080x1080', '1080x1350', '1920x1080', '2160x2700']) });
const dimensions = { '1080x1080': [1080, 1080], '1080x1350': [1080, 1350], '1920x1080': [1920, 1080], '2160x2700': [2160, 2700] } as const;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!hasStudioAccess(user)) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  if (!isSameOrigin(request)) return NextResponse.json({ error: 'Request origin could not be verified.' }, { status: 403 });
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: 'Catalogue not found.' }, { status: 404 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid export request.' }, { status: 400 }); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Choose an approved output, format and supported dimensions.' }, { status: 400 });
  const [width, height] = dimensions[parsed.data.dimensions];
  try {
    const recent = await getPool().query('SELECT count(*)::int AS count FROM catalogue_exports WHERE exported_by=$1 AND created_at>now()-interval \'1 minute\'', [user.id]);
    if (recent.rows[0].count >= 10) return NextResponse.json({ error: 'Export rate limit reached. Wait a minute before making more exports.' }, { status: 429 });
    const result = await getPool().query(`SELECT c.title,c.status,c.revision,a.id AS asset_id,a.object_key,a.storage_provider,a.sha256,a.byte_size,a.media_type,
      ap.id AS approval_id,ap.approved_revision,ap.output_sha256,ap.invalidated_at
      FROM catalogues c JOIN generated_assets a ON a.catalogue_id=c.id
      JOIN catalogue_approvals ap ON ap.catalogue_id=c.id AND ap.generated_asset_id=a.id
      WHERE c.id=$1 AND a.id=$2 ORDER BY ap.approved_at DESC LIMIT 1`, [id, parsed.data.assetId]);
    const row = result.rows[0];
    if (!row || !isApprovalCurrent({ catalogueStatus: row.status, catalogueRevision: Number(row.revision), approvedRevision: Number(row.approved_revision), approvalChecksum: row.output_sha256, outputChecksum: row.sha256, invalidatedAt: row.invalidated_at })) {
      return NextResponse.json({ error: 'Export is blocked. Approve this exact output version after source review.' }, { status: 409 });
    }
    const source = await getPrivateStorage(row.storage_provider ?? env.STORAGE_PROVIDER).get(row.object_key);
    const sourceSha = createHash('sha256').update(source).digest('hex');
    if (source.length !== Number(row.byte_size) || sourceSha !== row.sha256) return NextResponse.json({ error: 'The approved output failed its checksum check; export is blocked.' }, { status: 409 });
    const raster = sharp(source, { limitInputPixels: 120_000_000 }).resize(width, height, { fit: 'contain', background: '#eeeae3' }).png();
    const pngBytes = await raster.toBuffer();
    const jpegBytes = await sharp(pngBytes).jpeg({ quality: 94, chromaSubsampling: '4:4:4' }).toBuffer();
    const format = parsed.data.format;
    const bytes = format === 'png' ? pngBytes : format === 'jpeg' ? jpegBytes : jpegPagePdf(jpegBytes, width, height);
    const mediaType = format === 'png' ? 'image/png' : format === 'jpeg' ? 'image/jpeg' : 'application/pdf';
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const exportId = randomUUID(); const provider = configuredStorageProvider();
    const objectKey = `catalogues/${id}/exports/${exportId}.${format === 'jpeg' ? 'jpg' : format}`;
    const storage = getPrivateStorage(provider);
    const recoveryId = await reserveRecoveryObject(getPool(), { objectKey, provider, purpose: 'catalogue-export', entityId: id, sha256, byteSize: bytes.length });
    const client = await getPool().connect();
    try {
      await storage.put(objectKey, bytes, mediaType);
      await client.query('BEGIN');
      const recheck = await client.query(`SELECT c.status,c.revision,a.sha256,ap.approved_revision,ap.output_sha256,ap.invalidated_at
        FROM catalogues c JOIN generated_assets a ON a.catalogue_id=c.id
        JOIN catalogue_approvals ap ON ap.catalogue_id=c.id AND ap.generated_asset_id=a.id
        WHERE c.id=$1 AND a.id=$2 AND ap.id=$3 FOR UPDATE OF c,ap`, [id, parsed.data.assetId, row.approval_id]);
      const current = recheck.rows[0];
      if (!current || !isApprovalCurrent({ catalogueStatus: current.status, catalogueRevision: Number(current.revision), approvedRevision: Number(current.approved_revision), approvalChecksum: current.output_sha256, outputChecksum: current.sha256, invalidatedAt: current.invalidated_at })) throw new Error('Approval changed during export.');
      await client.query(`INSERT INTO catalogue_exports (id,catalogue_id,generated_asset_id,approval_id,exported_by,format,width,height,object_key,sha256,byte_size,storage_provider)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [exportId, id, parsed.data.assetId, row.approval_id, user.id, format, width, height, objectKey, sha256, bytes.length, provider]);
      await client.query("UPDATE catalogues SET status='exported',updated_at=now() WHERE id=$1", [id]);
      await client.query('INSERT INTO audit_events(actor_id,action,entity_type,entity_id,detail) VALUES($1,$2,$3,$4,$5)', [user.id, 'catalogue.exported', 'catalogue', id, JSON.stringify({ exportId, assetId: parsed.data.assetId, outputSha256: row.sha256, format, width, height, exportSha256: sha256 })]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      // The export was not committed, so its bytes must not linger as an
      // untracked object. Remove the file, then the recovery row.
      await discardRecoveryObject(getPool(), storage, recoveryId, objectKey);
      throw error;
    }
    finally { client.release(); }
    await clearRecoveryObject(getPool(), recoveryId);
    return new Response(new Uint8Array(bytes), { headers: { 'Content-Type': mediaType, 'Content-Length': String(bytes.length), 'Content-Disposition': `attachment; filename="alveron-${id}.${format === 'jpeg' ? 'jpg' : format}"`, 'Cache-Control': 'private, no-store', 'X-Export-ID': exportId, 'X-Export-SHA256': sha256 } });
  } catch (error) {
    console.error('Catalogue export failed:', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'Export could not be completed. Check approval and private storage health, then try again.' }, { status: 503 });
  }
}
