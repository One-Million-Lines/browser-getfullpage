import { canvasToBlob, createCanvas, decodeBitmap } from './canvas';
import { decideSize } from './limits';
import { fullPhysicalSize, pxPerCss, toMasterY } from './geometry';
import { getSlices, putResult } from '@/platform/idb';
import { CaptureError } from '@/shared/errors';
import type { CaptureResult, CompositeParams } from '@/shared/types';

export type { CompositeParams } from '@/shared/types';

/**
 * Composite captured slices from IndexedDB into a single master image and store
 * it back in IndexedDB. Runs in the offscreen document (Chromium) or directly in
 * a page with canvas access (Firefox/preview). The master is always bounded to a
 * safe canvas size — downscaling only when unavoidable, and the applied scale is
 * recorded so it can be shown to the user (spec §5.6).
 */
export async function compositeCapture(params: CompositeParams): Promise<CaptureResult> {
  const slices = await getSlices(params.captureId);
  if (slices.length === 0) {
    throw new CaptureError('STITCH_FAILED', 'No slices were captured.');
  }

  // Derive physical-pixel scale from the first slice's actual bitmap size, using
  // measured dimensions rather than assumptions (spec §5.3).
  const first = slices[0];
  const pxPerCssY = pxPerCss(first.bitmapHeight, params.viewportHeightCss);
  const full = fullPhysicalSize(first.bitmapWidth, params.totalHeightCss, pxPerCssY);
  const fullWidthPx = full.widthPx;
  const fullHeightPx = full.heightPx;

  const decision = decideSize(fullWidthPx, fullHeightPx, params.memoryCeilingBytes);
  const scale = decision.scale;
  const masterW = Math.max(1, Math.round(fullWidthPx * scale));
  const masterH = Math.max(1, Math.round(fullHeightPx * scale));

  const { canvas, ctx } = createCanvas(masterW, masterH);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  let previousScrollY = Number.NaN;
  for (const slice of slices) {
    // Skip only a genuine failed scroll (identical scroll position). Content-based
    // de-dup is unsafe: distinct all-white viewports share pixels but cover
    // different rows, and skipping them would leave gaps (spec §5.3).
    if (slice.scrollY === previousScrollY) continue;
    previousScrollY = slice.scrollY;

    let bitmap: ImageBitmap;
    try {
      bitmap = await decodeBitmap(slice.dataUrl);
    } catch (e) {
      throw new CaptureError('STITCH_FAILED', e instanceof Error ? e.message : String(e));
    }

    const destY = toMasterY(slice.scrollY, pxPerCssY, scale);
    if (destY >= masterH) {
      bitmap.close?.();
      continue;
    }
    // Rows available from this slice, clamped to what remains in the master.
    const availPhysical = Math.min(bitmap.height, masterH / scale - slice.scrollY * pxPerCssY);
    const srcH = Math.max(0, Math.floor(availPhysical));
    const destH = Math.min(masterH - destY, Math.round(srcH * scale));
    if (srcH > 0 && destH > 0) {
      ctx.drawImage(bitmap, 0, 0, bitmap.width, srcH, 0, destY, masterW, destH);
    }
    // Release the source bitmap immediately (spec §5.6 memory safety).
    bitmap.close?.();
  }

  // Master image is stored lossless PNG; all exports derive from it.
  let blob: Blob;
  try {
    blob = await canvasToBlob(canvas, 'image/png');
  } catch (e) {
    throw new CaptureError('ENCODE_FAILED', e instanceof Error ? e.message : String(e));
  }

  const meta: CaptureResult = {
    captureId: params.captureId,
    mode: params.mode,
    widthPx: masterW,
    heightPx: masterH,
    scale,
    devicePixelRatio: pxPerCssY,
    format: 'png',
    url: params.url,
    title: params.title,
    capturedAt: new Date().toISOString(),
    truncated: params.truncated,
    truncationReason: params.truncationReason ?? decision.note,
    estimatedBytes: blob.size,
  };

  await putResult(params.captureId, blob, meta);

  // Release the canvas backing store where possible.
  if (typeof (canvas as OffscreenCanvas).width === 'number') {
    (canvas as OffscreenCanvas).width = 0;
    (canvas as OffscreenCanvas).height = 0;
  }

  return meta;
}
