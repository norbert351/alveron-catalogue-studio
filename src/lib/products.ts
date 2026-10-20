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
  created_at: string;
  images: Array<{ id: string; view_label: string; width: number; height: number; reviewed: boolean }>;
};

export async function listProducts(): Promise<ProductCard[]> {
  const result = await getPool().query<{
    id: string; name: string; sku: string | null; category: ProductCard['category']; color: string | null;
    fabric: string | null; pattern: string | null; fit: string | null; notes: string | null; created_at: Date;
    image_id: string | null; view_label: string | null; width: number | null; height: number | null; reviewed: boolean;
  }>(`
    SELECT p.id, p.name, p.sku, p.category, p.color, p.fabric, p.pattern, p.fit, p.notes, p.created_at,
           i.id AS image_id, i.view_label, i.width, i.height, (r.product_image_id IS NOT NULL) AS reviewed
      FROM products p
      LEFT JOIN product_images i ON i.product_id = p.id
      LEFT JOIN product_image_reviews r ON r.product_image_id = i.id
     ORDER BY p.created_at ASC, p.id, i.created_at ASC, i.id`);
  const products = new Map<string, ProductCard>();
  for (const row of result.rows) {
    let product = products.get(row.id);
    if (!product) {
      product = { id: row.id, name: row.name, sku: row.sku, category: row.category, color: row.color, fabric: row.fabric, pattern: row.pattern, fit: row.fit, notes: row.notes, created_at: row.created_at.toISOString(), images: [] };
      products.set(row.id, product);
    }
    if (row.image_id) product.images.push({ id: row.image_id, view_label: row.view_label ?? 'Product view', width: row.width ?? 0, height: row.height ?? 0, reviewed: row.reviewed });
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
