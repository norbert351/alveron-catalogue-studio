import Link from 'next/link';
import { ArrowRight, BadgeCheck, LockKeyhole } from 'lucide-react';
import { PageHeading } from '@/components/page-heading';
import { listCatalogues } from '@/lib/catalogues';

export const dynamic = 'force-dynamic';

export default async function ApprovedPage() {
  const catalogues = await listCatalogues().catch(() => null);
  const approved = catalogues?.filter((catalogue) => catalogue.status === 'approved' || catalogue.status === 'exported') ?? [];
  return <>
    <PageHeading eyebrow="Private archive" title="Approved catalogues" description="Only owner-approved output belongs here. Approval is tied to the exact reviewed file and never triggers storefront publication." />
    {catalogues === null ? <div role="alert" className="border border-[#e8c8c8] bg-[#fff8f6] p-5 text-[11px] text-[#962a2e]">Approved catalogue archive could not load.</div> : approved.length === 0 ? <div className="border border-dashed border-[#d7d0c6] bg-[#f8f6f2] px-6 py-16 text-center"><BadgeCheck size={20} className="mx-auto mb-4 text-[#b6222b]" /><p className="display-serif text-2xl">Nothing approved yet.</p><p className="mx-auto mt-2 max-w-[420px] text-[11px] leading-relaxed text-[#77736d]">No catalogue can be approved until a real image-generation provider is configured and the source-versus-output review flow is implemented.</p><span className="mt-5 inline-flex items-center gap-2 border border-[#e2ddd5] px-3 py-2 text-[9px] text-[#938e86]"><LockKeyhole size={12} /> Export stays locked</span><div><Link href="/review" className="mt-5 inline-flex items-center gap-2 text-[10px] font-semibold text-[#b6222b]">Go to review <ArrowRight size={13} /></Link></div></div> : <div className="space-y-3">{approved.map((item) => <article key={item.id} className="flex items-center justify-between border border-[#e3ded6] bg-white p-5"><div><p className="display-serif text-[21px]">{item.title}</p><p className="mt-1 text-[9px] capitalize text-[#938e86]">{item.style} · {item.occasion} · {item.status}</p></div><span className="text-[9px] text-[#477047]">Approved {new Date(item.created_at).toLocaleDateString()}</span></article>)}</div>}
  </>;
}
