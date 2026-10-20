import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { StudioNavigation } from '@/components/studio-navigation';
import { SignOutButton } from '@/components/sign-out-button';
import { getCurrentUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function StudioLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser().catch(() => null);
  if (!user) redirect('/login');
  return <div className="min-h-screen bg-[#f4f1eb] text-[#171717] md:flex">
    <StudioNavigation />
    <div className="min-w-0 flex-1 md:h-screen md:overflow-y-auto">
      <header className="sticky top-0 z-20 flex h-[62px] items-center justify-between border-b border-[#e3ded6] bg-[#f4f1eb]/95 px-5 backdrop-blur md:px-9">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.15em] text-[#77736d]"><span className="size-1.5 rounded-full bg-[#b6222b]" /> Private workspace <span className="hidden text-[#c3bdb4] sm:inline">/</span><span className="hidden sm:inline">Alveron Fashion</span></div>
        <div className="flex items-center gap-4"><span className="hidden max-w-[180px] truncate text-[11px] text-[#77736d] sm:inline">{user.name}</span><SignOutButton /></div>
      </header>
      <main className="mx-auto max-w-[1440px] px-5 pb-24 pt-8 sm:px-7 md:px-10 md:pb-12 md:pt-10">{children}</main>
      <footer className="hidden border-t border-[#e3ded6] px-10 py-4 text-[9px] uppercase tracking-[0.15em] text-[#938e86] md:block">Alveron Fashion · Private Catalogue Studio</footer>
    </div>
  </div>;
}
