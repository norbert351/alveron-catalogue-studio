import 'server-only';
import { getPool } from './db';

/**
 * Pagination helpers.
 *
 * The library must never silently hide older products: a product the owner
 * cannot reach is a product whose images can never be reviewed, which would
 * permanently block outfit creation. Every list therefore reports the true total
 * and supports reaching any page.
 */

export const DEFAULT_PAGE_SIZE = 24;
export const MAX_PAGE_SIZE = 100;

export type PageRequest = { page: number; pageSize: number };

export function parsePageRequest(input: { page?: string | string[]; pageSize?: string | string[] }): PageRequest {
  const toPositive = (value: string | string[] | undefined, fallback: number, max?: number): number => {
    const raw = Array.isArray(value) ? value[0] : value;
    const parsed = Number.parseInt(raw ?? '', 10);
    if (!Number.isFinite(parsed) || parsed < 1) return fallback;
    return max ? Math.min(parsed, max) : parsed;
  };
  return {
    page: toPositive(input.page, 1),
    pageSize: toPositive(input.pageSize, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE),
  };
}

export type Page<T> = {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasPrevious: boolean;
  hasNext: boolean;
};

export function buildPage<T>(items: T[], request: PageRequest, total: number): Page<T> {
  const totalPages = Math.max(1, Math.ceil(total / request.pageSize));
  return {
    items,
    page: request.page,
    pageSize: request.pageSize,
    total,
    totalPages,
    hasPrevious: request.page > 1,
    hasNext: request.page < totalPages,
  };
}

/** Offset for SQL, clamped so an out-of-range page cannot request a negative offset. */
export function pageOffset(request: PageRequest): number {
  return (Math.max(1, request.page) - 1) * request.pageSize;
}

/**
 * Total number of images awaiting review across the whole inventory.
 * Deliberately unbounded by pagination: the review gate must consider every
 * accessible image, not just the ones on the current page.
 */
export async function countUnreviewedImages(): Promise<number> {
  const result = await getPool().query(
    `SELECT count(*)::int AS pending FROM product_images i
      LEFT JOIN product_image_reviews r ON r.product_image_id = i.id
      WHERE r.product_image_id IS NULL`,
  );
  return Number(result.rows[0]?.pending ?? 0);
}

/** True when every accessible image has been reviewed. Pagination-independent. */
export async function allImagesReviewedStrict(): Promise<boolean> {
  return (await countUnreviewedImages()) === 0;
}
