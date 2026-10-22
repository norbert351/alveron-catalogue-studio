'use client';

import { useCallback, useEffect, useState } from 'react';

type Status = {
  database: string;
  storageProvider: string;
  storage: string;
  library: { products: number; images: number; originalBytes: number; pendingUploads: number; failedUploads: number };
};

function size(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/** Live health check for the library. Reports only library state — no catalogue or AI status. */
export function SettingsHealthCheck() {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const response = await fetch('/api/settings/health', { method: 'POST', cache: 'no-store' });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? `Health check failed (${response.status}).`);
      setStatus(body as Status);
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => { if (!cancelled) void run(); }, 0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [run]);

  return <section className="border border-[#e3ded6] bg-white p-5">
    <div className="flex items-center justify-between gap-2">
      <p className="text-[9px] uppercase tracking-[0.2em] text-[#b6222b]">Health</p>
      <button type="button" onClick={run} disabled={busy} className="text-[9px] uppercase tracking-[0.12em] underline disabled:opacity-40">
        {busy ? 'Checking…' : 'Re-check'}
      </button>
    </div>
    <h2 className="display-serif mt-2 text-[18px]">Storage &amp; database</h2>
    {error && <p className="mt-3 text-[10px] text-[#962a2e]">{error}</p>}
    {status && <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-[9px] text-[#77736d]">
      <dt>Database</dt><dd>{status.database}</dd>
      <dt>Storage backend</dt><dd>{status.storageProvider} · {status.storage}</dd>
      <dt>Products</dt><dd>{status.library.products}</dd>
      <dt>Images</dt><dd>{status.library.images}</dd>
      <dt>Original bytes</dt><dd>{size(status.library.originalBytes)}</dd>
      <dt>Failed uploads</dt><dd>{status.library.failedUploads}</dd>
    </dl>}
  </section>;
}
