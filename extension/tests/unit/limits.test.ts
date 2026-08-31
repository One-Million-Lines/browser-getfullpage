import { describe, it, expect } from 'vitest';
import { decideSize, estimateBytes, tileRows } from '@/capture/limits';

describe('estimateBytes', () => {
  it('accounts for RGBA plus working overhead', () => {
    expect(estimateBytes(1000, 1000, 1)).toBe(4_000_000);
    expect(estimateBytes(1000, 1000, 1.5)).toBe(6_000_000);
  });
});

describe('decideSize', () => {
  const ceiling = 512 * 1024 * 1024;

  it('keeps scale 1 when within all limits', () => {
    const d = decideSize(1280, 4000, ceiling);
    expect(d.scale).toBe(1);
    expect(d.fitsSingleCanvas).toBe(true);
    expect(d.fitsMemory).toBe(true);
    expect(d.note).toBeUndefined();
  });

  it('downscales when a side exceeds the canvas limit', () => {
    const d = decideSize(2000, 40000, ceiling, { maxSide: 16384, maxArea: 1e12 });
    expect(d.scale).toBeLessThan(1);
    expect(Math.round(40000 * d.scale)).toBeLessThanOrEqual(16384);
    expect(d.note).toMatch(/Scaled to/);
  });

  it('downscales when the memory ceiling is exceeded', () => {
    const small = 32 * 1024 * 1024; // 32 MiB
    const d = decideSize(8000, 8000, small);
    expect(d.scale).toBeLessThan(1);
    expect(d.estimatedBytes).toBeLessThanOrEqual(small * 1.05);
  });

  it('reports without downscaling when downscale is disallowed', () => {
    const d = decideSize(40000, 40000, ceiling, { allowDownscale: false });
    expect(d.scale).toBe(1);
    expect(d.fitsSingleCanvas).toBe(false);
    expect(d.note).toMatch(/tiled/i);
  });
});

describe('tileRows', () => {
  it('splits a tall image into bands no taller than the max side', () => {
    const bands = tileRows(40000, 16384);
    expect(bands[0]).toEqual([0, 16384]);
    expect(bands[bands.length - 1][1]).toBe(40000);
    for (const [a, b] of bands) expect(b - a).toBeLessThanOrEqual(16384);
  });

  it('returns a single band for short images', () => {
    expect(tileRows(500, 16384)).toEqual([[0, 500]]);
  });
});
