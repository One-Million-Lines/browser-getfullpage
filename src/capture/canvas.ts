/** Canvas helpers that work in both a document and a worker/offscreen context. */

export interface Canvas2D {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
}

export function supportsOffscreenCanvas(): boolean {
  return typeof OffscreenCanvas !== 'undefined';
}

/** Create a canvas, preferring OffscreenCanvas where available (spec §5.6). */
export function createCanvas(width: number, height: number): Canvas2D {
  const w = Math.max(1, Math.floor(width));
  const h = Math.max(1, Math.floor(height));
  if (supportsOffscreenCanvas()) {
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) throw new Error('OffscreenCanvas 2D context unavailable');
    return { canvas, ctx: ctx as OffscreenCanvasRenderingContext2D };
  }
  if (typeof document === 'undefined') {
    throw new Error('No canvas implementation available in this context');
  }
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  return { canvas, ctx };
}

/** Encode a canvas to a Blob across document and offscreen contexts. */
export async function canvasToBlob(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  type: string,
  quality?: number,
): Promise<Blob> {
  if (typeof (canvas as OffscreenCanvas).convertToBlob === 'function') {
    return (canvas as OffscreenCanvas).convertToBlob({ type, quality });
  }
  return new Promise((resolve, reject) => {
    (canvas as HTMLCanvasElement).toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('toBlob returned null'))),
      type,
      quality,
    );
  });
}

/** Decode a data URL or Blob into an ImageBitmap. */
export async function decodeBitmap(src: string | Blob): Promise<ImageBitmap> {
  const blob = typeof src === 'string' ? await (await fetch(src)).blob() : src;
  return createImageBitmap(blob);
}

/** Fill a solid background (used for JPEG which has no alpha). */
export function fillBackground(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  width: number,
  height: number,
  color = '#ffffff',
): void {
  ctx.save();
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}
