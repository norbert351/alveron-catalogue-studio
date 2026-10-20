import { z } from 'zod';

export const catalogueInputSchema = z.object({
  title: z.string().trim().min(2).max(120),
  style: z.enum(['modern-tailoring', 'smart-casual', 'weekend-casual', 'elevated-streetwear']),
  occasion: z.enum(['workwear', 'evening', 'weekend', 'travel']),
  mixedStyleRequested: z.boolean().default(false),
  items: z.array(z.object({
    productId: z.uuid(),
    imageId: z.uuid(),
    role: z.enum(['top', 'bottom', 'outerwear', 'shoes', 'accessory', 'set']),
  })).min(2).max(5),
})
  .refine((value) => new Set(value.items.map((item) => item.productId)).size === value.items.length, { message: 'Select each product only once.' })
  .refine((value) => value.items.some((item) => item.role === 'set') || (value.items.some((item) => item.role === 'top') && value.items.some((item) => item.role === 'bottom')), { message: 'A complete look needs a top and bottom, or an uploaded set.' });

export type CatalogueInput = z.infer<typeof catalogueInputSchema>;
