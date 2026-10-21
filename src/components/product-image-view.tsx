'use client';

import { useState } from 'react';

/**
 * Renders a product image, preferring a small display derivative.
 *
 * Loading order: thumbnail -> original. The original is the source of truth, so
 * a missing, corrupt, or stale derivative never hides a real photograph. Each
 * step is an authenticated private route; nothing is publicly cached.
 */
export function ProductImageView({
  productId,
  imageId,
  hasThumbnail,
  alt,
  sizes,
  className = 'object-contain',
  kind = 'thumbnail',
}: {
  productId: string;
  imageId: string;
  hasThumbnail?: boolean;
  alt: string;
  sizes: string;
  className?: string;
  kind?: 'thumbnail' | 'preview';
}) {
  const original = `/api/products/${productId}/images/${imageId}`;
  const derivative = `/api/products/${productId}/images/${imageId}/derivatives/${kind}`;
  const [source, setSource] = useState(hasThumbnail ? derivative : original);

  return (
    // A plain <img> is used deliberately: these files come from authenticated
    // private routes, so next/image optimisation cannot be applied to them.
    <img
      src={source}
      alt={alt}
      sizes={sizes}
      loading="lazy"
      decoding="async"
      className={`absolute inset-0 h-full w-full ${className}`}
      onError={() => { if (source !== original) setSource(original); }}
    />
  );
}
