'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, LockKeyhole } from 'lucide-react';

export function LoginForm() {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  return <form className="mt-8 space-y-4" onSubmit={async (event) => {
    event.preventDefault();
    setError('');
    setBusy(true);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: form.get('email'), password: form.get('password') }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) setError(result.error ?? 'Sign-in failed.');
      else { router.replace('/products'); router.refresh(); }
    } catch { setError('The studio could not be reached. Check your local server.'); }
    finally { setBusy(false); }
  }}>
    <label className="block text-[11px] font-medium text-[#45413d]" htmlFor="email">Owner email<input id="email" name="email" type="email" autoComplete="username" required className="mt-2 h-11 w-full border border-[#ddd7ce] bg-white px-3 text-[13px] outline-none focus:border-[#b6222b]" /></label>
    <label className="block text-[11px] font-medium text-[#45413d]" htmlFor="password">Password<input id="password" name="password" type="password" autoComplete="current-password" required className="mt-2 h-11 w-full border border-[#ddd7ce] bg-white px-3 text-[13px] outline-none focus:border-[#b6222b]" /></label>
    {error && <p role="alert" className="border border-[#e8c8c8] bg-[#fff5f5] px-3 py-2 text-[11px] leading-relaxed text-[#962a2e]">{error}</p>}
    <button disabled={busy} className="mt-2 flex h-11 w-full items-center justify-between bg-[#171717] px-4 text-[11px] font-medium text-white transition-colors hover:bg-[#b6222b] disabled:opacity-60"><span>{busy ? 'Checking access…' : 'Enter private studio'}</span>{busy ? <LockKeyhole size={14} /> : <ArrowRight size={14} />}</button>
  </form>;
}
