'use client';

import { useEffect } from 'react';
import { RefreshCw, ShieldAlert } from 'lucide-react';

export default function StudioError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error('Studio page error', error.digest); }, [error.digest]);
  return <section role="alert" className="mx-auto max-w-[560px] border border-[#e3ded6] bg-white p-7 sm:p-9">
    <ShieldAlert size={18} className="text-[#b6222b]" />
    <p className="mt-4 text-[9px] uppercase tracking-[0.2em] text-[#b6222b]">Studio page error</p>
    <h1 className="display-serif mt-2 text-[28px]">This workspace view could not load.</h1>
    <p className="mt-3 text-[11px] leading-relaxed text-[#77736d]">Check that PostgreSQL and private storage are available. The application has not changed product originals.</p>
    <button onClick={() => reset()} className="mt-6 flex h-9 items-center gap-2 bg-[#171717] px-4 text-[10px] font-medium text-white hover:bg-[#b6222b]"><RefreshCw size={13} /> Try again</button>
  </section>;
}
