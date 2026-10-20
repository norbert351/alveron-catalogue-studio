'use client';

import { useState } from 'react';
import type { ProductCard } from '@/lib/products';

const categories = ['tops', 'bottoms', 'outerwear', 'shoes', 'accessories', 'sets', 'other'];

export function ProductManagementControls({ product }: { product: ProductCard }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  async function save(form: FormData) {
    if (form.get('availability') === 'archived' && product.availability !== 'archived' && !window.confirm(`Archive “${product.name}”? Its photos and product history will remain in the private studio.`)) return;
    setBusy(true); setError(''); setSaved(false);
    try {
      const response = await fetch(`/api/products/${product.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(form)) });
      const result = await response.json() as { error?: string };
      if (!response.ok) setError(result.error ?? 'Product update failed.');
      else { setSaved(true); window.location.reload(); }
    } catch { setError('Could not reach the studio.'); }
    finally { setBusy(false); }
  }
  return <div className="flex flex-wrap items-center gap-2">
    <span className={`border px-2 py-1 text-[8px] uppercase tracking-[0.1em] ${product.availability === 'active' ? 'border-[#d7e4d5] text-[#477047]' : 'border-[#e2ddd5] text-[#77736d]'}`}>{product.availability}</span>
    <button type="button" onClick={() => setOpen((value) => !value)} className="border border-[#ded8cf] px-2 py-1 text-[9px] hover:border-[#b6222b]">Edit details</button>
    {open && <form className="mt-3 grid w-full gap-3 border border-[#e3ded6] bg-[#faf9f6] p-4 sm:grid-cols-2" action={save}>
      <label className="text-[9px]">Product name<input name="name" required minLength={2} maxLength={100} defaultValue={product.name} className="field mt-1" /></label>
      <label className="text-[9px]">SKU<input name="sku" maxLength={60} defaultValue={product.sku ?? ''} className="field mt-1" /></label>
      <label className="text-[9px]">Category<select name="category" defaultValue={product.category} className="field mt-1">{categories.map((category) => <option key={category} value={category}>{category}</option>)}</select></label>
      <label className="text-[9px]">Availability<select name="availability" defaultValue={product.availability} className="field mt-1"><option value="active">Active</option><option value="unavailable">Unavailable</option><option value="archived">Archived</option></select></label>
      <label className="text-[9px]">Owner-entered colour<input name="color" maxLength={80} defaultValue={product.color ?? ''} className="field mt-1" /></label>
      <label className="text-[9px]">Owner-entered pattern<input name="pattern" maxLength={120} defaultValue={product.pattern ?? ''} className="field mt-1" /></label>
      <label className="text-[9px]">Fabric appearance<input name="fabric" maxLength={120} defaultValue={product.fabric ?? ''} className="field mt-1" /></label>
      <label className="text-[9px]">Fit / cut<input name="fit" maxLength={120} defaultValue={product.fit ?? ''} className="field mt-1" /></label>
      <label className="text-[9px] sm:col-span-2">Tags, separated by commas<input name="tags" maxLength={500} defaultValue={product.tags.join(', ')} className="field mt-1" /></label>
      <label className="text-[9px] sm:col-span-2">Owner notes<textarea name="notes" maxLength={1000} defaultValue={product.notes ?? ''} rows={2} className="field mt-1" /></label>
      <p className="text-[9px] leading-relaxed text-[#938e86] sm:col-span-2">These values are owner-entered metadata. Visual attributes remain unverified until confirmed against all original image views.</p>
      {error && <p role="alert" className="text-[10px] text-[#a3242b] sm:col-span-2">{error}</p>}
      {saved && <p role="status" className="text-[10px] text-[#477047]">Saved.</p>}
      <div className="flex gap-2 sm:col-span-2"><button disabled={busy} className="bg-[#171717] px-4 py-2 text-[9px] text-white disabled:opacity-50">{busy ? 'Saving…' : 'Save product'}</button><button type="button" onClick={() => setOpen(false)} className="border border-[#ded8cf] px-4 py-2 text-[9px]">Cancel</button></div>
    </form>}
  </div>;
}
