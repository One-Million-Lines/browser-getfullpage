/**
 * Minimal, dependency-free PDF writer that embeds one JPEG image per page using
 * the DCTDecode filter. Keeping this in-house avoids bundling a large PDF
 * library or any remote code, and every byte is auditable (spec §7, §9 CSP).
 */

export interface PdfPageImage {
  /** JPEG-encoded bytes for this page. */
  jpeg: Uint8Array;
  /** Intrinsic pixel size of the JPEG. */
  imgWpx: number;
  imgHpx: number;
  /** Page size in PDF points (1 pt = 1/72 inch). */
  pageWpt: number;
  pageHpt: number;
  /** Placement of the image on the page, in points, origin bottom-left. */
  drawX: number;
  drawY: number;
  drawW: number;
  drawH: number;
  /** Optional single-line footer text (ASCII); drawn bottom-left. */
  footer?: string;
}

const enc = new TextEncoder();

function num(n: number): string {
  // Compact fixed notation, up to 3 decimals, no exponent.
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/\.?0+$/, '');
}

function escapePdfText(text: string): string {
  // Only printable ASCII survives; escape the special PDF string characters.
  return text
    .replace(/[^\x20-\x7e]/g, '')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

export function buildPdf(pages: PdfPageImage[]): Uint8Array {
  if (pages.length === 0) throw new Error('PDF requires at least one page');

  const chunks: Uint8Array[] = [];
  let offset = 0;
  const push = (data: Uint8Array | string) => {
    const bytes = typeof data === 'string' ? enc.encode(data) : data;
    chunks.push(bytes);
    offset += bytes.length;
  };

  // Object numbering: 1 Catalog, 2 Pages, 3 Font, then 3 objects per page.
  const objOffsets: number[] = [];
  const setOffset = (objNum: number) => {
    objOffsets[objNum] = offset;
  };

  const pageObjNum = (i: number) => 4 + i * 3;
  const contentObjNum = (i: number) => 5 + i * 3;
  const imageObjNum = (i: number) => 6 + i * 3;

  push('%PDF-1.3\n');
  // Binary marker comment so tools treat the file as binary.
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

  // 1: Catalog
  setOffset(1);
  push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

  // 2: Pages
  setOffset(2);
  const kids = pages.map((_, i) => `${pageObjNum(i)} 0 R`).join(' ');
  push(`2 0 obj\n<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>\nendobj\n`);

  // 3: Shared Helvetica font (only referenced when a footer is present).
  setOffset(3);
  push('3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n');

  pages.forEach((p, i) => {
    const imNum = imageObjNum(i);
    const ctNum = contentObjNum(i);
    const pgNum = pageObjNum(i);

    // Page object.
    setOffset(pgNum);
    const fontRes = p.footer ? ' /Font << /F1 3 0 R >>' : '';
    push(
      `${pgNum} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(p.pageWpt)} ${num(
        p.pageHpt,
      )}] /Resources << /XObject << /Im0 ${imNum} 0 R >>${fontRes} >> /Contents ${ctNum} 0 R >>\nendobj\n`,
    );

    // Content stream: draw the image, then optional footer text.
    let content = `q ${num(p.drawW)} 0 0 ${num(p.drawH)} ${num(p.drawX)} ${num(p.drawY)} cm /Im0 Do Q\n`;
    if (p.footer) {
      const text = escapePdfText(p.footer);
      content += `BT /F1 8 Tf 0.35 0.35 0.35 rg ${num(p.drawX)} ${num(
        Math.max(6, p.drawY - 12),
      )} Td (${text}) Tj ET\n`;
    }
    const contentBytes = enc.encode(content);
    setOffset(ctNum);
    push(`${ctNum} 0 obj\n<< /Length ${contentBytes.length} >>\nstream\n`);
    push(contentBytes);
    push('\nendstream\nendobj\n');

    // Image XObject.
    setOffset(imNum);
    push(
      `${imNum} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${p.imgWpx} /Height ${p.imgHpx} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`,
    );
    push(p.jpeg);
    push('\nendstream\nendobj\n');
  });

  // Cross-reference table.
  const totalObjects = 3 + pages.length * 3;
  const xrefOffset = offset;
  let xref = `xref\n0 ${totalObjects + 1}\n0000000000 65535 f \n`;
  for (let n = 1; n <= totalObjects; n++) {
    const off = objOffsets[n] ?? 0;
    xref += `${String(off).padStart(10, '0')} 00000 n \n`;
  }
  push(xref);
  push(
    `trailer\n<< /Size ${totalObjects + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
  );

  // Concatenate.
  const total = chunks.reduce((a, c) => a + c.length, 0);
  const out = new Uint8Array(total);
  let p = 0;
  for (const c of chunks) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}
