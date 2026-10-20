import Link from 'next/link';
import { ArrowRight, BadgeCheck, LockKeyhole } from 'lucide-react';
import { PageHeading } from '@/components/page-heading';
import { listCatalogues } from '@/lib/catalogues';
import Image from 'next/image';
import { CatalogueActions } from '@/components/catalogue-actions';

export const dynamic = 'force-dynamic';

export default async function ApprovedPage() {
  const catalogues = await listCatalogues().catch(() => null);
  const approved = catalogues?.filter((catalogue) => catalogue.status === 'approved' || catalogue.status === 'exported') ?? [];
  return <>
    <PageHeading eyebrow="Private archive" title="Approved catalogues" description="Only owner-approved output belongs here. Approval is tied to the exact reviewed file and never triggers storefront publication." />
    {catalogues === null ? <div role="alert" className="border border-[#e8c8c8] bg-[#fff8f6] p-5 text-[11px] text-[#962a2e]">Approved catalogue archive could not load.</div> : approved.length === 0 ? <div className="border border-dashed border-[#d7d0c6] bg-[#f8f6f2] px-6 py-16 text-center"><BadgeCheck size={20} className="mx-auto mb-4 text-[#b6222b]" /><p className="display-serif text-2xl">Nothing approved yet.</p><p className="mx-auto mt-2 max-w-[420px] text-[11px] leading-relaxed text-[#77736d]">Approve a specific output checksum in Catalogue Review. A source-photo composition is available when a real generation provider is not configured.</p><span className="mt-5 inline-flex items-center gap-2 border border-[#e2ddd5] px-3 py-2 text-[9px] text-[#938e86]"><LockKeyhole size={12} /> Storefront publishing is not connected</span><div><Link href="/review" className="mt-5 inline-flex items-center gap-2 text-[10px] font-semibold text-[#b6222b]">Go to review <ArrowRight size={13} /></Link></div></div> : <div className="space-y-4">{approved.map((item) => { const asset = item.assets.find((entry) => entry.approved && !entry.invalidated); return <article key={item.id} className="grid gap-5 border border-[#e3ded6] bg-white p-5 md:grid-cols-[230px_1fr]"><div>{asset ? <div className="relative aspect-[4/5] bg-[#eeeae3]"><Image unoptimized fill sizes="230px" src={`/api/catalogues/${item.id}/assets/${asset.id}`} alt={`${item.title}, approved output`} className="object-contain" /></div> : <div className="flex aspect-[4/5] items-center justify-center bg-[#f8f6f2] text-[10px] text-[#938e86]">No current approved output</div>}</div><div className="flex flex-col justify-between"><div><div className="flex items-start justify-between gap-3"><div><p className="display-serif text-[25px]">{item.title}</p><p className="mt-1 text-[9px] capitalize text-[#938e86]">{item.style} · {item.occasion} · {item.status}</p><p className="mt-2 text-[9px] text-[#477047]">Approved {new Date(item.created_at).toLocaleDateString()}</p></div><BadgeCheck size={17} className="shrink-0 text-[#477047]" /></div>{asset && <><p className="mt-5 truncate font-mono text-[8px] text-[#938e86]">Approved SHA-256 {asset.sha256}</p><p className="mt-1 text-[8px] text-[#938e86]">{asset.output_kind} · {asset.width} × {asset.height}</p></>}</div>{asset && <div className="mt-5"><CatalogueActions catalogueId={item.id} status={item.status} assetId={asset.id} approved /></div>}</div></article>; })}</div>}
  </>;
}
