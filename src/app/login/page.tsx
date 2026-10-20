import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft, LockKeyhole } from 'lucide-react';
import { LoginForm } from '@/components/login-form';
import { getCurrentUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  if (await getCurrentUser().catch(() => null)) redirect('/dashboard');
  return <main className="grid min-h-screen bg-[#f4f1eb] lg:grid-cols-[1fr_0.86fr]">
    <section className="relative hidden min-h-screen overflow-hidden bg-[#171717] p-12 text-white lg:flex lg:flex-col lg:justify-between">
      <Link href="/login" className="flex items-center gap-3"><span className="flex size-10 items-center justify-center bg-[#b6222b] font-serif text-2xl">A</span><span><span className="block text-[13px] font-semibold tracking-[0.22em]">ALVERON</span><span className="block pt-1 text-[9px] tracking-[0.24em] text-white/45">CATALOGUE STUDIO</span></span></Link>
      <div className="relative z-10 max-w-[520px] pb-10"><p className="mb-4 text-[9px] uppercase tracking-[0.3em] text-[#d4676c]">A considered presentation</p><h1 className="display-serif text-6xl leading-[1.02] tracking-[-0.04em]">Made from<br />what is yours.</h1><p className="mt-6 max-w-[390px] text-sm leading-7 text-white/50">A private workspace for Alveron’s product imagery, outfit composition and catalogue review.</p></div>
      <div className="flex items-center justify-between border-t border-white/10 pt-5 text-[9px] uppercase tracking-[0.18em] text-white/35"><span>Alveron Fashion · Nigeria</span><span>Private by design</span></div>
      <div aria-hidden className="absolute -right-24 top-[22%] h-[440px] w-[380px] rounded-[50%] border border-white/[0.06]" /><div aria-hidden className="absolute -right-2 top-[28%] h-[320px] w-[260px] rounded-[50%] border border-white/[0.06]" />
    </section>
    <section className="flex min-h-screen flex-col justify-center px-6 py-12 sm:px-14 lg:px-20">
      <div className="mx-auto w-full max-w-[390px]">
        <Link href="/" className="mb-12 inline-flex items-center gap-2 text-[10px] text-[#8c877f] hover:text-[#171717]"><ArrowLeft size={13} />Alveron Catalogue Studio</Link>
        <div className="mb-8 flex size-10 items-center justify-center border border-[#ded8ce] text-[#b6222b]"><LockKeyhole size={17} /></div>
        <p className="mb-3 text-[9px] font-semibold uppercase tracking-[0.25em] text-[#b6222b]">Owner access</p>
        <h2 className="display-serif text-[38px] leading-tight tracking-[-0.03em]">Welcome back.</h2>
        <p className="mt-3 text-[12px] leading-relaxed text-[#746f69]">Sign in with the private studio owner account. New accounts are created only by the setup command.</p>
        <LoginForm />
        <p className="mt-8 border-t border-[#e3ded6] pt-5 text-[10px] leading-relaxed text-[#938e86]">First local setup? Follow the owner account and database steps in README.md from your terminal.</p>
      </div>
    </section>
  </main>;
}
