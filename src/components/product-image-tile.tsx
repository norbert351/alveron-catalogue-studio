'use client';

import { useState } from 'react';
import { ExternalLink, FileText } from 'lucide-react';

/**
 * One original image tile in the library grid.
 *
 * Shows a preview served from the authenticated derivative route, and can open
 * the ORIGINAL at full resolution in a new tab (also authenticated). It does not
 * alter or re-encode the original; it only displays it.
 */
export function ProductImageTile({ productId, imageId, width, height, label, filename, mediaType, byteSize, sha256, hasThumbnail }: {
  productId: string; imageId: string; width: number; height: number; label: string;
  filename: string; mediaType: string; byteSize: number | string; sha256: string; hasThumbnail: boolean;
}) {
  const [showMeta, setShowMeta] = useState(false);
  const previewSrc = hasThumbnail
    ? `/api/products/${productId}/images/${imageId}/derivatives/preview`
    : `/api/products/${productId}/images/${imageId}`;
  const originalHref = `/api/products/${productId}/images/${imageId}?disposition=inline`;

  return (
    <figure className="group border border-[#e3ded6] bg-[#faf9f6]">
      <a href={originalHref} target="_blank" rel="noreferrer" className="block">
        <div className="relative aspect-square overflow-hidden bg-[#f4f1ea]">
          <img
            src={previewSrc}
            alt={label || filename}
            className="size-full object-contain transition-transform duration-300 group-hover:scale-[1.03]"
            loading="lazy"
          />
          <span className="absolute right-2 top-2 flex items-center gap-1 bg-white/90 px-1.5 py-1 text-[8px] uppercase tracking-[0.1em] text-[#171717] opacity-0 transition-opacity group-hover:opacity-100">
            <ExternalLink size={9} /> Original
          </span>
        </div>
      </a>
      <figcaption className="border-t border-[#eee9e1] px-2 py-2">
        <p className="truncate text-[9px] font-medium" title={filename}>{filename}</p>
        <div className="mt-1 flex items-center justify-between">
          <p className="text-[8px] uppercase tracking-[0.1em] text-[#938e86]">{label} · {width}×{height}</p>
          <button type="button" onClick={() => setShowMeta((value) => !value)} className="text-[8px] text-[#b6222b] underline">
            {showMeta ? 'Less' : 'Details'}
          </button>
        </div>
        {showMeta && <dl className="mt-2 space-y-1 border-t border-[#eee9e1] pt-2 text-[8px] text-[#938e86]">
          <div className="flex justify-between gap-2"><dt>Type</dt><dd className="font-mono">{mediaType}</dd></div>
          <div className="flex justify-between gap-2"><dt>Size</dt><dd className="font-mono">{Number(byteSize).toLocaleString()} B</dd></div>
          <div className="flex gap-1"><dt className="flex items-center gap-1"><FileText size={8} />SHA-256</dt></div>
          <dd className="break-all font-mono text-[7px] leading-tight">{sha256}</dd>
        </dl>}
      </figcaption>
    </figure>
  );
}
