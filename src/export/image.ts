import { canvasToBlob, createCanvas, decodeBitmap, fillBackground } from '@/capture/canvas';
import { CaptureError } from '@/shared/errors';
import type { ImageFormat } from '@/shared/types';

/**
 * Re-encode the lossless master image into the requested format. PNG is returned
 * as-is; JPEG is flattened onto a white background (spec §5.9). Works in any
 * context with canvas access (preview page or offscreen document).
 */
export async function encodeImage(
  master: Blob,
  format: ImageFormat,
  jpegQuality: number,
): Promise<Blob> {
  if (format === 'png') return master;
  const bmp = await decodeBitmap(master);
  try {
    const { canvas, ctx } = createCanvas(bmp.width, bmp.height);
    fillBackground(ctx, bmp.width, bmp.height, '#ffffff');
    ctx.drawImage(bmp, 0, 0);
    return await canvasToBlob(canvas, 'image/jpeg', jpegQuality);
  } catch (e) {
    throw new CaptureError('ENCODE_FAILED', e instanceof Error ? e.message : String(e));
  } finally {
    bmp.close?.();
  }
}

/** Convenience: extension for a format. */
export function extForFormat(format: ImageFormat): string {
  return format === 'jpeg' ? 'jpg' : 'png';
}
