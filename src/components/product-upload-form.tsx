'use client';

import { useRef, useState, type FormEvent } from 'react';
import { ImagePlus, LoaderCircle, Plus, Trash2, Upload } from 'lucide-react';
import { MAX_PRODUCTS_PER_BATCH } from '@/lib/upload-limits';

const viewLabels = ['front', 'back', 'side', 'close-up', 'detail'];
const viewNames = ['Front', 'Back', 'Side', 'Close-up', 'Detail'];
const MAX_IMAGES = 5;

type UploadGroup = {
  id: string;
  files: File[];
  status: 'idle' | 'saving' | 'saved' | 'error';
  error: string;
};

export function ProductUploadForm() {
  const [groups, setGroups] = useState<UploadGroup[]>([{ id: 'product-1', files: [], status: 'idle', error: '' }]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const nextId = useRef(2);
  const idempotencyKeys = useRef(new Map<string, string>());

  function addGroup() {
    setGroups((current) => current.length >= MAX_PRODUCTS_PER_BATCH
      ? current
      : [...current, { id: `product-${nextId.current++}`, files: [], status: 'idle', error: '' }]);
  }

  function removeGroup(id: string) {
    setGroups((current) => current.length === 1 ? current : current.filter((group) => group.id !== id));
    idempotencyKeys.current.delete(id);
  }

  function chooseFiles(id: string, selected: File[]) {
    const tooMany = selected.length > MAX_IMAGES;
    idempotencyKeys.current.delete(id);
    setGroups((current) => current.map((group) => group.id === id ? {
      ...group,
      files: tooMany ? [] : selected,
      status: 'idle',
      error: tooMany ? `Add no more than ${MAX_IMAGES} photos to one product.` : '',
    } : group));
    setError('');
  }

  function keyFor(id: string) {
    let key = idempotencyKeys.current.get(id);
    if (!key) { key = crypto.randomUUID(); idempotencyKeys.current.set(id, key); }
    return key;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const pending = groups.filter((group) => group.files.length > 0 && group.status !== 'saved');
    if (!pending.length) { setError('Choose at least one product photo first.'); return; }
    setBusy(true); setError(''); setProgress({ done: 0, total: pending.length });
    let failed = 0;
    for (const [index, group] of pending.entries()) {
      setGroups((current) => current.map((item) => item.id === group.id ? { ...item, status: 'saving', error: '' } : item));
      setProgress({ done: index, total: pending.length });
      const form = new FormData();
      group.files.forEach((file) => form.append('images', file, file.name));
      const base = group.files[0].name.replace(/\.[^.]+$/, '').trim().slice(0, 100);
      form.set('name', base.length >= 2 ? base : 'Untitled product');
      form.set('category', 'other');
      group.files.forEach((_, fileIndex) => form.append('viewLabels', viewLabels[fileIndex]));
      try {
        const response = await fetch('/api/products', { method: 'POST', headers: { 'Idempotency-Key': keyFor(group.id) }, body: form });
        const result = await response.json().catch(() => ({})) as { error?: string };
        if (!response.ok) throw new Error(result.error ?? 'Product could not be saved.');
        setGroups((current) => current.map((item) => item.id === group.id ? { ...item, status: 'saved', error: '' } : item));
      } catch (cause) {
        failed += 1;
        setGroups((current) => current.map((item) => item.id === group.id
          ? { ...item, status: 'error', error: cause instanceof Error ? cause.message : 'Product could not be saved.' }
          : item));
      }
      setProgress({ done: index + 1, total: pending.length });
    }
    setBusy(false);
    if (failed === 0) { window.location.reload(); return; }
    setError(`${failed} of ${pending.length} ${pending.length === 1 ? 'product' : 'products'} could not be saved. Fix or retry below.`);
  }

  return <section className="border border-[#e3ded6] bg-white">
    <button type="button" onClick={() => setOpen((value) => !value)} className="flex w-full items-center justify-between px-5 py-4 text-left">
      <span className="flex items-center gap-3"><span className="flex size-8 items-center justify-center bg-[#f4f1eb] text-[#b6222b]"><ImagePlus size={15} /></span><span><span className="block text-[12px] font-semibold">Add products</span><span className="mt-1 block text-[10px] text-[#938e86]">Upload one or several products in a single batch</span></span></span>
      <span className="text-[10px] uppercase tracking-[0.12em] text-[#b6222b]">{open ? 'Close' : 'New products'}</span>
    </button>
    {open && <form className="grid gap-4 border-t border-[#eee9e1] p-5" onSubmit={submit}>
      <div className="grid gap-3">{groups.map((group, index) => <div key={group.id} className="border border-[#eee9e1] bg-[#faf9f6] p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="text-[10px] font-medium text-[#504b46]">Product {index + 1}{group.status === 'saved' ? ' · Saved' : ''}</p>
          {groups.length > 1 && group.status !== 'saved' && <button type="button" onClick={() => removeGroup(group.id)} disabled={busy} className="flex items-center gap-1 text-[9px] text-[#a3242b] disabled:opacity-40"><Trash2 size={10} /> Remove</button>}
        </div>
        <label className={`flex min-h-[120px] cursor-pointer flex-col items-center justify-center border border-dashed border-[#d9d1c6] bg-white p-4 text-center hover:border-[#b6222b] ${group.status === 'saved' ? 'pointer-events-none opacity-60' : ''}`}>
          <Upload size={15} className="mb-2 text-[#b6222b]" />
          <span className="text-[10px] font-medium">{group.files.length ? `${group.files.length} ${group.files.length === 1 ? 'photo' : 'photos'} chosen` : 'Choose product photos'}</span>
          <span className="mt-1 text-[9px] text-[#938e86]">JPEG, PNG or WebP · up to 15 MB each · max {MAX_IMAGES}</span>
          <input name={`images-${group.id}`} type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={busy || group.status === 'saved'} className="sr-only" onChange={(event) => {
            chooseFiles(group.id, Array.from(event.target.files ?? []));
            event.target.value = '';
          }} />
        </label>
        {group.files.length > 0 && <ul className="mt-3 space-y-2 border border-[#eee9e1] bg-white p-3">{group.files.map((file, fileIndex) => <li key={`${file.name}-${file.lastModified}`} className="flex flex-wrap items-center justify-between gap-3 text-[9px]"><span className="min-w-0 flex-1 truncate text-[#504b46]">{file.name}</span><span className="shrink-0 text-[#77736d]">{viewNames[fileIndex]}</span><span className="shrink-0 text-[#938e86]">{(file.size / (1024 * 1024)).toFixed(1)} MB</span></li>)}</ul>}
        {group.status === 'saved' && <p role="status" className="mt-2 text-[9px] text-[#477047]">Saved. It will appear in the library when the batch finishes.</p>}
        {group.error && <p role="alert" className="mt-2 text-[9px] text-[#a3242b]">{group.error}</p>}
      </div>)}</div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={addGroup} disabled={busy || groups.length >= MAX_PRODUCTS_PER_BATCH} className="flex items-center gap-1 border border-[#ded8cf] px-3 py-2 text-[9px] hover:border-[#b6222b] disabled:opacity-40"><Plus size={11} /> Add another product</button>
        <span className="text-[9px] text-[#938e86]">Up to {MAX_PRODUCTS_PER_BATCH} products per batch.</span>
      </div>
      <div className="border border-[#eee9e1] bg-[#faf9f6] p-3 text-[10px] leading-relaxed text-[#77736d]">Only the original photos are stored. Each uploaded view starts unreviewed and must be reviewed before outfit selection.</div>
      {error && <p role="alert" className="text-[10px] text-[#a3242b]">{error}</p>}
      <button disabled={busy || !groups.some((group) => group.files.length > 0)} className="flex h-10 items-center justify-center gap-2 bg-[#171717] px-4 text-[10px] font-medium text-white hover:bg-[#b6222b] disabled:cursor-not-allowed disabled:opacity-40">{busy ? <><LoaderCircle size={13} className="animate-spin" /> Saving {Math.min(progress.done + 1, progress.total)} of {progress.total}…</> : 'Save product photos'}</button>
    </form>}
  </section>;
}
