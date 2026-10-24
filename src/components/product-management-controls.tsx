'use client';

import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import type { ProductCard } from '@/lib/products';

export function ProductManagementControls({ product }: { product: ProductCard }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  async function remove() {
    if (!window.confirm('Delete this product and all of its original photos permanently? This cannot be undone.')) return;
    setBusy(true); setError(''); setSaved(false);
    try {
      const response = await fetch(`/api/products/${product.id}`, { method: 'DELETE' });
      const result = await response.json().catch(() => ({})) as { error?: string; objectsFailed?: string[] };
      if (!response.ok) setError(result.error ?? 'Product could not be deleted.');
      else {
        if (result.objectsFailed?.length) window.alert('Product deleted. Some stored files could not be removed and are listed in Upload Health.');
        window.location.reload();
      }
    } catch { setError('Could not reach the studio.'); }
    finally { setBusy(false); }
  }
  async function save(form: FormData) {
    if (form.get('availability') === 'archived' && product.availability !== 'archived' && !window.confirm('Archive this product? Its photos and product history will remain in the private studio.')) return;
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
    <button type="button" onClick={() => setOpen((value) => !value)} className="border border-[#ded8cf] px-2 py-1 text-[9px] hover:border-[#b6222b]">Availability</button>
    <button type="button" onClick={remove} disabled={busy} className="flex items-center gap-1 border border-[#e3c8c8] px-2 py-1 text-[9px] text-[#a3242b] hover:border-[#b6222b] disabled:opacity-40"><Trash2 size={10} /> Delete</button>
    {open && <form className="mt-3 grid w-full gap-3 border border-[#e3ded6] bg-[#faf9f6] p-4" action={save}>
      <label className="text-[9px]">Availability<select name="availability" defaultValue={product.availability} className="field mt-1"><option value="active">Active</option><option value="unavailable">Unavailable</option><option value="archived">Archived</option></select></label>
      {saved && <p role="status" className="text-[10px] text-[#477047]">Saved.</p>}
      <div className="flex gap-2"><button disabled={busy} className="bg-[#171717] px-4 py-2 text-[9px] text-white disabled:opacity-50">{busy ? 'Saving…' : 'Save availability'}</button><button type="button" onClick={() => setOpen(false)} className="border border-[#ded8cf] px-4 py-2 text-[9px]">Cancel</button></div>
    </form>}
    {error && <p role="alert" className="w-full text-[10px] text-[#a3242b]">{error}</p>}
  </div>;
}
