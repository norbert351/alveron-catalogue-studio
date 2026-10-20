'use client';

import { useState } from 'react';
import type { ProductCard } from '@/lib/products';

const options = ['front', 'back', 'side', 'close-up', 'detail', 'colour/design'];

export function ProductImageUpload({ product }: { product: ProductCard }) {
  const productId = product.id;
  const [files, setFiles] = useState<File[]>([]);
  const [labels, setLabels] = useState<string[]>([]);
  const [replaces, setReplaces] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return <form className="mt-3 flex flex-col gap-2 border border-dashed border-[#ded8cf] bg-[#faf9f6] p-3 sm:flex-row sm:items-center" onSubmit={async (event) => {
    event.preventDefault(); setBusy(true); setError('');
    const body = new FormData(); files.forEach((file) => body.append('images', file, file.name)); labels.forEach((label) => body.append('viewLabels', label)); replaces.forEach((id) => body.append('replacesImageIds', id));
    try {
      const response = await fetch(`/api/products/${productId}/images`, { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body });
      const result = await response.json() as { error?: string };
      if (!response.ok) setError(result.error ?? 'Images could not be added.'); else window.location.reload();
    } catch { setError('Could not reach the studio.'); }
    finally { setBusy(false); }
  }}>
    <label className="flex-1 text-[9px] text-[#77736d]">Add image versions / new views<input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(event) => {
      const selected = Array.from(event.target.files ?? []).slice(0, 5); setFiles(selected); setLabels(selected.map((_, index) => options[index])); setReplaces(selected.map(() => ''));
      if ((event.target.files?.length ?? 0) > 5) setError('Choose up to five views at a time.');
    }} className="mt-1 block w-full text-[9px]" /></label>
    {files.map((file, index) => <div key={`${file.name}-${file.lastModified}`} className="flex flex-wrap items-center gap-1 text-[8px] text-[#77736d]"><span className="max-w-24 truncate">{file.name}</span><select aria-label="New image view" value={labels[index]} onChange={(event) => setLabels((current) => current.map((label, at) => at === index ? event.target.value : label))} className="border border-[#ded8cf] bg-white p-1">{options.map((option) => <option key={option}>{option}</option>)}</select><select aria-label="Replace an existing view (optional)" value={replaces[index]} onChange={(event) => setReplaces((current) => current.map((id, at) => at === index ? event.target.value : id))} className="border border-[#ded8cf] bg-white p-1"><option value="">Add as new view</option>{product.images.filter((image) => image.current).map((image) => <option key={image.id} value={image.id}>Replace {image.view_label}</option>)}</select></div>)}
    <button disabled={!files.length || busy} className="bg-[#171717] px-3 py-2 text-[9px] text-white disabled:opacity-40">{busy ? 'Saving…' : 'Add original views'}</button>
    {error && <p role="alert" className="w-full text-[9px] text-[#a3242b]">{error}</p>}
    <p className="w-full text-[8px] text-[#938e86]">Each new view remains a separate original and returns the inventory to image review.</p>
  </form>;
}
