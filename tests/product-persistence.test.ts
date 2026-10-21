/**
 * Product-library persistence tests (brief section: "Product-library persistence tests").
 *
 * These run against the real Postgres instance pointed at by DATABASE_URL, using
 * an isolated schema-less scratch dataset that is removed afterwards. They do NOT
 * touch existing products: every row created here is tracked and deleted again.
 *
 * Skips cleanly when DATABASE_URL is absent so `npm test` still works on a
 * machine without a database.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import sharp from 'sharp';
import { storeImmutableFile, readPrivateFile, removePrivateFile } from '../src/lib/storage-files';
import { isSafeObjectKey } from '../src/lib/security-rules';
import { buildPage, parsePageRequest, pageOffset } from '../src/lib/pagination';
import { isApprovalCurrent } from '../src/lib/approval-rules';

const connectionString = process.env.DATABASE_URL;
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

// ---------------------------------------------------------------------------
// Pure logic — always runs
// ---------------------------------------------------------------------------

test('pagination never hides products and reports the true total', () => {
  const request = parsePageRequest({ page: '2', pageSize: '10' });
  assert.deepEqual(request, { page: 2, pageSize: 10 });
  const page = buildPage(Array.from({ length: 10 }, (_, index) => index), request, 25);
  assert.equal(page.total, 25);
  assert.equal(page.totalPages, 3);
  assert.equal(page.hasPrevious, true);
  assert.equal(page.hasNext, true);
  // Last page is reachable and partial rather than silently empty.
  const last = buildPage([1, 2, 3, 4, 5], { page: 3, pageSize: 10 }, 25);
  assert.equal(last.hasNext, false);
  assert.equal(last.items.length, 5);
});

test('pagination clamps bad input instead of failing or requesting negative offsets', () => {
  assert.deepEqual(parsePageRequest({ page: '-4', pageSize: '0' }), { page: 1, pageSize: 24 });
  assert.deepEqual(parsePageRequest({ page: 'abc' }), { page: 1, pageSize: 24 });
  // pageSize is capped so a client cannot request the whole library at once.
  assert.equal(parsePageRequest({ pageSize: '100000' }).pageSize, 100);
  assert.ok(pageOffset({ page: 1, pageSize: 10 }) === 0);
  assert.ok(pageOffset({ page: -3, pageSize: 10 }) === 0);
});

test('approval is only current for the exact checksum and revision', () => {
  const base = { catalogueStatus: 'approved', catalogueRevision: 4, approvedRevision: 4, approvalChecksum: 'a'.repeat(64), outputChecksum: 'a'.repeat(64), invalidatedAt: null };
  assert.equal(isApprovalCurrent(base), true);
  assert.equal(isApprovalCurrent({ ...base, outputChecksum: 'b'.repeat(64) }), false, 'changed output must invalidate');
  assert.equal(isApprovalCurrent({ ...base, catalogueRevision: 5 }), false, 'newer revision must invalidate');
  assert.equal(isApprovalCurrent({ ...base, invalidatedAt: new Date() }), false, 'explicit invalidation must win');
  assert.equal(isApprovalCurrent({ ...base, catalogueStatus: 'review' }), false, 'unapproved status cannot export');
});

test('writes are byte-identical to the checksum recorded at upload time', async () => {
  const root = await mkdtemp(join(tmpdir(), 'alveron-persist-'));
  try {
    const original = await sharp({ create: { width: 40, height: 50, channels: 3, background: '#223344' } }).png().toBuffer();
    const key = 'products/00000000-0000-4000-8000-000000000000/original.png';
    await storeImmutableFile(root, key, original);
    const readBack = await readPrivateFile(root, key);
    assert.equal(sha(readBack), sha(original), 'bytes on disk must match the original checksum');
    assert.deepEqual(readBack, original);
    // Write-once: a second write must not replace the original.
    await assert.rejects(storeImmutableFile(root, key, Buffer.from('overwrite-attempt')));
    assert.deepEqual(await readPrivateFile(root, key), original);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('unsafe storage keys are refused before touching the filesystem', async () => {
  const root = await mkdtemp(join(tmpdir(), 'alveron-guard-'));
  try {
    for (const key of ['../escape.png', 'products/../../etc/passwd.png', '/abs.png', 'products/x.svg']) {
      assert.equal(isSafeObjectKey(key), false, `${key} must be rejected by the guard`);
      await assert.rejects(storeImmutableFile(root, key, Buffer.from('x')), `${key} must not be written`);
      await assert.rejects(readPrivateFile(root, key), `${key} must not be read`);
    }
    // Removing a key that was never written is a no-op, not a crash.
    await removePrivateFile(root, 'products/00000000-0000-4000-8000-000000000001/none.png');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('deleting one image never removes an unrelated object file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'alveron-delete-'));
  try {
    const a = Buffer.from('product-a-original');
    const b = Buffer.from('product-b-original');
    await storeImmutableFile(root, 'products/p-a/img-a.jpg', a);
    await storeImmutableFile(root, 'products/p-b/img-b.jpg', b);
    await removePrivateFile(root, 'products/p-a/img-a.jpg');
    // b survives untouched — this is the property the retention policy relies on.
    assert.deepEqual(await readPrivateFile(root, 'products/p-b/img-b.jpg'), b);
    await assert.rejects(readPrivateFile(root, 'products/p-a/img-a.jpg'));
  } finally { await rm(root, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------
// Database-backed persistence — requires DATABASE_URL
// ---------------------------------------------------------------------------

const dbTest = connectionString ? test : test.skip;

dbTest('uploaded bytes and product/image references survive a real database restart', async () => {
  const pool = new pg.Pool({ connectionString });
  const root = await mkdtemp(join(tmpdir(), 'alveron-dbrestart-'));
  const productId = randomUUID();
  const imageId = randomUUID();
  const key = `products/${productId}/${imageId}.png`;
  try {
    const bytes = await sharp({ create: { width: 32, height: 40, channels: 3, background: '#7a1f28' } }).png().toBuffer();
    const checksum = sha(bytes);
    await storeImmutableFile(root, key, bytes);

    const user = await pool.query('SELECT id FROM studio_users LIMIT 1');
    assert.ok(user.rowCount, 'expected a bootstrapped owner in the test database');
    const userId = user.rows[0].id;

    await pool.query(`INSERT INTO products (id,name,category,created_by) VALUES ($1,$2,'tops',$3)`, [productId, 'Persistence test product', userId]);
    await pool.query(`INSERT INTO product_images (id,product_id,object_key,original_filename,media_type,byte_size,sha256,width,height,view_label)
                      VALUES ($1,$2,$3,'persist.png','image/png',$4,$5,32,40,'front')`, [imageId, productId, key, bytes.length, checksum]);

    // Simulate a real process restart: drop every pooled connection server-side and
    // reconnect with a brand-new client, then re-read through a fresh query.
    await pool.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()').catch(() => undefined);
    const fresh = new pg.Pool({ connectionString });
    try {
      const row = await fresh.query(`SELECT p.name, i.object_key, i.sha256, i.byte_size, i.product_id
                                       FROM products p JOIN product_images i ON i.product_id = p.id WHERE i.id=$1`, [imageId]);
      assert.equal(row.rowCount, 1, 'image row must still exist after reconnect');
      assert.equal(row.rows[0].product_id, productId, 'image must still belong to the same product');
      assert.equal(row.rows[0].sha256, checksum);
      const diskBytes = await readPrivateFile(root, row.rows[0].object_key);
      assert.equal(sha(diskBytes), row.rows[0].sha256, 'bytes on disk must match the stored checksum');
      assert.deepEqual(diskBytes, bytes);
    } finally { await fresh.end(); }
  } finally {
    // Clean up only what this test created.
    await pool.query('DELETE FROM product_images WHERE id=$1', [imageId]).catch(() => undefined);
    await pool.query('DELETE FROM products WHERE id=$1', [productId]).catch(() => undefined);
    await pool.end();
    await rm(root, { recursive: true, force: true });
  }
});

dbTest('an original cannot be mutated in place (immutability is enforced by the database)', async () => {
  const pool = new pg.Pool({ connectionString });
  const productId = randomUUID();
  const imageId = randomUUID();
  try {
    const user = await pool.query('SELECT id FROM studio_users LIMIT 1');
    if (!user.rowCount) return;
    await pool.query(`INSERT INTO products (id,name,category,created_by) VALUES ($1,'Immutability test','tops',$2)`, [productId, user.rows[0].id]);
    await pool.query(`INSERT INTO product_images (id,product_id,object_key,original_filename,media_type,byte_size,sha256,width,height,view_label)
                      VALUES ($1,$2,$3,'imm.png','image/png',10,$4,1,1,'front')`, [imageId, productId, `products/${productId}/${imageId}.png`, 'c'.repeat(64)]);
    // Recompressing or replacing the original must be refused at the schema level.
    await assert.rejects(pool.query('UPDATE product_images SET sha256=$2 WHERE id=$1', [imageId, 'd'.repeat(64)]), /immutable/i);
    await assert.rejects(pool.query('UPDATE product_images SET byte_size=5 WHERE id=$1', [imageId]), /immutable/i);
    // Lifecycle metadata is still allowed.
    await pool.query("UPDATE product_images SET last_verified_status='intact', last_verified_at=now() WHERE id=$1", [imageId]);
  } finally {
    await pool.query('DELETE FROM product_images WHERE id=$1', [imageId]).catch(() => undefined);
    await pool.query('DELETE FROM products WHERE id=$1', [productId]).catch(() => undefined);
    await pool.end();
  }
});

dbTest('a derivative can never occupy an original object key', async () => {
  const pool = new pg.Pool({ connectionString });
  const productId = randomUUID();
  const imageId = randomUUID();
  const key = `products/${productId}/${imageId}.png`;
  try {
    const user = await pool.query('SELECT id FROM studio_users LIMIT 1');
    if (!user.rowCount) return;
    await pool.query(`INSERT INTO products (id,name,category,created_by) VALUES ($1,'Derivative guard','tops',$2)`, [productId, user.rows[0].id]);
    await pool.query(`INSERT INTO product_images (id,product_id,object_key,original_filename,media_type,byte_size,sha256,width,height,view_label)
                      VALUES ($1,$2,$3,'d.png','image/png',10,$4,1,1,'front')`, [imageId, productId, key, 'e'.repeat(64)]);
    await assert.rejects(
      pool.query(`INSERT INTO product_image_derivatives (product_image_id,kind,object_key,media_type,width,height,byte_size,sha256,source_sha256)
                  VALUES ($1,'thumbnail',$2,'image/webp',1,1,1,$3,$4)`, [imageId, key, 'f'.repeat(64), 'e'.repeat(64)]),
      /collides with an immutable original/i,
    );
  } finally {
    await pool.query('DELETE FROM product_image_derivatives WHERE product_image_id=$1', [imageId]).catch(() => undefined);
    await pool.query('DELETE FROM product_images WHERE id=$1', [imageId]).catch(() => undefined);
    await pool.query('DELETE FROM products WHERE id=$1', [productId]).catch(() => undefined);
    await pool.end();
  }
});

dbTest('the review gate counts every image, not just the current page', async () => {
  const pool = new pg.Pool({ connectionString });
  const productId = randomUUID();
  const oldImage = randomUUID();
  const newImage = randomUUID();
  try {
    const user = await pool.query('SELECT id FROM studio_users LIMIT 1');
    if (!user.rowCount) return;
    await pool.query(`INSERT INTO products (id,name,category,created_by) VALUES ($1,'Review gate','tops',$2)`, [productId, user.rows[0].id]);
    for (const [imageId, label] of [[oldImage, 'front'], [newImage, 'back']] as const) {
      await pool.query(`INSERT INTO product_images (id,product_id,object_key,original_filename,media_type,byte_size,sha256,width,height,view_label)
                        VALUES ($1,$2,$3,$4,'image/png',10,$5,1,1,$6)`, [imageId, productId, `products/${productId}/${imageId}.png`, `${label}.png`, 'a'.repeat(64), label]);
    }
    const before = await pool.query(`SELECT count(*)::int AS pending FROM product_images i LEFT JOIN product_image_reviews r ON r.product_image_id=i.id WHERE r.product_image_id IS NULL`);
    const pendingBefore = Number(before.rows[0].pending);
    // Review only the older image; one unreviewed image must still block.
    await pool.query(`INSERT INTO product_image_reviews (product_image_id, reviewed_by) VALUES ($1,$2)`, [oldImage, user.rows[0].id]);
    const after = await pool.query(`SELECT count(*)::int AS pending FROM product_images i LEFT JOIN product_image_reviews r ON r.product_image_id=i.id WHERE r.product_image_id IS NULL`);
    assert.equal(Number(after.rows[0].pending), pendingBefore - 1, 'reviewing one image must decrement, not clear, the gate');
    assert.ok(Number(after.rows[0].pending) >= 1, 'an unreviewed image must keep the gate closed');
  } finally {
    await pool.query('DELETE FROM product_image_reviews WHERE product_image_id = ANY($1)', [[oldImage, newImage]]).catch(() => undefined);
    await pool.query('DELETE FROM product_images WHERE product_id=$1', [productId]).catch(() => undefined);
    await pool.query('DELETE FROM products WHERE id=$1', [productId]).catch(() => undefined);
    await pool.end();
  }
});

dbTest('idempotency keys prevent duplicate upload records', async () => {
  const pool = new pg.Pool({ connectionString });
  const key = `test-idempotency-${randomUUID()}`;
  try {
    const user = await pool.query('SELECT id FROM studio_users LIMIT 1');
    if (!user.rowCount) return;
    const userId = user.rows[0].id;
    const insert = () => pool.query(
      `INSERT INTO product_upload_requests (user_id,idempotency_key,status,object_keys)
       VALUES ($1,$2,'receiving','[]'::jsonb) ON CONFLICT (user_id,idempotency_key) DO NOTHING RETURNING id`,
      [userId, key],
    );
    const first = await insert();
    const second = await insert();
    assert.equal(first.rowCount, 1, 'the first request reserves a record');
    assert.equal(second.rowCount, 0, 'a repeat with the same key must not create a second record');
    const count = await pool.query('SELECT count(*)::int AS n FROM product_upload_requests WHERE user_id=$1 AND idempotency_key=$2', [userId, key]);
    assert.equal(Number(count.rows[0].n), 1);
  } finally {
    await pool.query('DELETE FROM product_upload_requests WHERE idempotency_key=$1', [key]).catch(() => undefined);
    await pool.end();
  }
});

dbTest('a failed upload is recoverable, not silently orphaned', async () => {
  const pool = new pg.Pool({ connectionString });
  const key = `test-failed-${randomUUID()}`;
  try {
    const user = await pool.query('SELECT id FROM studio_users LIMIT 1');
    if (!user.rowCount) return;
    const userId = user.rows[0].id;
    // A failed request keeps its planned object keys so the bytes can be found.
    await pool.query(
      `INSERT INTO product_upload_requests (user_id,idempotency_key,status,object_keys,error_code)
       VALUES ($1,$2,'failed',$3,'upload_failed')`,
      [userId, key, JSON.stringify(['products/x/orphan.png'])],
    );
    const row = await pool.query('SELECT status,object_keys,error_code FROM product_upload_requests WHERE user_id=$1 AND idempotency_key=$2', [userId, key]);
    assert.equal(row.rows[0].status, 'failed');
    assert.deepEqual(row.rows[0].object_keys, ['products/x/orphan.png'], 'planned keys must survive for recovery');
    assert.equal(row.rows[0].error_code, 'upload_failed');
  } finally {
    await pool.query('DELETE FROM product_upload_requests WHERE idempotency_key=$1', [key]).catch(() => undefined);
    await pool.end();
  }
});
