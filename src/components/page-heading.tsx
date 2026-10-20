import type { ReactNode } from 'react';

export function PageHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) {
  return <div className="mb-8 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
    <div><p className="mb-3 text-[9px] font-semibold uppercase tracking-[0.25em] text-[#b6222b]">{eyebrow}</p><h1 className="display-serif text-[34px] leading-[1.05] tracking-[-0.035em] sm:text-[42px]">{title}</h1><p className="mt-3 max-w-[620px] text-[13px] leading-relaxed text-[#746f69]">{description}</p></div>
    {action && <div className="shrink-0">{action}</div>}
  </div>;
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-[#938e86]">{children}</p>;
}
