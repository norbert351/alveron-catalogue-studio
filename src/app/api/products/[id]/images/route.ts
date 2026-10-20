import { createHash, randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser, isSameOrigin } from '@/lib/auth';
import { getPool } from '@/lib/db';
import { MAX_PRODUCT_IMAGES, validateImage } from '@/lib/image-validation';
import { hasStudioAccess } from '@/lib/security-rules';
import { configuredStorageProvider, getPrivateStorage } from '@/lib/storage';
import { bumpInventoryRevision } from '@/lib/inventory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const labels = new Set(['front', 'back', 'side', 'close-up', 'detail', 'colour/design']);
const maxRequestBytes = MAX_PRODUCT_IMAGES * 15 * 1024 * 1024 + 128 * 1024;

async function boundedForm(request: Request): Promise<FormData> {
  if (Number(request.headers.get('content-length') ?? 0) > maxRequestBytes) throw new RangeError('Upload request exceeds 75 MB.');
  if (!request.body) throw new Error('Upload body is missing.');
  const contentType = request.headers.get('content-type');
  if (!contentType?.toLowerCase().startsWith('multipart/form-data;')) throw new Error('Use multipart form data.');
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let total = 0;
  while (true) { const part = await reader.read(); if (part.done) break; total += part.value.byteLength; if (total > maxRequestBytes) { await reader.cancel(); throw new RangeError('Upload request exceeds 75 MB.'); } chunks.push(part.value); }
  const body = new Uint8Array(total); let offset = 0; for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return new Request(request.url, { method: 'POST', headers: { 'Content-Type': contentType }, body }).formData();
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!hasStudioAccess(user)) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  if (!isSameOrigin(request)) return NextResponse.json({ error: 'Request origin could not be verified.' }, { status: 403 });
  const { id: productId } = await context.params;
  if (!z.uuid().safeParse(productId).success) return NextResponse.json({ error: 'Product not found.' }, { status: 404 });
  const requestId = request.headers.get('idempotency-key')?.trim() || randomUUID();
  if (requestId.length > 200 || Array.from(requestId).some((character) => character.charCodeAt(0) < 32)) return NextResponse.json({ error: 'Invalid upload idempotency key.' }, { status: 400 });
  const product = await getPool().query('SELECT id,color FROM products WHERE id=$1', [productId]);
  if (!product.rowCount) return NextResponse.json({ error: 'Product not found.' }, { status: 404 });
  let form: FormData;
  try { form = await boundedForm(request); } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Image upload could not be read.' }, { status: error instanceof RangeError ? 413 : 400 }); }
  const files = form.getAll('images').filter((value): value is File => value instanceof File && value.size > 0);
  const views = form.getAll('viewLabels').map((value) => String(value));
  const replaces = form.getAll('replacesImageIds').map((value) => String(value));
  if (!files.length || files.length > MAX_PRODUCT_IMAGES || views.length !== files.length || replaces.length !== files.length || views.some((view) => !labels.has(view)) || replaces.some((id) => id !== '' && !z.uuid().safeParse(id).success)) {
    return NextResponse.json({ error: 'Choose 1–5 photos and a supported view label for each.' }, { status: 400 });
  }
  const validated = [];
  try { for (const file of files) validated.push({ file, image: await validateImage(file) }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'An image is invalid.' }, { status: 400 }); }
  const provider = configuredStorageProvider();
  const keys = validated.map(({ image }) => `products/${productId}/${randomUUID()}.${image.extension}`);
  const requestSha = createHash('sha256').update(JSON.stringify({ productId, views, replaces, images: validated.map(({ image }) => createHash('sha256').update(image.bytes).digest('hex')) })).digest('hex');
  const pool = getPool();
  const rate = await pool.query("SELECT count(*)::int AS count FROM product_upload_requests WHERE user_id=$1 AND created_at>now()-interval '1 hour'", [user.id]).catch(() => null);
  if (rate && rate.rows[0].count >= 20) return NextResponse.json({ error: 'Upload limit reached. Try again later.' }, { status: 429 });
  const reservation = await pool.query(`INSERT INTO product_upload_requests (user_id,idempotency_key,request_sha256,product_id,status,object_keys)
    VALUES ($1,$2,$3,$4,'receiving',$5) ON CONFLICT (user_id,idempotency_key) DO NOTHING RETURNING id`, [user.id, requestId, requestSha, productId, JSON.stringify(keys)]);
  if (!reservation.rowCount) {
    const prior = await pool.query('SELECT status,product_id,request_sha256 FROM product_upload_requests WHERE user_id=$1 AND idempotency_key=$2', [user.id, requestId]);
    if (prior.rows[0]?.request_sha256 !== requestSha) return NextResponse.json({ error: 'This idempotency key was already used for different image content.' }, { status: 409 });
    if (prior.rows[0]?.status === 'complete' && prior.rows[0].product_id === productId) return NextResponse.json({ duplicate: true, id: productId });
    return NextResponse.json({ error: 'This upload request is already running or needs recovery. Use a new idempotency key after reviewing upload health.' }, { status: 409 });
  }
  let stored = 0;
  const client = await pool.connect();
  try {
    const storage = getPrivateStorage(provider);
    for (const [index, entry] of validated.entries()) { await storage.put(keys[index], entry.image.bytes, entry.image.mediaType); stored += 1; }
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('alveron-product-inventory'))");
    await bumpInventoryRevision(client, 'Inventory revision changed after new product views were uploaded');
    for (const [index, entry] of validated.entries()) {
      const imageId = randomUUID();
      const image = entry.image;
      const replacesId = replaces[index] || null;
      if (replacesId) {
        const prior = await client.query('UPDATE product_images SET is_current=false WHERE id=$1 AND product_id=$2 AND is_current=true RETURNING id', [replacesId, productId]);
        if (!prior.rowCount) throw new Error('The image selected for replacement is no longer current.');
      }
      await client.query(`INSERT INTO product_images (id,product_id,object_key,original_filename,media_type,byte_size,sha256,width,height,view_label,storage_provider,supersedes_image_id,colour_design_label)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, [imageId, productId, keys[index], entry.file.name.slice(0, 240) || `view-${index + 1}`, image.mediaType, image.bytes.length, createHash('sha256').update(image.bytes).digest('hex'), image.width, image.height, views[index], provider, replacesId, views[index] === 'colour/design' ? product.rows[0].color : null]);
    }
    await client.query('INSERT INTO audit_events (actor_id,action,entity_type,entity_id,detail) VALUES ($1,$2,$3,$4,$5)', [user.id, 'product.images_added', 'product', productId, JSON.stringify({ imageCount: files.length })]);
    await client.query("UPDATE product_upload_requests SET status='complete',updated_at=now() WHERE user_id=$1 AND idempotency_key=$2", [user.id, requestId]);
    await client.query('COMMIT');
    return NextResponse.json({ id: productId, imageCount: files.length }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch {
    await client.query('ROLLBACK').catch(() => undefined);
    await pool.query("UPDATE product_upload_requests SET status='failed',error_code='upload_failed',updated_at=now() WHERE user_id=$1 AND idempotency_key=$2", [user.id, requestId]).catch(() => undefined);
    return NextResponse.json({ error: stored ? 'The images were stored but could not be linked. Their objects are tracked for recovery; do not retry with this idempotency key.' : 'Images could not be saved. Check database and storage health.' }, { status: 503 });
  } finally { client.release(); }
}
