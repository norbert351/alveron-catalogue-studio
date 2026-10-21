import { createHash, randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { getCurrentUser, isSameOrigin } from '@/lib/auth';
import { hasStudioAccess } from '@/lib/security-rules';
import { getPool } from '@/lib/db';
import { listProducts, listProductsPaged } from '@/lib/products';
import { productInputSchema } from '@/lib/product-rules';
import { MAX_PRODUCT_IMAGES, validateImage } from '@/lib/image-validation';
import { getPrivateStorage } from '@/lib/storage';
import { configuredStorageProvider } from '@/lib/storage';
import { bumpInventoryRevision } from '@/lib/inventory';
import { persistDerivatives } from '@/lib/derivative-store';
import { buildPage, countUnreviewedImages, parsePageRequest } from '@/lib/pagination';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const MAX_REQUEST_BYTES = MAX_PRODUCT_IMAGES * 15 * 1024 * 1024 + 128 * 1024;

async function readBoundedForm(request: Request): Promise<FormData> {
  if (!request.body) throw new Error('Upload body is missing.');
  const contentType = request.headers.get('content-type');
  if (!contentType?.toLowerCase().startsWith('multipart/form-data;')) throw new Error('Use a multipart product upload.');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_REQUEST_BYTES) {
      await reader.cancel();
      throw new RangeError('Upload is too large.');
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return new Request(request.url, { method: 'POST', headers: { 'Content-Type': contentType }, body }).formData();
}

export async function GET(request: Request) {
  if (!hasStudioAccess(await getCurrentUser())) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  const url = new URL(request.url);
  const paging = parsePageRequest({ page: url.searchParams.get('page') ?? undefined, pageSize: url.searchParams.get('pageSize') ?? undefined });
  const wantsPaging = url.searchParams.has('page') || url.searchParams.has('pageSize') || url.searchParams.has('search');
  try {
    if (!wantsPaging) {
      // Legacy shape kept intact for existing callers that expect the full list.
      const products = await listProducts();
      return NextResponse.json({ products, total: products.length, page: 1, pageSize: products.length, totalPages: 1, unreviewed: await countUnreviewedImages() }, { headers: { 'Cache-Control': 'private, no-store' } });
    }
    const { products, total } = await listProductsPaged({
      page: paging.page,
      pageSize: paging.pageSize,
      search: url.searchParams.get('search') ?? undefined,
      category: url.searchParams.get('category') ?? undefined,
      availability: url.searchParams.get('availability') ?? undefined,
      uploadedFrom: url.searchParams.get('uploadedFrom') ?? undefined,
      uploadedThrough: url.searchParams.get('uploadedThrough') ?? undefined,
    });
    const page = buildPage(products, paging, total);
    return NextResponse.json({ ...page, unreviewed: await countUnreviewedImages() }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch {
    return NextResponse.json({ error: 'Product library is unavailable. Check the database setup.' }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!hasStudioAccess(user)) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  if (!isSameOrigin(request)) return NextResponse.json({ error: 'Request origin could not be verified.' }, { status: 403 });
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (contentLength > MAX_REQUEST_BYTES) return NextResponse.json({ error: 'Upload is too large.' }, { status: 413 });

  let form: FormData;
  try {
    form = await readBoundedForm(request);
  } catch (error) {
    const tooLarge = error instanceof RangeError;
    return NextResponse.json({ error: tooLarge ? error.message : 'Upload could not be read. Use a multipart form with supported image files.' }, { status: tooLarge ? 413 : 400 });
  }
  const parsed = productInputSchema.safeParse(Object.fromEntries(['name', 'sku', 'category', 'color', 'fabric', 'pattern', 'fit', 'notes', 'tags'].map((key) => [key, form.get(key) ?? undefined])));
  if (!parsed.success) return NextResponse.json({ error: 'Check the product name and category.' }, { status: 400 });
  const files = form.getAll('images').filter((value): value is File => value instanceof File && value.size > 0);
  if (!files.length || files.length > MAX_PRODUCT_IMAGES) return NextResponse.json({ error: `Add between 1 and ${MAX_PRODUCT_IMAGES} product photos.` }, { status: 400 });
  const allowedViews = new Set(['front', 'back', 'side', 'close-up', 'detail', 'colour/design']);
  const submittedViews = form.getAll('viewLabels').map(String);
  const viewLabels = submittedViews.length === files.length ? submittedViews : files.map((_, index) => `Product view ${index + 1}`);
  if (viewLabels.some((label) => !allowedViews.has(label) && !label.startsWith('Product view '))) return NextResponse.json({ error: 'Choose a valid label for each product image.' }, { status: 400 });

  const validated = [];
  try {
    for (const file of files) validated.push({ file, image: await validateImage(file) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'A product image is invalid.' }, { status: 400 });
  }

  const productId = randomUUID();
  const storedKeys: string[] = [];
  const imageIds: string[] = [];
  const pool = getPool();
  const client = await pool.connect();
  const idempotencyKey = request.headers.get('idempotency-key')?.trim() || randomUUID();
  if (idempotencyKey.length > 200 || Array.from(idempotencyKey).some((character) => character.charCodeAt(0) < 32)) {
    client.release();
    return NextResponse.json({ error: 'The upload idempotency key is invalid.' }, { status: 400 });
  }
  const provider = configuredStorageProvider();
  const rate = await pool.query("SELECT count(*)::int AS count FROM product_upload_requests WHERE user_id=$1 AND created_at>now()-interval '1 hour'", [user.id]).catch(() => null);
  if (rate && rate.rows[0].count >= 20) { client.release(); return NextResponse.json({ error: 'Upload limit reached. Try again later.' }, { status: 429 }); }
  const objectKeys = validated.map((entry) => `products/${productId}/${randomUUID()}.${entry.image.extension}`);
  const requestSha = createHash('sha256').update(JSON.stringify({ product: parsed.data, views: viewLabels, images: validated.map(({ image }) => createHash('sha256').update(image.bytes).digest('hex')) })).digest('hex');
  try {
    const reservation = await pool.query(
      `INSERT INTO product_upload_requests (user_id, idempotency_key, request_sha256, status, object_keys)
       VALUES ($1,$2,$3,'receiving',$4) ON CONFLICT (user_id,idempotency_key) DO NOTHING RETURNING id`,
      [user.id, idempotencyKey, requestSha, JSON.stringify(objectKeys)],
    );
    if (!reservation.rowCount) {
      const prior = await pool.query('SELECT status, product_id,request_sha256 FROM product_upload_requests WHERE user_id=$1 AND idempotency_key=$2', [user.id, idempotencyKey]);
      if (prior.rows[0]?.request_sha256 !== requestSha) return NextResponse.json({ error: 'This idempotency key was already used for different product content.' }, { status: 409 });
      if (prior.rows[0]?.status === 'complete' && prior.rows[0].product_id) return NextResponse.json({ id: prior.rows[0].product_id, duplicate: true }, { status: 200 });
      return NextResponse.json({ error: 'This upload request is already being processed or needs storage recovery. Use a new idempotency key after checking Upload Health.' }, { status: 409 });
    }
    const storage = getPrivateStorage(provider);
    for (const [index, entry] of validated.entries()) {
      const key = objectKeys[index];
      await storage.put(key, entry.image.bytes, entry.image.mediaType);
      storedKeys.push(key);
    }
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('alveron-product-inventory'))");
    await bumpInventoryRevision(client, 'Inventory revision changed after a product upload');
    await client.query(
      `INSERT INTO products (id, sku, name, category, color, fabric, pattern, fit, notes, tags, created_by, owner_attributes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [productId, parsed.data.sku, parsed.data.name, parsed.data.category, parsed.data.color, parsed.data.fabric, parsed.data.pattern, parsed.data.fit, parsed.data.notes, parsed.data.tags, user.id, JSON.stringify({ color: parsed.data.color, fabric: parsed.data.fabric, pattern: parsed.data.pattern, fit: parsed.data.fit })],
    );
    for (const [index, entry] of validated.entries()) {
      const imageId = randomUUID();
      imageIds.push(imageId);
      const key = objectKeys[index];
      await client.query(
        `INSERT INTO product_images (id, product_id, object_key, original_filename, media_type, byte_size, sha256, width, height, view_label, storage_provider, colour_design_label)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [imageId, productId, key, entry.file.name.slice(0, 240) || `product-view-${index + 1}`, entry.image.mediaType, entry.image.bytes.length, createHash('sha256').update(entry.image.bytes).digest('hex'), entry.image.width, entry.image.height, viewLabels[index], provider, viewLabels[index] === 'colour/design' ? parsed.data.color : null],
      );
    }
    await client.query('INSERT INTO audit_events (actor_id, action, entity_type, entity_id, detail) VALUES ($1,$2,$3,$4,$5)', [user.id, 'product.created', 'product', productId, JSON.stringify({ imageCount: validated.length })]);
    await client.query("UPDATE product_upload_requests SET status='complete', product_id=$3, updated_at=now() WHERE user_id=$1 AND idempotency_key=$2", [user.id, idempotencyKey, productId]);
    await client.query('COMMIT');
    // Originals are committed and immutable from here. Derivatives are display
    // conveniences: if one fails, the upload still succeeds and the UI falls back
    // to the authenticated original route.
    for (const [index, imageId] of imageIds.entries()) {
      await persistDerivatives(client, storage, {
        productId,
        imageId,
        originalBytes: validated[index].image.bytes,
        originalSha256: createHash('sha256').update(validated[index].image.bytes).digest('hex'),
        provider,
      });
    }
    return NextResponse.json({ id: productId }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    await pool.query("UPDATE product_upload_requests SET status='failed', object_keys=$3, error_code='upload_failed', updated_at=now() WHERE user_id=$1 AND idempotency_key=$2", [user.id, idempotencyKey, JSON.stringify(objectKeys)]).catch(() => undefined);
    const message = error instanceof Error ? error.message : '';
    return NextResponse.json({ error: message.includes('duplicate key') ? 'That SKU is already in the library.' : storedKeys.length ? 'Product upload needs recovery. The original objects are preserved and recorded for storage recovery; do not retry with the same idempotency key.' : 'Product could not be saved. Check storage and database configuration.' }, { status: 503 });
  } finally {
    client.release();
  }
}
