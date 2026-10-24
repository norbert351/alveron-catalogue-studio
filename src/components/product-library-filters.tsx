'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';

/**
 * Server-driven library filters.
 *
 * Filtering runs in SQL (see listProductsPaged), not by hiding DOM nodes, so a
 * filter can never miss a match that lives on another page. The URL is the
 * source of truth: filters survive refresh and can be bookmarked.
 *
 * Archived products are opt-in: by default the library hides them so reviewing
 * ordinary inventory is not cluttered, but they remain reachable via the
 * Availability filter.
 */
export function ProductLibraryFilters() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState(searchParams.get('availability') ?? 'all');
  const [from, setFrom] = useState(searchParams.get('uploadedFrom') ?? '');
  const [to, setTo] = useState(searchParams.get('uploadedThrough') ?? '');

  function push(next: { status?: string; from?: string; to?: string }) {
    const values = { status, from, to, ...next };
    const params = new URLSearchParams();
    if (values.status !== 'all') params.set('availability', values.status);
    if (values.from) params.set('uploadedFrom', values.from);
    if (values.to) params.set('uploadedThrough', values.to);
    const search = params.toString();
    // Any filter change returns to page 1 so results are not silently skipped.
    router.push(`/products${search ? `?${search}` : ''}`);
  }

  return <div className="mb-6 grid gap-3 border border-[#e3ded6] bg-white p-4 sm:grid-cols-3">
    <label className="text-[9px] text-[#77736d]">Availability<select value={status} onChange={(event) => { setStatus(event.target.value); push({ status: event.target.value }); }} className="field mt-1"><option value="all">Active and unavailable</option><option value="active">Active</option><option value="unavailable">Unavailable</option><option value="archived">Archived</option></select></label>
    <label className="text-[9px] text-[#77736d]">Uploaded from<input type="date" value={from} onChange={(event) => { setFrom(event.target.value); push({ from: event.target.value }); }} className="field mt-1" /></label>
    <label className="text-[9px] text-[#77736d]">Uploaded through<input type="date" value={to} onChange={(event) => { setTo(event.target.value); push({ to: event.target.value }); }} className="field mt-1" /></label>
  </div>;
}
