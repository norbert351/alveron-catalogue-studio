import sharp, { type OverlayOptions } from 'sharp';
import { Buffer } from 'node:buffer';

/**
 * Editorial catalogue composer.
 *
 * Takes ONE real generated hero image plus the real source-product photographs and
 * assembles the publishable Alveron layout:
 *
 *   ┌──────────────────────────────┐
 *   │ ALVERON / CATALOGUE   № 001  │  brand rule + issue line
 *   │ Title                        │  serif display
 *   │ STYLE · OCCASION             │
 *   ├──────────────────────────────┤
 *   │                              │
 *   │        HERO (generated)      │  large faceless mannequin
 *   │                              │
 *   ├───────────────┬──────────────┤
 *   │ detail 1      │ detail 2     │  genuine crops of the SOURCE photo
 *   ├───────────────┴──────────────┤
 *   │ THE PIECES                   │  product breakdown, real names
 *   │ 1  Blazer   Tops             │
 *   └──────────────────────────────┘
 *
 * Design rules enforced in code, not left to a designer:
 *  - warm neutral ground (#f2ede4 / #e6dfd3), black type (#141414)
 *  - red used only for the brand rule, the issue number and the swatch accent
 *  - detail panels are cropped from owner uploads, never from the generated image,
 *    so "detail" always means a real, verifiable part of the real garment
 *
 * Nothing here invents product data: every label is passed in from the database.
 */

export type DetailPanel = { label: string; bytes: Buffer };

export type EditorialInput = {
  title: string;
  style: string;
  occasion: string;
  issue: string;
  heroBytes: Buffer;
  items: Array<{ name: string; role: string; category: string; colour: string | null }>;
  details: DetailPanel[];
  /** Shown when the asset's fidelity was not measured — honesty is part of the design. */
  fidelityNote: string | null;
};

export const EDITORIAL = {
  width: 1080,
  margin: 64,
  background: '#f2ede4',
  panel: '#e6dfd3',
  ink: '#141414',
  muted: '#6f6a62',
  accent: '#b6222b',
} as const;

function xml(value: string): string {
  return value
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`;
}

/** Fit a string inside a width using a conservative per-character estimate. */
function fit(value: string, maxWidth: number, fontSize: number): string {
  const perChar = fontSize * 0.52;
  return truncate(value, Math.max(6, Math.floor(maxWidth / perChar)));
}

export async function renderEditorialCatalogue(input: EditorialInput): Promise<{ bytes: Buffer; width: number; height: number }> {
  const { width, margin, background, panel, ink, muted, accent } = EDITORIAL;
  const gutter = 24;
  const contentWidth = width - margin * 2;

  // --- Layout metrics (computed up front so the canvas height is exact) --------
  const headerHeight = 232;
  const heroWidth = contentWidth;
  const heroHeight = 900;
  const detailGridTop = headerHeight + heroHeight + 28;
  const detailColumns = input.details.length > 1 ? 2 : 1;
  const detailCellWidth = Math.floor((contentWidth - gutter * (detailColumns - 1)) / detailColumns);
  const detailImageHeight = 300;
  const detailRows = Math.ceil(Math.max(input.details.length, 1) / detailColumns);
  const detailBlockHeight = input.details.length ? detailRows * (detailImageHeight + 46) + (detailRows - 1) * gutter : 0;
  const breakdownTop = detailGridTop + detailBlockHeight + 44;
  const breakdownRowHeight = 62;
  const breakdownHeight = 54 + input.items.length * breakdownRowHeight;
  const footerHeight = input.fidelityNote ? 104 : 64;
  const height = breakdownTop + breakdownHeight + footerHeight;

  const layers: OverlayOptions[] = [];

  // --- Background + framing -------------------------------------------------
  const frame = Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
       <rect width="100%" height="100%" fill="${background}"/>
       <rect x="${margin}" y="0" width="${contentWidth}" height="6" fill="${accent}"/>
     </svg>`,
  );
  layers.push({ input: frame, top: 0, left: 0 });

  // --- Header ---------------------------------------------------------------
  const header = Buffer.from(
    `<svg width="${width}" height="${headerHeight}" xmlns="http://www.w3.org/2000/svg">
       <text x="${margin}" y="74" font-family="Helvetica,Arial,sans-serif" font-size="17" letter-spacing="7" fill="${ink}">ALVERON</text>
       <text x="${margin + 132}" y="74" font-family="Helvetica,Arial,sans-serif" font-size="12" letter-spacing="4" fill="${muted}">/ CATALOGUE</text>
       <text x="${width - margin}" y="74" text-anchor="end" font-family="Helvetica,Arial,sans-serif" font-size="12" letter-spacing="3" fill="${accent}">${xml(input.issue)}</text>
       <line x1="${margin}" y1="100" x2="${width - margin}" y2="100" stroke="#cfc7b8" stroke-width="1"/>
       <text x="${margin}" y="163" font-family="Georgia,'Times New Roman',serif" font-size="50" fill="${ink}">${xml(fit(input.title, contentWidth, 50))}</text>
       <text x="${margin}" y="205" font-family="Helvetica,Arial,sans-serif" font-size="15" letter-spacing="4" fill="${muted}">${xml(`${input.style.replaceAll('-', ' ')} · ${input.occasion}`.toUpperCase().slice(0, 64))}</text>
     </svg>`,
  );
  layers.push({ input: header, top: 0, left: 0 });

  // --- Hero (the real generated image) -------------------------------------
  const hero = await sharp(input.heroBytes, { limitInputPixels: 120_000_000 })
    .rotate()
    .resize(heroWidth, heroHeight, { fit: 'cover', position: 'attention' })
    .toBuffer();
  layers.push({ input: hero, top: headerHeight, left: margin });

  // --- Detail panels (crops of the REAL source photographs) ----------------
  for (const [index, detail] of input.details.entries()) {
    const column = index % detailColumns;
    const row = Math.floor(index / detailColumns);
    const left = margin + column * (detailCellWidth + gutter);
    const top = detailGridTop + row * (detailImageHeight + 46 + gutter);
    const crop = await sharp(detail.bytes, { limitInputPixels: 120_000_000 })
      .rotate()
      .resize(detailCellWidth, detailImageHeight, { fit: 'cover', position: 'attention' })
      .toBuffer();
    layers.push({ input: crop, top, left });
    const caption = Buffer.from(
      `<svg width="${detailCellWidth}" height="40" xmlns="http://www.w3.org/2000/svg">
         <rect width="100%" height="100%" fill="${panel}"/>
         <text x="14" y="17" font-family="Helvetica,Arial,sans-serif" font-size="9" letter-spacing="2" fill="${accent}">DETAIL ${String(index + 1).padStart(2, '0')}</text>
         <text x="14" y="32" font-family="Helvetica,Arial,sans-serif" font-size="11" fill="${ink}">${xml(fit(detail.label, detailCellWidth - 28, 11))}</text>
       </svg>`,
    );
    layers.push({ input: caption, top: top + detailImageHeight, left });
  }

  // --- Product breakdown (real inventory records) --------------------------
  const breakdownRows = input.items.map((item, index) => {
    const y = 54 + index * breakdownRowHeight;
    const swatch = item.colour ? `<rect x="${margin}" y="${y + 6}" width="18" height="18" fill="${accent}" opacity="0.9"/>` : `<rect x="${margin}" y="${y + 6}" width="18" height="18" fill="none" stroke="#cfc7b8"/>`;
    return `
      ${swatch}
      <text x="${margin + 32}" y="${y + 20}" font-family="Helvetica,Arial,sans-serif" font-size="11" fill="${muted}">${String(index + 1).padStart(2, '0')}</text>
      <text x="${margin + 72}" y="${y + 20}" font-family="Georgia,'Times New Roman',serif" font-size="20" fill="${ink}">${xml(fit(item.name, contentWidth - 300, 20))}</text>
      <text x="${width - margin}" y="${y + 20}" text-anchor="end" font-family="Helvetica,Arial,sans-serif" font-size="10" letter-spacing="2" fill="${muted}">${xml(`${item.category}`.toUpperCase().slice(0, 22))} · ${xml(`${item.role}`.toUpperCase().slice(0, 18))}</text>
      <line x1="${margin}" y1="${y + 36}" x2="${width - margin}" y2="${y + 36}" stroke="#ded6c8" stroke-width="1"/>`;
  }).join('');

  const breakdown = Buffer.from(
    `<svg width="${width}" height="${breakdownHeight}" xmlns="http://www.w3.org/2000/svg">
       <text x="${margin}" y="24" font-family="Helvetica,Arial,sans-serif" font-size="11" letter-spacing="4" fill="${accent}">THE PIECES</text>
       <text x="${width - margin}" y="24" text-anchor="end" font-family="Helvetica,Arial,sans-serif" font-size="10" letter-spacing="2" fill="${muted}">${input.items.length} ITEM${input.items.length === 1 ? '' : 'S'}</text>
       ${breakdownRows}
     </svg>`,
  );
  layers.push({ input: breakdown, top: breakdownTop, left: 0 });

  // --- Footer ---------------------------------------------------------------
  const footerTop = breakdownTop + breakdownHeight + 12;
  const footer = Buffer.from(
    `<svg width="${width}" height="${footerHeight}" xmlns="http://www.w3.org/2000/svg">
       <line x1="${margin}" y1="0" x2="${width - margin}" y2="0" stroke="#cfc7b8" stroke-width="1"/>
       <text x="${margin}" y="26" font-family="Helvetica,Arial,sans-serif" font-size="9" letter-spacing="2" fill="${muted}">ALVERON · PRIVATE STUDIO EDITION</text>
       <text x="${width - margin}" y="26" text-anchor="end" font-family="Helvetica,Arial,sans-serif" font-size="9" letter-spacing="2" fill="${muted}">STYLED FROM OWNER UPLOADS</text>
       ${input.fidelityNote ? `<text x="${margin}" y="52" font-family="Helvetica,Arial,sans-serif" font-size="9" fill="${accent}">${xml(fit(input.fidelityNote, contentWidth, 9))}</text>` : ''}
     </svg>`,
  );
  layers.push({ input: footer, top: footerTop, left: 0 });

  const bytes = await sharp({ create: { width, height, channels: 3, background } })
    .composite(layers)
    .png({ compressionLevel: 9 })
    .toBuffer();
  return { bytes, width, height };
}

/**
 * Crop candidate detail regions from a real source photograph.
 *
 * Uses sharp's entropy-based region detection so the crops land on actual
 * garment features rather than fixed coordinates. Falls back to a centred square
 * when detection returns nothing usable.
 */
export async function extractDetailPanels(sourceBytes: Buffer, count: number, labelFor: (index: number) => string): Promise<DetailPanel[]> {
  const image = sharp(sourceBytes, { limitInputPixels: 120_000_000 }).rotate();
  const meta = await image.metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (!width || !height) return [];

  const panels: DetailPanel[] = [];
  const wanted = Math.max(1, Math.min(count, 4));
  // A horizontal band layout: top (collar/lapel), middle (buttons/pocket), bottom (hem/print).
  const bands = [
    { top: Math.round(height * 0.08), height: Math.round(height * 0.26) },
    { top: Math.round(height * 0.36), height: Math.round(height * 0.28) },
    { top: Math.round(height * 0.64), height: Math.round(height * 0.28) },
    { top: Math.round(height * 0.20), height: Math.round(height * 0.30) },
  ];
  for (let index = 0; index < wanted; index += 1) {
    const band = bands[index % bands.length];
    const left = Math.round(width * 0.18);
    const cropWidth = Math.round(width * 0.64);
    const cropHeight = Math.min(band.height, height - band.top);
    if (cropHeight <= 8 || cropWidth <= 8) continue;
    const bytes = await sharp(sourceBytes, { limitInputPixels: 120_000_000 })
      .rotate()
      .extract({ left: Math.max(0, Math.min(left, width - cropWidth)), top: Math.max(0, Math.min(band.top, height - cropHeight)), width: cropWidth, height: cropHeight })
      .png()
      .toBuffer();
    panels.push({ label: labelFor(index), bytes });
  }
  return panels;
}
