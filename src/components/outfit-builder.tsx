'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useState } from 'react';
import { ArrowRight, Check, LockKeyhole, LoaderCircle, Plus, Shirt } from 'lucide-react';
import type { ProductCard } from '@/lib/products';
import type { CatalogueSummary } from '@/lib/catalogues';

const styles = [['modern-tailoring', 'Modern tailoring'], ['smart-casual', 'Smart casual'], ['weekend-casual', 'Weekend casual'], ['elevated-streetwear', 'Elevated streetwear']];
const occasions = [['workwear', 'Workwear'], ['evening', 'Evening'], ['weekend', 'Weekend'], ['travel', 'Travel']];
const roles = [['top', 'Top'], ['bottom', 'Bottom'], ['outerwear', 'Outerwear'], ['shoes', 'Shoes'], ['accessory', 'Accessory'], ['set', 'Set']];

export function OutfitBuilder({ products, allReviewed, initialDraft }: { products: ProductCard[]; allReviewed: boolean; initialDraft?: CatalogueSummary }) {
  const candidates = products.filter((product) => product.availability === 'active' && product.images.some((image) => image.current && image.reviewed));
  const [selected, setSelected] = useState<Array<{ productId: string; imageId: string; role: string }>>(() => initialDraft?.items.map((item) => ({ productId: item.product_id, imageId: item.image_id, role: item.role })) ?? []);
  const [style, setStyle] = useState(initialDraft?.style ?? styles[0][0]);
  const [occasion, setOccasion] = useState(initialDraft?.occasion ?? occasions[0][0]);
  const [mixed, setMixed] = useState(initialDraft?.mixed_style_requested ?? false);
  const [title, setTitle] = useState(initialDraft?.title ?? 'Alveron editorial look');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState('');
  const completeOutfit = selected.some((item) => item.role === 'set') || (selected.some((item) => item.role === 'top') && selected.some((item) => item.role === 'bottom'));

  function updateItem(productId: string, field: 'imageId' | 'role', value: string) {
    setSelected((current) => current.map((item) => item.productId === productId ? { ...item, [field]: value } : item));
  }

  return <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
    <section className="space-y-3">
      {!allReviewed && <div className="flex gap-3 border border-[#e8d7bb] bg-[#fffaf1] p-4 text-[10px] leading-relaxed text-[#856d43]"><LockKeyhole size={15} className="mt-0.5 shrink-0" /><p>Outfit selection is locked until every accessible product image has been reviewed, including all new uploads. Visit the <Link href="/products" className="font-semibold underline">Product Library</Link> to finish review.</p></div>}
      {candidates.length === 0 ? <div className="border border-dashed border-[#d7d0c6] bg-[#f8f6f2] px-6 py-14 text-center"><Shirt size={20} className="mx-auto mb-4 text-[#b6222b]" /><p className="display-serif text-2xl">No verified pieces to style.</p><p className="mt-2 text-[11px] text-[#77736d]">Upload Alveron product photos and review each image first.</p><Link href="/products" className="mt-5 inline-flex items-center gap-2 text-[10px] font-semibold text-[#b6222b]">Go to Product Library <ArrowRight size={13} /></Link></div> : candidates.map((product) => {
        const isSelected = selected.some((item) => item.productId === product.id);
        return <article key={product.id} className={`grid gap-4 border p-4 sm:grid-cols-[86px_1fr_auto] sm:items-center ${isSelected ? 'border-[#b6222b] bg-white' : 'border-[#e3ded6] bg-white'}`}>
          <div className="relative aspect-[4/5] w-[86px] overflow-hidden bg-[#eee9e1]">{product.images.find((image) => image.current && image.reviewed) && <Image unoptimized fill sizes="86px" src={`/api/products/${product.id}/images/${product.images.find((image) => image.current && image.reviewed)!.id}`} alt={`Original ${product.name}`} className="object-contain" />}</div>
          <div><h2 className="text-[12px] font-semibold">{product.name}</h2><p className="mt-1 text-[9px] capitalize text-[#938e86]">{product.category} · {product.color || 'colour not verified'}</p>{product.images.some((image) => !image.reviewed) && <p className="mt-2 text-[9px] text-[#a87326]">Some views still need review</p>}
            {isSelected && <div className="mt-3 flex flex-wrap gap-2"><label className="text-[9px] text-[#746f69]">Role<select value={selected.find((item) => item.productId === product.id)?.role} onChange={(event) => updateItem(product.id, 'role', event.target.value)} className="ml-2 border border-[#ded8cf] bg-[#faf9f6] px-2 py-1 text-[9px] text-[#171717]">{roles.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="text-[9px] text-[#746f69]">Source view<select value={selected.find((item) => item.productId === product.id)?.imageId} onChange={(event) => updateItem(product.id, 'imageId', event.target.value)} className="ml-2 max-w-[180px] border border-[#ded8cf] bg-[#faf9f6] px-2 py-1 text-[9px] text-[#171717]">{product.images.filter((image) => image.current && image.reviewed).map((image, index) => <option key={image.id} value={image.id}>{image.view_label} · {index + 1}</option>)}</select></label></div>}
          </div>
          <button disabled={!allReviewed || !product.images.some((image) => image.current && image.reviewed)} onClick={() => setSelected((current) => isSelected ? current.filter((item) => item.productId !== product.id) : [...current, { productId: product.id, imageId: product.images.find((image) => image.current && image.reviewed)!.id, role: product.category === 'tops' ? 'top' : product.category === 'bottoms' ? 'bottom' : product.category === 'sets' ? 'set' : product.category === 'shoes' ? 'shoes' : product.category === 'accessories' ? 'accessory' : 'outerwear' }])} className={`flex h-8 items-center justify-center gap-1.5 px-3 text-[9px] ${isSelected ? 'border border-[#ddd7ce] text-[#746f69]' : 'bg-[#171717] text-white hover:bg-[#b6222b]'} disabled:cursor-not-allowed disabled:opacity-40`}>{isSelected ? <><Check size={12} /> Added</> : <><Plus size={12} /> Add to outfit</>}</button>
        </article>;
      })}
    </section>

    <aside className="h-fit border border-[#e3ded6] bg-white p-5 xl:sticky xl:top-[86px]">
      <div className="mb-5 flex items-center justify-between"><div><p className="text-[9px] font-semibold uppercase tracking-[0.2em] text-[#b6222b]">Outfit brief</p><h2 className="display-serif mt-2 text-[24px]">One considered look.</h2></div><span className="text-[9px] text-[#938e86]">{selected.length} / 5 pieces</span></div>
      <label className="block text-[9px] font-medium text-[#504b46]">Catalogue title<input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} className="field mt-2" /></label>
      <label className="mt-4 block text-[9px] font-medium text-[#504b46]">One style<select value={style} onChange={(event) => setStyle(event.target.value)} className="field mt-2">{styles.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="mt-4 block text-[9px] font-medium text-[#504b46]">One occasion<select value={occasion} onChange={(event) => setOccasion(event.target.value)} className="field mt-2">{occasions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="mt-4 flex cursor-pointer items-start gap-2 text-[9px] leading-relaxed text-[#746f69]"><input checked={mixed} onChange={(event) => setMixed(event.target.checked)} type="checkbox" className="mt-0.5 accent-[#b6222b]" /><span>I explicitly request a mixed-style outfit for this catalogue.</span></label>
      <div className="mt-5 space-y-2 border-t border-[#eee9e1] pt-4">
        {selected.length === 0 ? <p className="text-[10px] text-[#a29b91]">Choose exact products from the reviewed inventory.</p> : selected.map((item) => <div key={item.productId} className="flex items-center justify-between text-[9px]"><span className="truncate pr-2">{products.find((product) => product.id === item.productId)?.name}</span><span className="capitalize text-[#938e86]">{item.role}</span></div>)}
      </div>
      {selected.length > 0 && !completeOutfit && <p className="mt-4 border border-[#e8d7bb] bg-[#fffaf1] p-2 text-[9px] leading-relaxed text-[#806a49]">Add a top and bottom, or select an uploaded set, to make a complete outfit.</p>}
      {error && <p role="alert" className="mt-4 border border-[#e8c8c8] bg-[#fff8f6] p-2 text-[9px] text-[#962a2e]">{error}</p>}
      {created ? <div className="mt-4 border border-[#d5e3d2] bg-[#f4f9f2] p-3 text-[10px] leading-relaxed text-[#477047]">Outfit saved as a draft. <Link href="/review" className="font-semibold underline">Open Catalogue Review</Link></div> : <button disabled={!allReviewed || selected.length < 2 || !completeOutfit || busy} onClick={async () => {
        setError(''); setBusy(true);
        try {
          const response = await fetch(initialDraft ? `/api/catalogues/${initialDraft.id}` : '/api/catalogues', { method: initialDraft ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, style, occasion, mixedStyleRequested: mixed, items: selected }) });
          const result = await response.json() as { id?: string; error?: string };
          if (!response.ok) setError(result.error ?? 'The outfit could not be saved.'); else setCreated(result.id ?? 'created');
        } catch { setError('The studio could not be reached.'); }
        finally { setBusy(false); }
      }} className="mt-5 flex h-10 w-full items-center justify-center gap-2 bg-[#171717] text-[10px] font-medium text-white hover:bg-[#b6222b] disabled:cursor-not-allowed disabled:opacity-35">{busy ? <><LoaderCircle size={13} className="animate-spin" /> Saving draft…</> : initialDraft ? 'Update saved draft' : 'Save reviewable outfit'}<ArrowRight size={13} /></button>}
      <p className="mt-3 text-[8px] leading-relaxed text-[#938e86]">{initialDraft ? `Editing saved draft ${initialDraft.id}.` : 'Saving creates a reviewable outfit brief only.'} No garment is generated by this action, and nothing is exported.</p>
    </aside>
  </div>;
}
