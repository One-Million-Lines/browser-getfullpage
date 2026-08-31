import { describe, it, expect } from 'vitest';
import {
  PT_PER_CSS_PX,
  chooseBreakRow,
  paginatePdf,
  paginateSmart,
  resolvePaper,
  type PdfLayoutConfig,
} from '@/export/pdf-layout';

const a4: PdfLayoutConfig = {
  paper: 'a4',
  orientation: 'auto',
  margin: 'normal',
  customMarginPt: 24,
  ptPerPx: PT_PER_CSS_PX,
};

describe('paginatePdf', () => {
  it('splits a tall image into multiple pages that fully cover it', () => {
    const slices = paginatePdf(1000, 5000, a4);
    expect(slices.length).toBeGreaterThan(1);
    const sum = slices.reduce((a, s) => a + s.srcH, 0);
    expect(sum).toBe(5000);
    for (const s of slices) {
      expect(s.srcH).toBeGreaterThan(0);
      expect(s.drawX).toBeGreaterThanOrEqual(0);
      expect(s.drawY).toBeGreaterThanOrEqual(0);
      expect(s.drawW).toBeLessThanOrEqual(s.pageWpt + 0.01);
    }
  });

  it('fits a single page for a short image', () => {
    const slices = paginatePdf(1000, 400, a4);
    expect(slices).toHaveLength(1);
  });

  it('auto-orients a wide image to landscape', () => {
    const slices = paginatePdf(3000, 800, a4);
    expect(slices[0].pageWpt).toBeGreaterThan(slices[0].pageHpt);
  });

  it('honours an explicit portrait orientation', () => {
    const slices = paginatePdf(3000, 800, { ...a4, orientation: 'portrait' });
    expect(slices[0].pageHpt).toBeGreaterThan(slices[0].pageWpt);
  });
});

describe('resolvePaper', () => {
  it('makes "fit" pages as wide as the image plus margins', () => {
    const r = resolvePaper({ ...a4, paper: 'fit', margin: 'none' }, 1000, 4000);
    expect(r.pageWpt).toBeCloseTo(1000 * PT_PER_CSS_PX, 3);
  });
});

describe('chooseBreakRow', () => {
  const scores = new Array(200).fill(5);
  scores[103] = 0; // an empty row just past the nominal break

  it('moves the break toward the emptiest nearby row', () => {
    expect(chooseBreakRow(100, scores, 10)).toBe(103);
  });

  it('keeps the nominal break when nothing better is nearby', () => {
    const flat = new Array(200).fill(5);
    expect(chooseBreakRow(100, flat, 10)).toBe(100);
  });

  it('does not search past the array bounds', () => {
    expect(chooseBreakRow(1, [1, 1], 10)).toBe(1);
  });
});

describe('paginateSmart', () => {
  it('covers the whole image and keeps positive page heights', () => {
    const rowScores = new Array(5000).fill(4);
    for (let y = 0; y < 5000; y += 500) rowScores[y] = 0; // periodic empty rows
    const slices = paginateSmart(1000, 5000, a4, rowScores);
    const sum = slices.reduce((a, s) => a + s.srcH, 0);
    expect(sum).toBe(5000);
    for (const s of slices) expect(s.srcH).toBeGreaterThan(0);
  });
});
