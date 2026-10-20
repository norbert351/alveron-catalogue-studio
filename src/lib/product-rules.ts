import { z } from 'zod';

export const PRODUCT_CATEGORIES = ['tops', 'bottoms', 'outerwear', 'shoes', 'accessories', 'sets', 'other'] as const;
export const productInputSchema = z.object({
  name: z.string().trim().min(2).max(100),
  sku: z.string().trim().max(60).optional().transform((value) => value || null),
  category: z.enum(PRODUCT_CATEGORIES),
  color: z.string().trim().max(80).optional().transform((value) => value || null),
  fabric: z.string().trim().max(120).optional().transform((value) => value || null),
  pattern: z.string().trim().max(120).optional().transform((value) => value || null),
  fit: z.string().trim().max(120).optional().transform((value) => value || null),
  notes: z.string().trim().max(1000).optional().transform((value) => value || null),
  tags: z.preprocess((value) => Array.isArray(value) ? value.join(',') : value, z.string().max(500).optional().default('')).transform((value) => [...new Set(value.split(',').map((tag) => tag.trim().toLowerCase()).filter(Boolean))].slice(0, 20)),
});
