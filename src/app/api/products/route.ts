import { createHash, randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { getCurrentUser, isSameOrigin } from '@/lib/auth';
import { hasStudioAccess } from '@/lib/security-rules';
import { getPool } from '@/lib/db';
import { listProducts } from '@/lib/products';
import { productInputSchema } from '@/lib/product-rules';
import { MAX_PRODUCT_IMAGES, validateImage } from '@/lib/image-validation';
import { getPrivateStorage } from '@/lib/storage';

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

export async function GET() {
  if (!hasStudioAccess(await getCurrentUser())) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  try {
    return NextResponse.json({ products: await listProducts() }, { headers: { 'Cache-Control': 'private, no-store' } });
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
  const parsed = productInputSchema.safeParse(Object.fromEntries(['name', 'sku', 'category', 'color', 'fabric', 'pattern', 'fit', 'notes'].map((key) => [key, form.get(key) ?? undefined])));
  if (!parsed.success) return NextResponse.json({ error: 'Check the product name and category.' }, { status: 400 });
  const files = form.getAll('images').filter((value): value is File => value instanceof File && value.size > 0);
  if (!files.length || files.length > MAX_PRODUCT_IMAGES) return NextResponse.json({ error: `Add between 1 and ${MAX_PRODUCT_IMAGES} product photos.` }, { status: 400 });

  const validated = [];
  try {
    for (const file of files) validated.push({ file, image: await validateImage(file) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'A product image is invalid.' }, { status: 400 });
  }

  const productId = randomUUID();
  const storedKeys: string[] = [];
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('alveron-product-inventory'))");
    await client.query(
      `INSERT INTO products (id, sku, name, category, color, fabric, pattern, fit, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [productId, parsed.data.sku, parsed.data.name, parsed.data.category, parsed.data.color, parsed.data.fabric, parsed.data.pattern, parsed.data.fit, parsed.data.notes, user.id],
    );
    const storage = getPrivateStorage();
    for (const [index, entry] of validated.entries()) {
      const imageId = randomUUID();
      const key = `products/${productId}/${imageId}.${entry.image.extension}`;
      await storage.put(key, entry.image.bytes, entry.image.mediaType);
      storedKeys.push(key);
      await client.query(
        `INSERT INTO product_images (id, product_id, object_key, original_filename, media_type, byte_size, sha256, width, height, view_label)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [imageId, productId, key, entry.file.name.slice(0, 240) || `product-view-${index + 1}`, entry.image.mediaType, entry.image.bytes.length, createHash('sha256').update(entry.image.bytes).digest('hex'), entry.image.width, entry.image.height, `Product view ${index + 1}`],
      );
    }
    await client.query('INSERT INTO audit_events (actor_id, action, entity_type, entity_id, detail) VALUES ($1,$2,$3,$4,$5)', [user.id, 'product.created', 'product', productId, JSON.stringify({ imageCount: validated.length })]);
    await client.query('COMMIT');
    return NextResponse.json({ id: productId }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    await Promise.allSettled(storedKeys.map((key) => getPrivateStorage().remove(key)));
    const message = error instanceof Error ? error.message : '';
    return NextResponse.json({ error: message.includes('duplicate key') ? 'That SKU is already in the library.' : 'Product could not be saved. Check storage and database configuration.' }, { status: 503 });
  } finally {
    client.release();
  }
}
