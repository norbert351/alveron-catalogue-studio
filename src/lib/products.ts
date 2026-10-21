import 'server-only';
import { getPool } from './db';
import { PRODUCT_CATEGORIES } from './product-rules';

export type ProductCard = {
  id: string;
  name: string;
  sku: string | null;
  category: (typeof PRODUCT_CATEGORIES)[number];
  color: string | null;
  fabric: string | null;
  pattern: string | null;
  fit: string | null;
  notes: string | null;
  tags: string[];
  availability: 'active' | 'unavailable' | 'archived';
  created_at: string;
  images: Array<{ id: string; view_label: string; original_filename: string; media_type: string; byte_size: number; sha256: string; created_at: string; width: number; height: number; reviewed: boolean; current: boolean; has_thumbnail: boolean }>;
};

export async function listProducts(): Promise<ProductCard[]> {
  const result = await getPool().query<{
    id: string; name: string; sku: string | null; category: ProductCard['category']; color: string | null;
    fabric: string | null; pattern: string | null; fit: string | null; notes: string | null; tags: string[]; availability: ProductCard['availability']; created_at: Date;
    image_id: string | null; view_label: string | null; original_filename: string | null; media_type: string | null; byte_size: string | null; sha256: string | null; image_created_at: Date | null; width: number | null; height: number | null; reviewed: boolean; is_current: boolean | null; has_thumbnail: boolean;
  }>(`
    SELECT p.id, p.name, p.sku, p.category, p.color, p.fabric, p.pattern, p.fit, p.notes, p.tags, p.availability, p.created_at,
           i.id AS image_id, i.view_label, i.original_filename, i.media_type, i.byte_size, i.sha256, i.created_at AS image_created_at,
           i.width, i.height, i.is_current, (r.product_image_id IS NOT NULL) AS reviewed,
           EXISTS (SELECT 1 FROM product_image_derivatives d WHERE d.product_image_id = i.id AND d.kind = 'thumbnail') AS has_thumbnail
      FROM products p
      LEFT JOIN product_images i ON i.product_id = p.id
      LEFT JOIN product_image_reviews r ON r.product_image_id = i.id
     ORDER BY p.created_at DESC, p.id, i.created_at ASC, i.id`);
  const products = new Map<string, ProductCard>();
  for (const row of result.rows) {
    let product = products.get(row.id);
    if (!product) {
      product = { id: row.id, name: row.name, sku: row.sku, category: row.category, color: row.color, fabric: row.fabric, pattern: row.pattern, fit: row.fit, notes: row.notes, tags: row.tags ?? [], availability: row.availability ?? 'active', created_at: row.created_at.toISOString(), images: [] };
      products.set(row.id, product);
    }
    if (row.image_id) product.images.push({ id: row.image_id, view_label: row.view_label ?? 'Product view', original_filename: row.original_filename ?? 'original image', media_type: row.media_type ?? 'application/octet-stream', byte_size: Number(row.byte_size ?? 0), sha256: row.sha256 ?? '', created_at: row.image_created_at?.toISOString() ?? '', width: row.width ?? 0, height: row.height ?? 0, reviewed: row.reviewed, current: row.is_current ?? true, has_thumbnail: row.has_thumbnail === true });
  }
  return [...products.values()];
}

export async function allImagesReviewed(): Promise<boolean> {
  const result = await getPool().query(`
    SELECT NOT EXISTS (
      SELECT 1 FROM product_images i
      LEFT JOIN product_image_reviews r ON r.product_image_id = i.id
      WHERE r.product_image_id IS NULL
    ) AS complete`);
  return result.rows[0]?.complete === true;
}

/**
 * One page of the product library, plus the true total so the UI can show
 * "x of y" and reach every product. Filtering happens in SQL, so a filter never
 * hides unreachable pages of matches.
 *
 * Note: the review gate is intentionally NOT paginated (see allImagesReviewed /
 * countUnreviewedImages) so older, off-page images still block outfit creation
 * until reviewed.
 */
export async function listProductsPaged(options: {
  page: number;
  pageSize: number;
  search?: string;
  category?: string;
  availability?: string;
  uploadedFrom?: string;
  uploadedThrough?: string;
  includeArchived?: boolean;
}): Promise<{ products: ProductCard[]; total: number }> {
  const conditions: string[] = [];
  const values: unknown[] = [];

  if (!options.includeArchived) conditions.push("p.availability <> 'archived'");
  if (options.search) {
    values.push(`%${options.search.replace(/[%_\\]/g, (character) => `\\${character}`)}%`);
    conditions.push(`(p.name ILIKE $${values.length} OR p.color ILIKE $${values.length} OR p.sku ILIKE $${values.length} OR EXISTS (SELECT 1 FROM unnest(p.tags) t WHERE t ILIKE $${values.length}))`);
  }
  if (options.category) { values.push(options.category); conditions.push(`p.category = $${values.length}`); }
  if (options.availability) { values.push(options.availability); conditions.push(`p.availability = $${values.length}`); }
  if (options.uploadedFrom) { values.push(options.uploadedFrom); conditions.push(`p.created_at >= $${values.length}::date`); }
  if (options.uploadedThrough) { values.push(options.uploadedThrough); conditions.push(`p.created_at < ($${values.length}::date + interval '1 day')`); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const pool = getPool();
  const totalResult = await pool.query(`SELECT count(*)::int AS total FROM products p ${where}`, values);
  const total = Number(totalResult.rows[0]?.total ?? 0);

  values.push(options.pageSize, (Math.max(1, options.page) - 1) * options.pageSize);
  const rows = await pool.query(`
    SELECT p.id, p.name, p.sku, p.category, p.color, p.fabric, p.pattern, p.fit, p.notes, p.tags, p.availability, p.created_at,
           i.id AS image_id, i.view_label, i.original_filename, i.media_type, i.byte_size, i.sha256, i.created_at AS image_created_at,
           i.width, i.height, i.is_current, (r.product_image_id IS NOT NULL) AS reviewed,
           EXISTS (SELECT 1 FROM product_image_derivatives d WHERE d.product_image_id = i.id AND d.kind = 'thumbnail') AS has_thumbnail
      FROM (
        SELECT p.* FROM products p ${where}
        ORDER BY p.created_at DESC, p.id
        LIMIT $${values.length - 1} OFFSET $${values.length}
      ) p
      LEFT JOIN product_images i ON i.product_id = p.id
      LEFT JOIN product_image_reviews r ON r.product_image_id = i.id
     ORDER BY p.created_at DESC, p.id, i.created_at ASC, i.id`, values);

  const products = new Map<string, ProductCard>();
  for (const row of rows.rows) {
    let product = products.get(row.id);
    if (!product) {
      product = { id: row.id, name: row.name, sku: row.sku, category: row.category, color: row.color, fabric: row.fabric, pattern: row.pattern, fit: row.fit, notes: row.notes, tags: row.tags ?? [], availability: row.availability ?? 'active', created_at: row.created_at.toISOString(), images: [] };
      products.set(row.id, product);
    }
    if (row.image_id) product.images.push({ id: row.image_id, view_label: row.view_label ?? 'Product view', original_filename: row.original_filename ?? 'original image', media_type: row.media_type ?? 'application/octet-stream', byte_size: Number(row.byte_size ?? 0), sha256: row.sha256 ?? '', created_at: row.image_created_at?.toISOString() ?? '', width: row.width ?? 0, height: row.height ?? 0, reviewed: row.reviewed, current: row.is_current ?? true, has_thumbnail: row.has_thumbnail === true });
  }
  return { products: [...products.values()], total };
}
