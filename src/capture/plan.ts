import { SLICE_OVERLAP_CSS_PX } from '@/shared/constants';
import type { CapturePlan, PageMeasurement, SlicePlan } from '@/shared/types';

export interface PlanOptions {
  maxPageHeightPx: number;
  maxSlices: number;
  /** 'viewport' mode captures a single screen; 'full' scrolls the document. */
  mode?: 'full' | 'viewport';
}

/**
 * Build a top-to-bottom capture plan from a page measurement.
 *
 * Slices step by (viewport - overlap) so consecutive captures share a 1–2 CSS
 * pixel band, which the compositor overwrites to hide rounding seams (spec §5.3).
 * The final position is clamped to the maximum scroll so the bottom edge is
 * always fully covered, and each slice records the usable content height so the
 * last slice is cropped to the remaining document height.
 */
export function planCapture(m: PageMeasurement, opts: PlanOptions): CapturePlan {
  const viewport = Math.max(1, Math.floor(m.viewportHeight));
  const totalWidthCss = Math.max(1, Math.round(m.viewportWidth));

  const mode = opts.mode ?? 'full';
  const rawHeight = mode === 'viewport' ? viewport : Math.max(viewport, Math.round(m.docHeight));

  let truncated = false;
  let truncationReason: string | undefined;
  let totalHeight = rawHeight;
  if (totalHeight > opts.maxPageHeightPx) {
    totalHeight = opts.maxPageHeightPx;
    truncated = true;
    truncationReason = `Page height ${rawHeight}px exceeds the ${opts.maxPageHeightPx}px limit.`;
  }

  const overlap = viewport > SLICE_OVERLAP_CSS_PX * 2 ? SLICE_OVERLAP_CSS_PX : 0;
  const step = Math.max(1, viewport - overlap);
  const maxScroll = Math.max(0, totalHeight - viewport);

  const slices: SlicePlan[] = [];
  let y = 0;
  while (y < totalHeight) {
    const scrollY = Math.min(y, maxScroll);
    slices.push({
      index: slices.length,
      scrollY,
      sliceHeightCss: Math.min(viewport, totalHeight - scrollY),
    });
    if (scrollY >= maxScroll) break;
    if (slices.length >= opts.maxSlices) {
      truncated = true;
      truncationReason = `Reached the ${opts.maxSlices}-slice safety limit.`;
      break;
    }
    y += step;
  }
  if (slices.length === 0) {
    slices.push({ index: 0, scrollY: 0, sliceHeightCss: Math.min(viewport, totalHeight) });
  }

  return {
    totalWidthCss,
    totalHeightCss: totalHeight,
    viewportHeightCss: viewport,
    stepCss: step,
    overlapCss: overlap,
    slices,
    truncated,
    truncationReason,
  };
}

/**
 * Extend the plan when lazy loading grew the document, bounded by the same
 * safety limits. Returns a new plan or the original when no growth is detected.
 */
export function maybeExtendPlan(
  plan: CapturePlan,
  measuredHeightCss: number,
  opts: PlanOptions,
): CapturePlan {
  if (plan.truncated) return plan;
  if (measuredHeightCss <= plan.totalHeightCss + 1) return plan;
  return planCapture(
    {
      docHeight: measuredHeightCss,
      viewportHeight: plan.viewportHeightCss,
      viewportWidth: plan.totalWidthCss,
      docWidth: plan.totalWidthCss,
      devicePixelRatio: 1,
      zoom: 1,
      originalScrollX: 0,
      originalScrollY: 0,
      usesScrollContainer: false,
      fixedCount: 0,
    },
    opts,
  );
}
