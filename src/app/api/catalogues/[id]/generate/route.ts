import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser, isSameOrigin } from '@/lib/auth';
import { env } from '@/lib/config';
import { getPool } from '@/lib/db';
import { hasStudioAccess } from '@/lib/security-rules';
import { getImageGenerationProvider } from '@/lib/generation/provider';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!hasStudioAccess(user)) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  if (!isSameOrigin(request)) return NextResponse.json({ error: 'Request origin could not be verified.' }, { status: 403 });
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: 'Catalogue not found.' }, { status: 404 });
  const key = request.headers.get('idempotency-key')?.trim() || randomUUID();
  if (key.length > 200 || Array.from(key).some((character) => character.charCodeAt(0) < 32)) return NextResponse.json({ error: 'Invalid generation idempotency key.' }, { status: 400 });
  const provider = getImageGenerationProvider();
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const catalogue = await client.query('SELECT id,title,style,occasion,revision,status FROM catalogues WHERE id=$1 FOR UPDATE', [id]);
    if (!catalogue.rowCount) { await client.query('ROLLBACK'); return NextResponse.json({ error: 'Catalogue not found.' }, { status: 404 }); }
    const prior = await client.query('SELECT id,status,error_code FROM generation_jobs WHERE catalogue_id=$1 AND idempotency_key=$2', [id, key]);
    if (prior.rowCount) { await client.query('COMMIT'); return NextResponse.json({ jobId: prior.rows[0].id, status: prior.rows[0].status, errorCode: prior.rows[0].error_code }, { status: 200 }); }
    const rate = await client.query("SELECT count(*)::int AS count FROM generation_jobs WHERE catalogue_id=$1 AND created_at>now()-interval '10 minutes'", [id]);
    if (rate.rows[0].count >= 3) { await client.query('ROLLBACK'); return NextResponse.json({ error: 'Generation request limit reached for this catalogue. Wait before retrying.' }, { status: 429 }); }
    const inventory = await client.query('SELECT revision FROM studio_inventory_state WHERE id=1');
    const items = await client.query(`SELECT p.id AS product_id,p.name,p.availability,ci.outfit_role,i.id AS image_id,i.sha256,i.is_current,
      (r.product_image_id IS NOT NULL) AS reviewed FROM catalogue_items ci JOIN products p ON p.id=ci.product_id
      JOIN product_images i ON i.id=ci.product_image_id LEFT JOIN product_image_reviews r ON r.product_image_id=i.id
      WHERE ci.catalogue_id=$1 ORDER BY ci.position`, [id]);
    const pending = await client.query('SELECT EXISTS(SELECT 1 FROM product_images i LEFT JOIN product_image_reviews r ON r.product_image_id=i.id WHERE r.product_image_id IS NULL) AS pending');
    if (items.rows.length < 2 || pending.rows[0].pending || items.rows.some((item) => !item.reviewed || !item.is_current || item.availability !== 'active')) {
      await client.query('ROLLBACK'); return NextResponse.json({ error: 'Review all accessible inventory images and confirm active, current sources before generation.' }, { status: 409 });
    }
    const inputSnapshot = { catalogueId: id, revision: Number(catalogue.rows[0].revision), inventoryRevision: Number(inventory.rows[0]?.revision), title: catalogue.rows[0].title, style: catalogue.rows[0].style, occasion: catalogue.rows[0].occasion, items: items.rows };
    const configured = provider !== null;
    const job = await client.query(`INSERT INTO generation_jobs (catalogue_id,status,provider,model,input_snapshot,idempotency_key,error_code,error_message,finished_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,CASE WHEN $2='blocked' THEN now() ELSE NULL END) RETURNING id,status,error_code`,
      [id, configured ? 'queued' : 'blocked', provider?.id ?? 'none', null, JSON.stringify(inputSnapshot), key, configured ? null : 'provider_not_configured', configured ? null : 'No real image-generation adapter is configured. Original-photo composition remains available.']);
    await client.query("UPDATE catalogues SET status=$2,updated_at=now() WHERE id=$1", [id, configured ? 'queued' : 'draft']);
    await client.query('INSERT INTO audit_events(actor_id,action,entity_type,entity_id,detail) VALUES($1,$2,$3,$4,$5)', [user.id, configured ? 'generation.queued' : 'generation.blocked', 'catalogue', id, JSON.stringify({ jobId: job.rows[0].id, provider: provider?.id ?? 'none' })]);
    await client.query('COMMIT');
    return NextResponse.json({ jobId: job.rows[0].id, status: job.rows[0].status, errorCode: job.rows[0].error_code, provider: provider?.id ?? env.IMAGE_GENERATION_PROVIDER }, { status: configured ? 202 : 503 });
  } catch {
    await client.query('ROLLBACK').catch(() => undefined);
    return NextResponse.json({ error: 'Generation job could not be recorded. Check database readiness and retry safely.' }, { status: 503 });
  } finally { client.release(); }
}
