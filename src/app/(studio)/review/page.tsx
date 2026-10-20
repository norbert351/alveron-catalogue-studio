import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight, CircleCheck, Eye, LockKeyhole } from 'lucide-react';
import { PageHeading } from '@/components/page-heading';
import { listCatalogues } from '@/lib/catalogues';
import { OriginalPhotoCataloguePreview } from '@/components/original-photo-catalogue-preview';

export const dynamic = 'force-dynamic';

const labels: Record<string, string> = { 'modern-tailoring': 'Modern tailoring', 'smart-casual': 'Smart casual', 'weekend-casual': 'Weekend casual', 'elevated-streetwear': 'Elevated streetwear', workwear: 'Workwear', evening: 'Evening', weekend: 'Weekend', travel: 'Travel' };

export default async function ReviewPage() {
  const catalogues = await listCatalogues().catch(() => null);
  const drafts = catalogues?.filter((catalogue) => catalogue.status === 'draft' || catalogue.status === 'review') ?? [];
  return <>
    <PageHeading eyebrow="Studio workflow · 04" title="Catalogue review" description="Review outfit selections and, when a real output exists, compare it with every exact source photograph before approval." />
    <div className="mb-6 flex items-start gap-3 border border-[#e3ded6] bg-white p-4"><Eye size={15} className="mt-0.5 shrink-0 text-[#b6222b]" /><p className="text-[10px] leading-relaxed text-[#77736d]">Current stage: outfit drafts can be reviewed against their selected originals. Generated output, approval and export are not enabled until a provider and fidelity review flow are implemented.</p></div>
    {catalogues === null ? <div role="alert" className="border border-[#e8c8c8] bg-[#fff8f6] p-5 text-[11px] text-[#962a2e]">Catalogue drafts could not be loaded. Check PostgreSQL and migrations.</div> : drafts.length === 0 ? <div className="border border-dashed border-[#d7d0c6] bg-[#f8f6f2] px-6 py-16 text-center"><CircleCheck size={19} className="mx-auto mb-4 text-[#b6222b]" /><p className="display-serif text-2xl">No outfits waiting for review.</p><p className="mt-2 text-[11px] text-[#77736d]">Create an outfit from reviewed products to see its source references here.</p><Link href="/outfits" className="mt-5 inline-flex items-center gap-2 text-[10px] font-semibold text-[#b6222b]">Open Outfit Builder <ArrowRight size={13} /></Link></div> : <div className="space-y-4">{drafts.map((catalogue) => <article key={catalogue.id} className="border border-[#e3ded6] bg-white">
      <div className="flex flex-col gap-3 border-b border-[#eee9e1] p-5 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-[8px] uppercase tracking-[0.18em] text-[#b6222b]">Outfit brief · {new Date(catalogue.created_at).toLocaleDateString()}</p><h2 className="display-serif mt-2 text-[24px]">{catalogue.title}</h2><p className="mt-1 text-[9px] text-[#77736d]">{labels[catalogue.style] ?? catalogue.style} · {labels[catalogue.occasion] ?? catalogue.occasion}{catalogue.mixed_style_requested ? ' · mixed style explicitly requested' : ''}</p></div><span className="w-fit border border-[#e2ddd5] px-2 py-1 text-[8px] uppercase tracking-[0.12em] text-[#77736d]">Draft · {catalogue.items.length} products</span></div>
      <div className="grid grid-cols-2 gap-3 p-5 sm:grid-cols-3 lg:grid-cols-5">{catalogue.items.map((item) => <div key={item.product_id} className="border border-[#eee9e1] bg-[#faf9f6]"><div className="relative aspect-[4/5] bg-[#eee9e1]"><Image unoptimized fill sizes="220px" src={`/api/products/${item.product_id}/images/${item.image_id}`} alt={`Original source view for ${item.product_name}`} className="object-contain" /></div><div className="p-2"><p className="truncate text-[9px] font-medium">{item.product_name}</p><p className="mt-1 text-[8px] capitalize text-[#938e86]">{item.role} · original source</p><p className="mt-1 truncate font-mono text-[7px] text-[#aaa39a]">SHA-256 {item.image_sha256}</p></div></div>)}</div>
      <OriginalPhotoCataloguePreview catalogue={catalogue} />
      <div className="flex items-center justify-between border-t border-[#eee9e1] bg-[#faf9f6] px-5 py-3"><span className="flex items-center gap-2 text-[9px] text-[#938e86]"><LockKeyhole size={12} /> No generated output attached yet</span><button disabled aria-disabled="true" className="cursor-not-allowed border border-[#e0dbd3] px-3 py-2 text-[9px] text-[#aaa39a]">Approval unavailable</button></div>
    </article>)}</div>}
  </>;
}
