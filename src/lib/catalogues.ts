import 'server-only';
import { getPool } from './db';

export type CatalogueSummary = {
  id: string;
  title: string;
  style: string;
  occasion: string;
  mixed_style_requested: boolean;
  status: 'draft' | 'queued' | 'running' | 'review' | 'approved' | 'rejected' | 'exported' | 'failed';
  created_at: string;
  revision: number;
  rejection_reason: string | null;
  items: Array<{ product_id: string; product_name: string; image_id: string; image_sha256: string; role: string; view_label: string }>;
  assets: Array<{ id: string; sha256: string; width: number; height: number; media_type: string; output_kind: string; created_at: string; approved: boolean; approval_id: string | null; invalidated: boolean }>;
};

export async function listCatalogues(): Promise<CatalogueSummary[]> {
  const result = await getPool().query(`
    SELECT c.id, c.title, c.style, c.occasion, c.mixed_style_requested, c.status, c.created_at,c.revision,c.rejection_reason,
           COALESCE(json_agg(json_build_object(
             'product_id', p.id, 'product_name', p.name, 'image_id', i.id,
             'image_sha256', i.sha256, 'role', ci.outfit_role, 'view_label', i.view_label
           ) ORDER BY ci.position) FILTER (WHERE p.id IS NOT NULL), '[]'::json) AS items
      FROM catalogues c
      LEFT JOIN catalogue_items ci ON ci.catalogue_id = c.id
      LEFT JOIN products p ON p.id = ci.product_id
      LEFT JOIN product_images i ON i.id = ci.product_image_id
     GROUP BY c.id ORDER BY c.created_at DESC`);
  const assets = await getPool().query(`SELECT a.id,a.catalogue_id,a.sha256,a.width,a.height,a.media_type,a.output_kind,a.created_at,
    ap.id AS approval_id,ap.invalidated_at
    FROM generated_assets a LEFT JOIN LATERAL (SELECT id,invalidated_at FROM catalogue_approvals WHERE generated_asset_id=a.id ORDER BY approved_at DESC LIMIT 1) ap ON true
    ORDER BY a.created_at DESC`);
  const byCatalogue = new Map<string, CatalogueSummary['assets']>();
  for (const row of assets.rows) {
    const list = byCatalogue.get(row.catalogue_id) ?? [];
    list.push({ id: row.id, sha256: row.sha256, width: row.width, height: row.height, media_type: row.media_type, output_kind: row.output_kind, created_at: new Date(row.created_at).toISOString(), approval_id: row.approval_id, approved: Boolean(row.approval_id && !row.invalidated_at), invalidated: Boolean(row.invalidated_at) });
    byCatalogue.set(row.catalogue_id, list);
  }
  return result.rows.map((row) => ({ ...row, created_at: new Date(row.created_at).toISOString(), revision: Number(row.revision), assets: byCatalogue.get(row.id) ?? [] })) as CatalogueSummary[];
}
