'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BadgeCheck, Boxes, CircleCheck, LayoutDashboard, Settings2, Shirt, Sparkles } from 'lucide-react';
import { cn } from '@/lib/ui';

const items = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/products', label: 'Product Library', icon: Boxes },
  { href: '/outfits', label: 'Outfit Builder', icon: Shirt },
  { href: '/generate', label: 'Catalogue Generator', icon: Sparkles },
  { href: '/review', label: 'Catalogue Review', icon: CircleCheck },
  { href: '/approved', label: 'Approved Catalogues', icon: BadgeCheck },
  { href: '/settings', label: 'Studio Settings', icon: Settings2 },
];

export function StudioNavigation() {
  const pathname = usePathname();
  return (
    <>
      <div className="hidden h-full w-[246px] shrink-0 flex-col bg-[#171717] px-4 py-5 text-white md:flex">
        <Link href="/dashboard" className="mb-9 flex items-center gap-3 px-2">
          <span className="flex size-9 items-center justify-center rounded-sm bg-[#b6222b] font-serif text-xl">A</span>
          <span><span className="block text-[13px] font-semibold tracking-[0.22em]">ALVERON</span><span className="mt-1 block text-[9px] tracking-[0.24em] text-white/45">CATALOGUE STUDIO</span></span>
        </Link>
        <p className="mb-3 px-3 text-[9px] font-semibold uppercase tracking-[0.22em] text-white/35">Workspace</p>
        <nav className="flex flex-col gap-1">
          {items.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || (href !== '/dashboard' && pathname.startsWith(`${href}/`));
            return <Link key={href} href={href} className={cn('flex min-h-10 items-center gap-3 rounded-sm px-3 text-[12px] transition-colors', active ? 'bg-white/10 text-white' : 'text-white/55 hover:bg-white/[0.06] hover:text-white/90')}>
              <Icon size={15} strokeWidth={1.7} />{label}
              {href === '/generate' && <span className="ml-auto rounded-full border border-white/15 px-1.5 py-0.5 text-[8px] text-white/45">SETUP</span>}
            </Link>;
          })}
        </nav>
        <div className="mt-auto rounded-sm border border-white/10 p-3">
          <div className="mb-2 flex items-center gap-2 text-[10px] font-medium"><span className="size-1.5 rounded-full bg-[#c5444c]" /> Private studio</div>
          <p className="text-[10px] leading-relaxed text-white/40">Original product images stay inside your studio and are never publicly linked.</p>
        </div>
      </div>
      <nav aria-label="Studio navigation" className="fixed inset-x-0 bottom-0 z-30 flex overflow-x-auto border-t border-[#282828] bg-[#171717] px-1 pb-[env(safe-area-inset-bottom)] text-white md:hidden studio-scrollbar">
        {items.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || (href !== '/dashboard' && pathname.startsWith(`${href}/`));
          return <Link key={href} href={href} aria-current={active ? 'page' : undefined} className={cn('flex min-w-[74px] flex-1 flex-col items-center gap-1 py-2 text-[9px]', active ? 'text-white' : 'text-white/45')}><Icon size={16} />{label.replace('Catalogue ', '')}</Link>;
        })}
      </nav>
    </>
  );
}
