import Link from 'next/link';
import { ArrowRight, LockKeyhole, ShieldAlert, Sparkles } from 'lucide-react';
import { PageHeading } from '@/components/page-heading';
import { getImageGenerationProvider } from '@/lib/generation/provider';

export default function GeneratorPage() {
  const provider = getImageGenerationProvider();
  return <>
    <PageHeading eyebrow="Studio workflow · 03" title="Catalogue generator" description="A server-side provider adapter is reserved here. Generation stays unavailable until a real provider is implemented and configured." />
    <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
      <section className="border border-[#e3ded6] bg-white">
        <div className="flex items-start gap-4 border-b border-[#eee9e1] p-6 sm:p-8"><span className="flex size-10 shrink-0 items-center justify-center bg-[#f4f1eb] text-[#b6222b]"><Sparkles size={18} /></span><div><p className="text-[9px] font-semibold uppercase tracking-[0.2em] text-[#b6222b]">Provider status</p><h2 className="display-serif mt-2 text-[27px]">{provider ? 'Provider connected' : 'Not configured'}</h2><p className="mt-2 text-[11px] leading-relaxed text-[#77736d]">{provider ? `Server-side adapter: ${provider.id}` : 'No image-generation provider is connected. No generation request has been sent, and no demo output is being presented as real.'}</p></div></div>
        <div className="grid gap-4 p-6 sm:grid-cols-3 sm:p-8">{[['01', 'Choose one brief', 'A single outfit, one style and one occasion.'], ['02', 'Attach source views', 'Only reviewed Alveron product images are eligible.'], ['03', 'Create a review draft', 'Generated clothing must be checked against every source.']].map(([step, title, detail]) => <div className="border border-[#eee9e1] p-4" key={step}><p className="text-[9px] tracking-[0.15em] text-[#b6222b]">{step}</p><h3 className="mt-4 text-[11px] font-semibold">{title}</h3><p className="mt-2 text-[9px] leading-relaxed text-[#938e86]">{detail}</p></div>)}</div>
        <div className="mx-6 mb-6 flex gap-3 border border-[#e8d7bb] bg-[#fffaf1] p-4 sm:mx-8 sm:mb-8"><LockKeyhole size={15} className="mt-0.5 shrink-0 text-[#a47738]" /><p className="text-[10px] leading-relaxed text-[#806a49]">Generation is disabled. For a provider to be enabled, configure its server-side credentials and explicit adapter first. Even then, output remains a draft and requires product-by-product review.</p></div>
        <div className="flex items-center justify-between border-t border-[#eee9e1] bg-[#faf9f6] px-6 py-4 sm:px-8"><span className="text-[9px] uppercase tracking-[0.14em] text-[#938e86]">No output · no provider call</span><button disabled className="flex h-9 cursor-not-allowed items-center gap-2 bg-[#d8d4ce] px-4 text-[9px] font-medium text-white" aria-disabled="true"><Sparkles size={12} /> Generate disabled</button></div>
      </section>
      <aside className="h-fit border border-[#e3ded6] bg-white p-5"><ShieldAlert size={16} className="text-[#b6222b]" /><h2 className="display-serif mt-4 text-[22px]">Fidelity comes first.</h2><p className="mt-3 text-[10px] leading-[1.8] text-[#77736d]">Image models can alter colour, pattern, logos, fabric appearance or garment construction. Generated mannequin imagery is never treated as verified product photography.</p><Link href="/outfits" className="mt-5 flex items-center justify-between border-t border-[#eee9e1] pt-4 text-[10px] font-medium">Review outfit brief <ArrowRight size={13} className="text-[#b6222b]" /></Link></aside>
    </div>
  </>;
}
