import sharp, { type OverlayOptions } from 'sharp';
import { Buffer } from 'node:buffer';

function xml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}

export async function renderOriginalPhotoCatalogue(input: {
  title: string;
  style: string;
  occasion: string;
  items: Array<{ name: string; role: string; view: string; bytes: Buffer }>;
}): Promise<{ bytes: Buffer; width: number; height: number }> {
  const width = 1080; const height = 1350; const margin = 56; const gap = 24;
  const columns = 2; const cellWidth = Math.floor((width - margin * 2 - gap) / columns);
  const gridY = 294; const cellHeight = 316; const photoHeight = 260;
  const background = Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#eeeae3"/><text x="${margin}" y="64" font-family="Arial,sans-serif" font-size="18" letter-spacing="5" fill="#a3222a">ALVERON  /  PRIVATE STUDIO</text><text x="${margin}" y="136" font-family="Georgia,serif" font-size="48" fill="#171717">${xml(input.title.slice(0, 50))}</text><text x="${margin}" y="184" font-family="Arial,sans-serif" font-size="16" letter-spacing="2" fill="#55514b">${xml(`${input.style.replaceAll('-', ' ')}  ·  ${input.occasion}`.toUpperCase())}</text><line x1="${margin}" y1="220" x2="${width - margin}" y2="220" stroke="#cbc4ba"/><text x="${margin}" y="258" font-family="Arial,sans-serif" font-size="12" letter-spacing="2" fill="#777168">ORIGINAL PRODUCT PHOTOGRAPHS · SOURCE LAYOUT · NO GARMENT GENERATION</text></svg>`);
  const layers: OverlayOptions[] = [{ input: background, top: 0, left: 0 }];
  for (const [index, item] of input.items.entries()) {
    const column = index % columns; const row = Math.floor(index / columns);
    const left = margin + column * (cellWidth + gap); const top = gridY + row * (cellHeight + 22);
    const photo = await sharp(item.bytes, { limitInputPixels: 120_000_000 }).rotate().resize(cellWidth, photoHeight, { fit: 'contain', background: '#f7f5f1', withoutEnlargement: false }).png().toBuffer();
    const label = Buffer.from(`<svg width="${cellWidth}" height="56" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#f7f5f1"/><text x="16" y="23" font-family="Arial,sans-serif" font-size="13" fill="#171717">${xml(item.name.slice(0, 44))}</text><text x="16" y="43" font-family="Arial,sans-serif" font-size="10" letter-spacing="1" fill="#777168">${xml(`${item.role} · ${item.view}`.toUpperCase().slice(0, 68))}</text></svg>`);
    layers.push({ input: photo, left, top }); layers.push({ input: label, left, top: top + photoHeight });
  }
  const footer = Buffer.from(`<svg width="${width}" height="24" xmlns="http://www.w3.org/2000/svg"><text x="${margin}" y="17" font-family="Arial,sans-serif" font-size="10" letter-spacing="1" fill="#777168">VISUAL DETAILS ARE SHOWN FROM OWNER UPLOADS · VERIFY SOURCE IMAGES BEFORE APPROVAL</text></svg>`);
  layers.push({ input: footer, left: 0, top: height - 34 });
  const bytes = await sharp({ create: { width, height, channels: 3, background: '#eeeae3' } }).composite(layers).png({ compressionLevel: 8 }).toBuffer();
  return { bytes, width, height };
}
