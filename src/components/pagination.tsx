import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * Page navigation for the product library.
 *
 * Renders links rather than client-side state so the current page, filters and
 * search survive a refresh and can be bookmarked. Every page is reachable, so no
 * product — and therefore no image needing review — is ever silently excluded.
 */
export function Pagination({
  page,
  totalPages,
  total,
  pageSize,
  basePath = '/products',
  query = {},
}: {
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
  basePath?: string;
  query?: Record<string, string | undefined>;
}) {
  const href = (target: number) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== '') params.set(key, value);
    }
    if (target > 1) params.set('page', String(target));
    const search = params.toString();
    return `${basePath}${search ? `?${search}` : ''}`;
  };

  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

  // Window of up to 5 page links around the current page.
  const start = Math.max(1, Math.min(page - 2, totalPages - 4));
  const end = Math.min(totalPages, start + 4);
  const numbers = Array.from({ length: Math.max(0, end - start + 1) }, (_, index) => start + index);

  return (
    <nav aria-label="Product library pages" className="mt-8 flex flex-col gap-3 border-t border-[#e3ded6] pt-5 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-[9px] uppercase tracking-[0.12em] text-[#938e86]">
        Showing {first}–{last} of {total} {total === 1 ? 'product' : 'products'}
      </p>
      {totalPages > 1 && <div className="flex items-center gap-1">
        {page > 1 ? <Link href={href(page - 1)} className="flex h-7 items-center gap-1 border border-[#e2ddd5] px-2 text-[9px] text-[#504b46] hover:border-[#171717]" rel="prev"><ChevronLeft size={12} /> Previous</Link> : <span className="flex h-7 items-center gap-1 border border-[#f0ece5] px-2 text-[9px] text-[#c4bfb7]"><ChevronLeft size={12} /> Previous</span>}
        {numbers.map((number) => number === page
          ? <span key={number} aria-current="page" className="flex h-7 min-w-7 items-center justify-center bg-[#171717] px-2 text-[9px] text-white">{number}</span>
          : <Link key={number} href={href(number)} className="flex h-7 min-w-7 items-center justify-center border border-[#e2ddd5] px-2 text-[9px] text-[#504b46] hover:border-[#171717]">{number}</Link>)}
        {page < totalPages ? <Link href={href(page + 1)} className="flex h-7 items-center gap-1 border border-[#e2ddd5] px-2 text-[9px] text-[#504b46] hover:border-[#171717]" rel="next">Next <ChevronRight size={12} /></Link> : <span className="flex h-7 items-center gap-1 border border-[#f0ece5] px-2 text-[9px] text-[#c4bfb7]">Next <ChevronRight size={12} /></span>}
      </div>}
    </nav>
  );
}
