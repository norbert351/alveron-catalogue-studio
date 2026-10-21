/**
 * Seeds N throwaway products (with one image each, no file bytes needed) so the
 * product-library pagination can be exercised for real. Prints the created IDs so
 * they can be removed again with --cleanup.
 *
 * Usage:
 *   node --conditions=react-server --env-file-if-exists=.env.local --import tsx scripts/seed-pagination-check.mts --count 30
 *   node --conditions=react-server --env-file-if-exists=.env.local --import tsx scripts/seed-pagination-check.mts --cleanup
 */
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { env } from '../src/lib/config';

const args = process.argv.slice(2);
const argValue = (name: string) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
const count = Number(argValue('--count') ?? 30);
const cleanup = args.includes('--cleanup');

if (!env.DATABASE_URL) { console.error('DATABASE_URL is required.'); process.exit(2); }
const pool = new pg.Pool({ connectionString: env.DATABASE_URL });
const PREFIX = 'Pagination-check product';

try {
  if (cleanup) {
    const images = await pool.query('DELETE FROM product_images WHERE product_id IN (SELECT id FROM products WHERE name LIKE $1) RETURNING id', [`${PREFIX}%`]);
    const products = await pool.query('DELETE FROM products WHERE name LIKE $1 RETURNING id', [`${PREFIX}%`]);
    console.log(`Removed ${products.rowCount} seeded products and ${images.rowCount} images.`);
  } else {
    const user = await pool.query('SELECT id FROM studio_users LIMIT 1');
    if (!user.rowCount) { console.error('No owner account found; bootstrap first.'); process.exit(2); }
    const userId = user.rows[0].id;
    for (let index = 1; index <= count; index += 1) {
      const productId = randomUUID();
      const imageId = randomUUID();
      await pool.query(
        `INSERT INTO products (id,name,category,color,tags,created_by) VALUES ($1,$2,$3,$4,$5,$6)`,
        [productId, `${PREFIX} ${String(index).padStart(3, '0')}`, index % 2 ? 'tops' : 'bottoms', index % 3 ? 'black' : 'charcoal', ['pagination', `batch-${Math.ceil(index / 10)}`], userId],
      );
      await pool.query(
        `INSERT INTO product_images (id,product_id,object_key,original_filename,media_type,byte_size,sha256,width,height,view_label)
         VALUES ($1,$2,$3,'seed.png','image/png',1,$4,1,1,'front')`,
        [imageId, productId, `products/${productId}/${imageId}.png`, '0'.repeat(64)],
      );
    }
    console.log(`Seeded ${count} products. Products now total: ${(await pool.query('SELECT count(*)::int AS n FROM products')).rows[0].n}`);
  }
} finally { await pool.end(); }
