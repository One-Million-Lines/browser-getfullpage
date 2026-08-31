export interface RectLike {
  top: number;
  bottom: number;
  left: number;
  right: number;
  width: number;
  height: number;
}

/**
 * Decide whether a fixed/sticky element should be temporarily hidden on
 * non-first slices to avoid repeated headers/footers/sidebars/chat widgets
 * (spec §5.4). Elements that occupy most of the viewport are treated as the
 * actual application content and kept.
 */
export function shouldHideFixed(rect: RectLike, viewportW: number, viewportH: number): boolean {
  if (rect.width <= 1 || rect.height <= 1) return false;
  const area = rect.width * rect.height;
  const vpArea = Math.max(1, viewportW * viewportH);

  // Likely the main scrollable app or a full-page overlay: keep it.
  if (area >= vpArea * 0.6) return false;

  // Element is entirely outside the viewport horizontally/vertically: irrelevant.
  if (rect.bottom <= 0 || rect.top >= viewportH) return false;
  if (rect.right <= 0 || rect.left >= viewportW) return false;

  const edgeBand = Math.max(2, viewportH * 0.15);
  const touchesTop = rect.top <= edgeBand;
  const touchesBottom = rect.bottom >= viewportH - edgeBand;
  const touchesLeft = rect.left <= Math.max(2, viewportW * 0.05);
  const touchesRight = rect.right >= viewportW - Math.max(2, viewportW * 0.05);

  return touchesTop || touchesBottom || touchesLeft || touchesRight;
}
