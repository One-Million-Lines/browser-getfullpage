import { describe, it, expect } from 'vitest';
import { buildPdf, type PdfPageImage } from '@/export/pdf-writer';

function fakeJpeg(size = 16): Uint8Array {
  const b = new Uint8Array(size);
  b[0] = 0xff;
  b[1] = 0xd8; // SOI
  b[size - 2] = 0xff;
  b[size - 1] = 0xd9; // EOI
  return b;
}

function page(jpeg: Uint8Array, footer?: string): PdfPageImage {
  return {
    jpeg,
    imgWpx: 100,
    imgHpx: 200,
    pageWpt: 595,
    pageHpt: 842,
    drawX: 36,
    drawY: 100,
    drawW: 523,
    drawH: 700,
    footer,
  };
}

function asLatin1(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return s;
}

describe('buildPdf', () => {
  it('writes a valid PDF header and trailer', () => {
    const bytes = buildPdf([page(fakeJpeg())]);
    const text = asLatin1(bytes);
    expect(text.startsWith('%PDF-1.3')).toBe(true);
    expect(text).toContain('%%EOF');
    expect(text).toContain('/Type /Catalog');
    expect(text).toContain('xref');
    expect(text).toContain('startxref');
  });

  it('embeds the JPEG with DCTDecode and correct object count', () => {
    const bytes = buildPdf([page(fakeJpeg()), page(fakeJpeg())]);
    const text = asLatin1(bytes);
    expect(text).toContain('/Filter /DCTDecode');
    expect(text).toContain('/Count 2');
    // 3 base objects + 3 per page * 2 pages = 9 objects, trailer Size 10.
    expect(text).toContain('/Size 10');
  });

  it('includes footer text only when provided', () => {
    const withFooter = asLatin1(buildPdf([page(fakeJpeg(), 'Hello (World)')]));
    expect(withFooter).toContain('/F1 3 0 R'); // page references the shared font
    expect(withFooter).toContain('Hello \\(World\\)'); // parentheses escaped
    const without = asLatin1(buildPdf([page(fakeJpeg())]));
    expect(without).not.toContain('/F1'); // no font resource referenced on the page
  });

  it('throws when there are no pages', () => {
    expect(() => buildPdf([])).toThrow();
  });

  it('preserves the JPEG byte length in the stream length', () => {
    const jpeg = fakeJpeg(64);
    const text = asLatin1(buildPdf([page(jpeg)]));
    expect(text).toContain(`/Length ${jpeg.length}`);
  });
});
