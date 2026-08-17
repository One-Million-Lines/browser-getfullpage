import { describe, it, expect } from 'vitest';
import { fullPhysicalSize, pxPerCss, toMasterY } from '@/capture/geometry';
import { isRpcResponse } from '@/shared/messages';

describe('geometry (DPR/zoom conversions)', () => {
  it('derives physical pixels per CSS pixel from the captured bitmap', () => {
    expect(pxPerCss(2000, 1000)).toBe(2); // DPR 2
    expect(pxPerCss(1000, 1000)).toBe(1); // DPR 1
    expect(pxPerCss(1250, 1000)).toBe(1.25); // 125% zoom / DPR 1.25
  });

  it('maps a CSS scroll offset to a master-canvas row', () => {
    expect(toMasterY(500, 2, 1)).toBe(1000);
    expect(toMasterY(500, 2, 0.5)).toBe(500); // with a 50% downscale
  });

  it('computes full physical size from measured values', () => {
    expect(fullPhysicalSize(2400, 3000, 2)).toEqual({ widthPx: 2400, heightPx: 6000 });
  });
});

describe('message discrimination', () => {
  it('detects rpc responses vs content events', () => {
    expect(isRpcResponse({ id: 1, ok: true })).toBe(true);
    expect(isRpcResponse({ event: 'cancel' })).toBe(false);
    expect(isRpcResponse({ event: 'ready' })).toBe(false);
  });
});
