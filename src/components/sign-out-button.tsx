'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';

export function SignOutButton() {
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  return <button className="flex items-center gap-2 text-[11px] text-[#77736d] hover:text-[#171717] disabled:opacity-50" disabled={busy} onClick={async () => {
    setBusy(true);
    await fetch('/api/auth/logout', { method: 'POST' });
    router.replace('/login');
    router.refresh();
  }}><LogOut size={14} />{busy ? 'Signing out…' : 'Sign out'}</button>;
}
