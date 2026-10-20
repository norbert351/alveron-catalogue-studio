'use client';

import { useState } from 'react';
import { ImagePlus, LoaderCircle, Upload } from 'lucide-react';

const categories = [
  ['tops', 'Tops'], ['bottoms', 'Bottoms'], ['outerwear', 'Outerwear'], ['shoes', 'Shoes'],
  ['accessories', 'Accessories'], ['sets', 'Sets'], ['other', 'Other'],
];

export function ProductUploadForm() {
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  return <section className="border border-[#e3ded6] bg-white">
    <button type="button" onClick={() => setOpen((value) => !value)} className="flex w-full items-center justify-between px-5 py-4 text-left">
      <span className="flex items-center gap-3"><span className="flex size-8 items-center justify-center bg-[#f4f1eb] text-[#b6222b]"><ImagePlus size={15} /></span><span><span className="block text-[12px] font-semibold">Add a product</span><span className="mt-1 block text-[10px] text-[#938e86]">Upload original product photos and verified details</span></span></span>
      <span className="text-[10px] uppercase tracking-[0.12em] text-[#b6222b]">{open ? 'Close' : 'New product'}</span>
    </button>
    {open && <form className="grid gap-5 border-t border-[#eee9e1] p-5 md:grid-cols-2" onSubmit={async (event) => {
      event.preventDefault(); setError(''); setBusy(true);
      const form = new FormData(event.currentTarget);
      files.forEach((file) => form.append('images', file, file.name));
      try {
        const response = await fetch('/api/products', { method: 'POST', body: form });
        const result = await response.json() as { error?: string };
        if (!response.ok) setError(result.error ?? 'Product could not be saved.');
        else window.location.reload();
      } catch { setError('The studio could not be reached. Check the local server.'); }
      finally { setBusy(false); }
    }}>
      <div className="space-y-4">
        <label className="block text-[10px] font-medium text-[#504b46]">Product name *<input name="name" required minLength={2} maxLength={100} placeholder="e.g. Tailored wool jacket" className="field mt-2" /></label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-[10px] font-medium text-[#504b46]">SKU<input name="sku" maxLength={60} placeholder="Optional" className="field mt-2" /></label>
          <label className="block text-[10px] font-medium text-[#504b46]">Category *<select name="category" required className="field mt-2">{categories.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-[10px] font-medium text-[#504b46]">Visible colour<input name="color" maxLength={80} placeholder="Verify from photos" className="field mt-2" /></label>
          <label className="block text-[10px] font-medium text-[#504b46]">Fabric appearance<input name="fabric" maxLength={120} placeholder="Optional · verified only" className="field mt-2" /></label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-[10px] font-medium text-[#504b46]">Pattern<input name="pattern" maxLength={120} className="field mt-2" /></label>
          <label className="block text-[10px] font-medium text-[#504b46]">Fit / cut<input name="fit" maxLength={120} className="field mt-2" /></label>
        </div>
        <label className="block text-[10px] font-medium text-[#504b46]">Notes<textarea name="notes" maxLength={1000} rows={3} placeholder="Only details confirmed from the original images" className="field mt-2 resize-y py-2" /></label>
      </div>
      <div className="space-y-4">
        <label className="flex min-h-[160px] cursor-pointer flex-col items-center justify-center border border-dashed border-[#d9d1c6] bg-[#faf9f6] p-4 text-center hover:border-[#b6222b]">
          <Upload size={17} className="mb-3 text-[#b6222b]" /><span className="text-[11px] font-medium">Choose product views</span><span className="mt-1 text-[9px] text-[#938e86]">JPEG, PNG or WebP · up to 15 MB each · max 5</span>
          <input type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" onChange={(event) => {
            const chosen = Array.from(event.target.files ?? []);
            if (chosen.length > 5) { setError('Add no more than five photos to one product.'); setFiles([]); }
            else { setError(''); setFiles(chosen); }
          }} />
        </label>
        {files.length > 0 && <ul className="space-y-1 border border-[#eee9e1] bg-[#faf9f6] p-3">{files.map((file) => <li key={`${file.name}-${file.lastModified}`} className="flex justify-between gap-3 text-[9px]"><span className="truncate text-[#504b46]">{file.name}</span><span className="shrink-0 text-[#938e86]">{(file.size / (1024 * 1024)).toFixed(1)} MB</span></li>)}</ul>}
        <div className="border border-[#eee9e1] bg-[#faf9f6] p-3 text-[10px] leading-relaxed text-[#77736d]">Original files are stored unchanged. Each uploaded view starts unreviewed and must be reviewed before outfit selection.</div>
        {error && <p role="alert" className="text-[10px] text-[#a3242b]">{error}</p>}
        <button disabled={busy || files.length === 0} className="flex h-10 items-center justify-center gap-2 bg-[#171717] px-4 text-[10px] font-medium text-white hover:bg-[#b6222b] disabled:cursor-not-allowed disabled:opacity-40">{busy ? <><LoaderCircle size={13} className="animate-spin" /> Saving original files…</> : 'Save product and original photos'}</button>
      </div>
    </form>}
  </section>;
}
