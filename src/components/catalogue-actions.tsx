'use client';

import { useState } from 'react';
import type { CatalogueSummary } from '@/lib/catalogues';

export function CatalogueActions({ catalogueId, status, assetId, approved }: { catalogueId: string; status: CatalogueSummary['status']; assetId?: string; approved?: boolean }) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [reason, setReason] = useState('');
  async function jsonAction(action: string, url: string, payload: unknown) {
    setBusy(action); setError(''); setMessage('');
    try {
      const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const result = await response.json() as { error?: string; status?: string; jobId?: string };
      if (!response.ok) setError(result.error ?? `${action} failed.`);
      else { setMessage(result.jobId ? `Generation job ${result.status}: ${result.jobId}` : `${action} completed.`); window.location.reload(); }
    } catch { setError('Could not reach the studio.'); }
    finally { setBusy(''); }
  }
  async function exportFile(format: 'png' | 'jpeg' | 'pdf') {
    if (!assetId) return;
    setBusy(`export-${format}`); setError(''); setMessage('');
    try {
      const response = await fetch(`/api/catalogues/${catalogueId}/export`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ assetId, format, dimensions: '1080x1350' }) });
      if (!response.ok) { const result = await response.json() as { error?: string }; setError(result.error ?? 'Export failed.'); return; }
      const blob = await response.blob(); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = response.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] ?? `alveron-catalogue.${format}`; link.click(); URL.revokeObjectURL(url); setMessage(`Approved ${format.toUpperCase()} downloaded.`); window.location.reload();
    } catch { setError('Could not reach the studio.'); }
    finally { setBusy(''); }
  }
  const workingStatus = ['draft', 'review', 'rejected', 'failed'].includes(status);
  return <div className="flex flex-wrap gap-2">
    {workingStatus && <button disabled={!!busy} onClick={() => void jsonAction('compose', `/api/catalogues/${catalogueId}/compose`, {})} className="border border-[#171717] px-3 py-2 text-[9px] font-medium disabled:opacity-40">{busy === 'compose' ? 'Composing…' : assetId ? 'Create new original-photo version' : 'Compose from original photos'}</button>}
    {status === 'review' && assetId && <>
      <button disabled={!!busy} onClick={() => void jsonAction('approve', `/api/catalogues/${catalogueId}/decision`, { decision: 'approve', assetId })} className="bg-[#171717] px-3 py-2 text-[9px] font-medium text-white disabled:opacity-40">{busy === 'approve' ? 'Approving…' : 'Approve this exact output'}</button>
      <div className="flex w-full flex-col gap-2 sm:flex-row"><input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={2000} minLength={3} placeholder="Reason for rejection or requested correction" className="field text-[9px]" /><button disabled={!!busy || reason.trim().length < 3} onClick={() => void jsonAction('reject', `/api/catalogues/${catalogueId}/decision`, { decision: 'reject', assetId, reason })} className="border border-[#b6222b] px-3 py-2 text-[9px] text-[#9e2028] disabled:opacity-40">Reject output</button><button disabled={!!busy || reason.trim().length < 3} onClick={() => void jsonAction('correction', `/api/catalogues/${catalogueId}/decision`, { decision: 'correction', reason })} className="border border-[#ded8cf] px-3 py-2 text-[9px] disabled:opacity-40">Request corrections</button></div>
    </>}
    {approved && assetId && <><button disabled={!!busy} onClick={() => void exportFile('png')} className="border border-[#171717] px-3 py-2 text-[9px] disabled:opacity-40">{busy === 'export-png' ? 'Exporting…' : 'Download PNG'}</button><button disabled={!!busy} onClick={() => void exportFile('jpeg')} className="border border-[#171717] px-3 py-2 text-[9px] disabled:opacity-40">Download JPEG</button><button disabled={!!busy} onClick={() => void exportFile('pdf')} className="border border-[#171717] px-3 py-2 text-[9px] disabled:opacity-40">Download PDF</button></>}
    {message && <p role="status" className="w-full text-[9px] text-[#477047]">{message}</p>}{error && <p role="alert" className="w-full text-[9px] text-[#a3242b]">{error}</p>}
  </div>;
}
