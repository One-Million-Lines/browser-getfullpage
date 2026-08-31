import { canvasToBlob, createCanvas, decodeBitmap } from '@/capture/canvas';

export interface EditedImage {
  blob: Blob;
  width: number;
  height: number;
}

export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Crop the master image to a pixel rectangle (non-destructive; returns a copy). */
export async function cropImage(master: Blob, rect: CropRect): Promise<EditedImage> {
  const bmp = await decodeBitmap(master);
  try {
    const x = Math.max(0, Math.min(Math.round(rect.x), bmp.width - 1));
    const y = Math.max(0, Math.min(Math.round(rect.y), bmp.height - 1));
    const w = Math.max(1, Math.min(Math.round(rect.w), bmp.width - x));
    const h = Math.max(1, Math.min(Math.round(rect.h), bmp.height - y));
    const { canvas, ctx } = createCanvas(w, h);
    ctx.drawImage(bmp, x, y, w, h, 0, 0, w, h);
    const blob = await canvasToBlob(canvas, 'image/png');
    return { blob, width: w, height: h };
  } finally {
    bmp.close?.();
  }
}

/** Rotate the master image by 90° clockwise (default) or counter-clockwise. */
export async function rotateImage(master: Blob, direction: 'cw' | 'ccw' = 'cw'): Promise<EditedImage> {
  const bmp = await decodeBitmap(master);
  try {
    const w = bmp.height;
    const h = bmp.width;
    const { canvas, ctx } = createCanvas(w, h);
    ctx.save();
    if (direction === 'cw') {
      ctx.translate(w, 0);
      ctx.rotate(Math.PI / 2);
    } else {
      ctx.translate(0, h);
      ctx.rotate(-Math.PI / 2);
    }
    ctx.drawImage(bmp, 0, 0);
    ctx.restore();
    const blob = await canvasToBlob(canvas, 'image/png');
    return { blob, width: w, height: h };
  } finally {
    bmp.close?.();
  }
}
