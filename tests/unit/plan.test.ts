import { describe, it, expect } from 'vitest';
import { maybeExtendPlan, planCapture, type PlanOptions } from '@/capture/plan';
import type { PageMeasurement } from '@/shared/types';

function measurement(docHeight: number, viewportHeight = 800, viewportWidth = 1200): PageMeasurement {
  return {
    docWidth: viewportWidth,
    docHeight,
    viewportWidth,
    viewportHeight,
    originalScrollX: 0,
    originalScrollY: 0,
    devicePixelRatio: 1,
    zoom: 1,
    usesScrollContainer: false,
    fixedCount: 0,
  };
}

const opts: PlanOptions = { maxPageHeightPx: 60000, maxSlices: 240 };

describe('planCapture', () => {
  it('produces a single slice for a one-viewport page', () => {
    const plan = planCapture(measurement(800), opts);
    expect(plan.slices).toHaveLength(1);
    expect(plan.slices[0]).toMatchObject({ index: 0, scrollY: 0, sliceHeightCss: 800 });
    expect(plan.totalHeightCss).toBe(800);
    expect(plan.totalWidthCss).toBe(1200);
    expect(plan.truncated).toBe(false);
  });

  it('clamps a sub-viewport document up to the viewport height', () => {
    const plan = planCapture(measurement(500, 800), opts);
    expect(plan.totalHeightCss).toBe(800);
    expect(plan.slices).toHaveLength(1);
  });

  it('steps by (viewport - overlap) and clamps the final slice to the bottom', () => {
    const plan = planCapture(measurement(2000, 800), opts);
    const ys = plan.slices.map((s) => s.scrollY);
    expect(ys[0]).toBe(0);
    expect(plan.overlapCss).toBe(2);
    expect(plan.stepCss).toBe(798);
    // Last slice reaches the max scroll so the bottom edge is fully covered.
    expect(ys[ys.length - 1]).toBe(1200);
    // Slices with overlap fully cover [0, totalHeight] with no gaps.
    for (let i = 1; i < plan.slices.length; i++) {
      expect(plan.slices[i].scrollY).toBeLessThanOrEqual(plan.slices[i - 1].scrollY + 800);
    }
  });

  it('crops the last slice to the remaining document height', () => {
    const plan = planCapture(measurement(1000, 800), opts);
    const last = plan.slices[plan.slices.length - 1];
    expect(last.scrollY).toBe(200); // maxScroll = 1000 - 800
    expect(last.sliceHeightCss).toBe(800);
  });

  it('truncates when the document exceeds the max page height', () => {
    const plan = planCapture(measurement(100000, 800), opts);
    expect(plan.truncated).toBe(true);
    expect(plan.totalHeightCss).toBe(60000);
    expect(plan.truncationReason).toMatch(/exceeds/);
  });

  it('truncates when the slice cap is reached', () => {
    const plan = planCapture(measurement(100000, 800), { maxPageHeightPx: 200000, maxSlices: 5 });
    expect(plan.slices.length).toBe(5);
    expect(plan.truncated).toBe(true);
    expect(plan.truncationReason).toMatch(/slice/);
  });

  it('captures a single screen in viewport mode', () => {
    const plan = planCapture(measurement(5000, 800), { ...opts, mode: 'viewport' });
    expect(plan.totalHeightCss).toBe(800);
    expect(plan.slices).toHaveLength(1);
  });

  it('uses zero overlap for a tiny viewport', () => {
    const plan = planCapture(measurement(30, 3), opts);
    expect(plan.overlapCss).toBe(0);
    expect(plan.stepCss).toBe(3);
  });
});

describe('maybeExtendPlan', () => {
  it('extends the plan when the document grew from lazy loading', () => {
    const base = planCapture(measurement(2000, 800), opts);
    const extended = maybeExtendPlan(base, 3000, opts);
    expect(extended.totalHeightCss).toBe(3000);
    expect(extended.slices.length).toBeGreaterThan(base.slices.length);
  });

  it('does not shrink or change a stable plan', () => {
    const base = planCapture(measurement(2000, 800), opts);
    expect(maybeExtendPlan(base, 2000, opts)).toBe(base);
  });

  it('never extends a truncated plan', () => {
    const base = planCapture(measurement(100000, 800), opts);
    expect(maybeExtendPlan(base, 150000, opts)).toBe(base);
  });
});
