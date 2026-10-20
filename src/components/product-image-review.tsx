'use client';

import { useState } from 'react';
import Image from 'next/image';
import { Check, LoaderCircle } from 'lucide-react';

export function ProductImageReview({ productId, imageId, width, height, label, initialReviewed, filename, mediaType, byteSize, sha256, createdAt, current }: { productId: string; imageId: string; width: number; height: number; label: string; initialReviewed: boolean; filename: string; mediaType: string; byteSize: number; sha256: string; createdAt: string; current: boolean }) {
  const [reviewed, setReviewed] = useState(initialReviewed);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return <div className="overflow-hidden border border-[#e7e2da] bg-white">
    <div className="relative aspect-[4/5] bg-[#eeebe5]">
      <Image unoptimized fill sizes="(max-width: 768px) 50vw, 220px" src={`/api/products/${productId}/images/${imageId}`} alt={`${label} · original product photograph`} className="object-contain" />
      <span className="absolute left-2 top-2 bg-white/90 px-2 py-1 text-[8px] uppercase tracking-[0.12em] text-[#57524c]">Original</span>
    </div>
    <div className="p-3"><div className="flex items-center justify-between gap-2"><span className="text-[10px] font-medium">{label}{!current && <span className="ml-1 text-[8px] text-[#938e86]">· previous version</span>}</span><span className="text-[8px] text-[#938e86]">{width} × {height}</span></div>
      <p className="mt-2 truncate text-[8px] text-[#938e86]" title={filename}>{filename} · {mediaType} · {(byteSize / 1024).toFixed(0)} KB</p><p className="mt-1 truncate font-mono text-[7px] text-[#aaa39a]" title={sha256}>SHA-256 {sha256}</p><p className="mt-1 text-[8px] text-[#aaa39a]">Uploaded {createdAt ? new Date(createdAt).toLocaleDateString() : 'date unavailable'}</p>
      <button disabled={reviewed || busy} onClick={async () => {
        setBusy(true); setError('');
        try {
          const response = await fetch(`/api/products/${productId}/images/${imageId}`, { method: 'POST' });
          const result = await response.json() as { error?: string };
          if (!response.ok) setError(result.error ?? 'Could not save review.'); else setReviewed(true);
        } catch { setError('Could not reach the studio.'); }
        finally { setBusy(false); }
      }} className={`mt-3 flex h-8 w-full items-center justify-center gap-1.5 text-[9px] font-medium ${reviewed ? 'border border-[#d3e2d2] bg-[#f2f8f1] text-[#42734a]' : 'bg-[#171717] text-white hover:bg-[#b6222b]'}`}>
        {busy ? <LoaderCircle size={12} className="animate-spin" /> : reviewed ? <Check size={12} /> : null}{reviewed ? 'Image reviewed' : 'Review this image'}
      </button>{error && <p role="alert" className="mt-2 text-[9px] text-[#a3242b]">{error}</p>}
    </div>
  </div>;
}
