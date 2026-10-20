import { Buffer } from 'node:buffer';

/** Wrap a rendered catalogue JPEG as a single-page, print-size PDF without an external service. */
export function jpegPagePdf(jpeg: Buffer, pixelWidth: number, pixelHeight: number): Buffer {
  const width = Math.round(pixelWidth * 72 / 300); const height = Math.round(pixelHeight * 72 / 300);
  const content = Buffer.from(`q\n${width} 0 0 ${height} 0 0 cm\n/Im0 Do\nQ\n`, 'ascii');
  const objects: Buffer[] = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>', 'ascii'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>', 'ascii'),
    Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`, 'ascii'),
    Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${pixelWidth} /Height ${pixelHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`, 'ascii'), jpeg, Buffer.from('\nendstream', 'ascii')]),
    Buffer.concat([Buffer.from(`<< /Length ${content.length} >>\nstream\n`, 'ascii'), content, Buffer.from('endstream', 'ascii')]),
  ];
  const chunks: Buffer[] = [Buffer.from('%PDF-1.4\n%AlveronCatalogue\n', 'ascii')];
  const offsets = [0]; let offset = chunks[0].length;
  objects.forEach((object, index) => {
    offsets.push(offset);
    const entry = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`, 'ascii'), object, Buffer.from('\nendobj\n', 'ascii')]);
    chunks.push(entry); offset += entry.length;
  });
  const xrefOffset = offset;
  const xref = [`xref\n0 ${objects.length + 1}\n`, '0000000000 65535 f \n', ...offsets.slice(1).map((value) => `${String(value).padStart(10, '0')} 00000 n \n`)].join('');
  chunks.push(Buffer.from(`${xref}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`, 'ascii'));
  return Buffer.concat(chunks);
}
