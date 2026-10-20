import Image from 'next/image';
import type { CatalogueSummary } from '@/lib/catalogues';

const labels: Record<string, string> = { 'modern-tailoring': 'Modern tailoring', 'smart-casual': 'Smart casual', 'weekend-casual': 'Weekend casual', 'elevated-streetwear': 'Elevated streetwear', workwear: 'Workwear', evening: 'Evening', weekend: 'Weekend', travel: 'Travel' };

export function OriginalPhotoCataloguePreview({ catalogue }: { catalogue: CatalogueSummary }) {
  const [hero, ...otherItems] = catalogue.items;
  if (!hero) return null;
  return <section className="border-t border-[#eee9e1] p-4 sm:p-5">
    <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-[8px] font-semibold uppercase tracking-[0.18em] text-[#b6222b]">Original-photo composition · preview</p><p className="mt-1 text-[9px] text-[#77736d]">A source-only catalogue layout. No garment has been generated, retouched or substituted.</p></div><span className="text-[8px] uppercase tracking-[0.14em] text-[#938e86]">Not approved · not exportable</span></div>
    <div className="grid overflow-hidden border border-[#d9d2c8] bg-[#eee9e1] md:grid-cols-[1.35fr_0.65fr]">
      <div className="relative min-h-[320px] bg-[#e8e1d7] sm:min-h-[420px]">
        <Image unoptimized fill sizes="(max-width: 768px) 100vw, 65vw" src={`/api/products/${hero.product_id}/images/${hero.image_id}`} alt={`Unchanged original product photograph: ${hero.product_name}`} className="object-contain p-3 sm:p-6" />
        <span className="absolute left-3 top-3 bg-[#f4f1eb]/90 px-2 py-1 text-[7px] uppercase tracking-[0.16em] text-[#746f69]">Original source photograph</span>
      </div>
      <div className="flex flex-col justify-between border-t border-[#d9d2c8] bg-[#f2eee8] p-5 sm:p-6 md:border-l md:border-t-0">
        <div><p className="text-[8px] uppercase tracking-[0.24em] text-[#b6222b]">ALVERON · EDITORIAL</p><h3 className="display-serif mt-4 text-[29px] leading-tight">{catalogue.title}</h3><p className="mt-2 text-[9px] uppercase tracking-[0.12em] text-[#77736d]">{labels[catalogue.style] ?? catalogue.style} · {labels[catalogue.occasion] ?? catalogue.occasion}</p><div className="mt-5 h-px bg-[#d9d2c8]" /><p className="mt-4 text-[8px] uppercase tracking-[0.16em] text-[#938e86]">Selected from your library</p></div>
        <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-2">{otherItems.map((item) => <div key={item.product_id} className="relative aspect-[4/5] overflow-hidden bg-[#e8e1d7]"><Image unoptimized fill sizes="160px" src={`/api/products/${item.product_id}/images/${item.image_id}`} alt={`Unchanged original photograph: ${item.product_name}`} className="object-contain p-1" /></div>)}</div>
        <div className="mt-5 border-t border-[#d9d2c8] pt-3"><p className="text-[9px] font-medium">{hero.product_name}</p><p className="mt-1 text-[8px] capitalize text-[#938e86]">{hero.role} · original photo</p>{otherItems.map((item) => <p key={item.product_id} className="mt-1 truncate text-[8px] text-[#77736d]">{item.product_name} · {item.role}</p>)}</div>
      </div>
    </div>
    <p className="mt-2 text-[8px] leading-relaxed text-[#938e86]">All displayed garments are owner-uploaded images shown unchanged. This layout is a safe alternative when generated garment fidelity is uncertain; it is a review preview, not an approved export.</p>
  </section>;
}
