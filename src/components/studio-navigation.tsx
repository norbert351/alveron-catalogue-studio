'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Boxes, KeyRound, Settings2 } from 'lucide-react';
import { cn } from '@/lib/ui';

const items = [
  { href: '/products', label: 'Product Library', icon: Boxes },
  { href: '/settings', label: 'Settings & Access', icon: Settings2 },
];

export function StudioNavigation() {
  const pathname = usePathname();
  return (
    <>
      <div className="hidden h-full w-[246px] shrink-0 flex-col bg-[#171717] px-4 py-5 text-white md:flex">
        <Link href="/products" className="mb-9 flex items-center gap-3 px-2">
          <span className="flex size-9 items-center justify-center rounded-sm bg-[#b6222b] font-serif text-xl">A</span>
          <span><span className="block text-[13px] font-semibold tracking-[0.22em]">ALVERON</span><span className="mt-1 block text-[9px] tracking-[0.24em] text-white/45">PRODUCT LIBRARY</span></span>
        </Link>
        <p className="mb-3 px-3 text-[9px] font-semibold uppercase tracking-[0.22em] text-white/35">Library</p>
        <nav className="flex flex-col gap-1">
          {items.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || pathname.startsWith(`${href}/`);
            return <Link key={href} href={href} className={cn('flex min-h-10 items-center gap-3 rounded-sm px-3 text-[12px] transition-colors', active ? 'bg-white/10 text-white' : 'text-white/55 hover:bg-white/[0.06] hover:text-white/90')}>
              <Icon size={15} strokeWidth={1.7} />{label}
            </Link>;
          })}
        </nav>
        <div className="mt-auto rounded-sm border border-white/10 p-3">
          <div className="mb-2 flex items-center gap-2 text-[10px] font-medium"><KeyRound size={11} className="text-white/50" /> Private library</div>
          <p className="text-[10px] leading-relaxed text-white/40">Original product photos stay private. ChatGPT reaches them only with a read-only token you can revoke.</p>
        </div>
      </div>
      <nav className="flex border-t border-[#2a2a2a] bg-[#171717] md:hidden">
        {items.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return <Link key={href} href={href} className={cn('flex flex-1 flex-col items-center gap-1 py-3 text-[10px]', active ? 'text-white' : 'text-white/50')}>
            <Icon size={17} strokeWidth={1.7} />{label}
          </Link>;
        })}
      </nav>
    </>
  );
}
