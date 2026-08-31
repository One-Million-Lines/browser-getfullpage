import { describe, it, expect } from 'vitest';
import { shouldHideFixed } from '@/capture/fixed-classify';

const VW = 1200;
const VH = 800;
const rect = (top: number, left: number, w: number, h: number) => ({
  top,
  left,
  width: w,
  height: h,
  right: left + w,
  bottom: top + h,
});

describe('shouldHideFixed', () => {
  it('hides a fixed header at the top edge', () => {
    expect(shouldHideFixed(rect(0, 0, VW, 60), VW, VH)).toBe(true);
  });

  it('hides a fixed footer / cookie bar at the bottom edge', () => {
    expect(shouldHideFixed(rect(VH - 50, 0, VW, 50), VW, VH)).toBe(true);
  });

  it('hides a floating chat button in the corner', () => {
    expect(shouldHideFixed(rect(VH - 90, VW - 90, 64, 64), VW, VH)).toBe(true);
  });

  it('keeps a full-viewport app container (main content)', () => {
    expect(shouldHideFixed(rect(0, 0, VW, VH), VW, VH)).toBe(false);
  });

  it('keeps a mid-page element not touching any edge', () => {
    expect(shouldHideFixed(rect(300, 400, 200, 100), VW, VH)).toBe(false);
  });

  it('ignores zero-size elements', () => {
    expect(shouldHideFixed(rect(0, 0, 0, 0), VW, VH)).toBe(false);
  });

  it('ignores elements fully outside the viewport', () => {
    expect(shouldHideFixed(rect(-200, 0, VW, 100), VW, VH)).toBe(false);
  });
});
