/** Pure pixel-geometry conversions used by the compositor (spec §5.3, §5.6). */

/** Physical pixels per CSS pixel, derived from the actual captured bitmap. */
export function pxPerCss(bitmapHeightPhysical: number, viewportHeightCss: number): number {
  return bitmapHeightPhysical / Math.max(1, viewportHeightCss);
}

/** Convert a CSS-pixel document offset to a master-canvas row. */
export function toMasterY(scrollYCss: number, pxPerCssY: number, scale: number): number {
  return Math.round(scrollYCss * pxPerCssY * scale);
}

/** Full physical dimensions of the stitched page before any downscale. */
export function fullPhysicalSize(
  bitmapWidthPhysical: number,
  totalHeightCss: number,
  pxPerCssY: number,
): { widthPx: number; heightPx: number } {
  return {
    widthPx: bitmapWidthPhysical,
    heightPx: Math.round(totalHeightCss * pxPerCssY),
  };
}
