import 'server-only';
import { getPool } from './db';

export type CatalogueSummary = {
  id: string;
  title: string;
  style: string;
  occasion: string;
  mixed_style_requested: boolean;
  status: 'draft' | 'queued' | 'review' | 'approved' | 'exported';
  created_at: string;
  items: Array<{ product_id: string; product_name: string; image_id: string; image_sha256: string; role: string }>;
};

export async function listCatalogues(): Promise<CatalogueSummary[]> {
  const result = await getPool().query(`
    SELECT c.id, c.title, c.style, c.occasion, c.mixed_style_requested, c.status, c.created_at,
           COALESCE(json_agg(json_build_object(
             'product_id', p.id, 'product_name', p.name, 'image_id', i.id,
             'image_sha256', i.sha256, 'role', ci.outfit_role
           ) ORDER BY ci.position) FILTER (WHERE p.id IS NOT NULL), '[]'::json) AS items
      FROM catalogues c
      LEFT JOIN catalogue_items ci ON ci.catalogue_id = c.id
      LEFT JOIN products p ON p.id = ci.product_id
      LEFT JOIN product_images i ON i.id = ci.product_image_id
     GROUP BY c.id ORDER BY c.created_at DESC`);
  return result.rows.map((row) => ({ ...row, created_at: new Date(row.created_at).toISOString() })) as CatalogueSummary[];
}
