'use client';

import { useState } from 'react';

export function ProductLibraryFilters() {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [status, setStatus] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  function apply(next: { query?: string; category?: string; status?: string; from?: string; to?: string }) {
    const values = { query, category, status, from, to, ...next };
    for (const card of document.querySelectorAll<HTMLElement>('[data-product-card]')) {
      const text = (card.dataset.search ?? '').toLowerCase();
      const created = card.dataset.created ?? '';
      const match = (!values.query || text.includes(values.query.toLowerCase()))
        && (values.category === 'all' || card.dataset.category === values.category)
        && (values.status === 'all' || card.dataset.status === values.status)
        && (!values.from || created >= values.from)
        && (!values.to || created.slice(0, 10) <= values.to);
      card.hidden = !match;
    }
  }
  return <div className="mb-6 grid gap-3 border border-[#e3ded6] bg-white p-4 sm:grid-cols-2 xl:grid-cols-5">
    <label className="text-[9px] text-[#77736d] sm:col-span-2 xl:col-span-1">Search name, colour, tags<input value={query} onChange={(event) => { setQuery(event.target.value); apply({ query: event.target.value }); }} placeholder="Search inventory" className="field mt-1" /></label>
    <label className="text-[9px] text-[#77736d]">Category<select value={category} onChange={(event) => { setCategory(event.target.value); apply({ category: event.target.value }); }} className="field mt-1"><option value="all">All categories</option>{['tops', 'bottoms', 'outerwear', 'shoes', 'accessories', 'sets', 'other'].map((item) => <option key={item}>{item}</option>)}</select></label>
    <label className="text-[9px] text-[#77736d]">Availability<select value={status} onChange={(event) => { setStatus(event.target.value); apply({ status: event.target.value }); }} className="field mt-1"><option value="all">All availability</option><option value="active">Active</option><option value="unavailable">Unavailable</option><option value="archived">Archived</option></select></label>
    <label className="text-[9px] text-[#77736d]">Uploaded from<input type="date" value={from} onChange={(event) => { setFrom(event.target.value); apply({ from: event.target.value }); }} className="field mt-1" /></label>
    <label className="text-[9px] text-[#77736d]">Uploaded through<input type="date" value={to} onChange={(event) => { setTo(event.target.value); apply({ to: event.target.value }); }} className="field mt-1" /></label>
  </div>;
}
