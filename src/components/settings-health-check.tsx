'use client';

import { useState } from 'react';
import { Activity, LoaderCircle } from 'lucide-react';

type Status = { database: string; storageProvider: string; storage: string; uploads: { receiving: number; failed: number } | null; jobs: { queued: number; running: number; failed: number; blocked: number } | null; generationProvider: string };

export function SettingsHealthCheck() {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return <div className="mt-5 border border-[#eee9e1] bg-[#faf9f6] p-4"><button disabled={busy} onClick={async () => {
    setBusy(true); setError('');
    try { const response = await fetch('/api/settings/health', { method: 'POST' }); const result = await response.json() as Status & { error?: string }; setStatus(result); if (!response.ok) setError(result.error ?? 'One or more health checks failed.'); }
    catch { setError('Health check could not reach the studio.'); }
    finally { setBusy(false); }
  }} className="flex items-center gap-2 bg-[#171717] px-3 py-2 text-[9px] text-white disabled:opacity-50">{busy ? <LoaderCircle size={12} className="animate-spin" /> : <Activity size={12} />}{busy ? 'Checking…' : 'Run private health check'}</button>
    {error && <p role="alert" className="mt-3 text-[9px] text-[#a3242b]">{error}</p>}
    {status && <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-[9px] text-[#77736d]"><dt>Database</dt><dd>{status.database}</dd><dt>Storage backend</dt><dd>{status.storageProvider} · {status.storage}</dd><dt>Upload recovery</dt><dd>{status.uploads ? `${status.uploads.receiving} active · ${status.uploads.failed} failed` : 'unknown'}</dd><dt>Generation queue</dt><dd>{status.jobs ? `${status.jobs.queued} queued · ${status.jobs.running} running · ${status.jobs.failed} failed · ${status.jobs.blocked} blocked` : 'unknown'}</dd><dt>Real generation provider</dt><dd>{status.generationProvider === 'none' ? 'not configured' : status.generationProvider}</dd></dl>}
  </div>;
}
