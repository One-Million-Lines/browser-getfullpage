import { canvasToBlob, createCanvas, decodeBitmap, fillBackground } from '@/capture/canvas';
import { MAX_CANVAS_SIDE_PX } from '@/shared/constants';
import { CaptureError } from '@/shared/errors';
import { t } from '@/shared/i18n';
import type { CaptureResult, PdfDefaults } from '@/shared/types';
import {
  PT_PER_CSS_PX,
  paginatePdf,
  paginateSmart,
  type PdfLayoutConfig,
} from './pdf-layout';
import { buildPdf, type PdfPageImage } from './pdf-writer';

export interface PdfBuildOptions {
  pdf: PdfDefaults;
  /** Points per source-pixel; derived from capture metadata when omitted. */
  jpegQuality?: number;
}

function footerText(meta: CaptureResult, page: number, total: number): string {
  let host = meta.url;
  try {
    const u = new URL(meta.url);
    host = `${u.origin}${u.pathname}`;
  } catch {
    /* keep raw */
  }
  const when = new Date(meta.capturedAt).toLocaleString();
  const title = meta.title ? `${meta.title} · ` : '';
  const pageLabel = t('pdfFooterPage', [String(page), String(total)], `Page ${page}/${total}`);
  return `${title}${host} · ${when} · ${pageLabel}`;
}

/** Per-row luminance variance; lower means an emptier row (better break point). */
function computeRowScores(bmp: ImageBitmap): number[] | null {
  if (bmp.height > MAX_CANVAS_SIDE_PX) return null;
  const w = Math.min(160, bmp.width);
  const { canvas, ctx } = createCanvas(w, bmp.height);
  ctx.drawImage(bmp, 0, 0, bmp.width, bmp.height, 0, 0, w, bmp.height);
  const data = ctx.getImageData(0, 0, w, bmp.height).data;
  const scores = new Array<number>(bmp.height);
  for (let y = 0; y < bmp.height; y++) {
    let sum = 0;
    let sumSq = 0;
    const rowStart = y * w * 4;
    for (let x = 0; x < w; x++) {
      const i = rowStart + x * 4;
      const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      sum += lum;
      sumSq += lum * lum;
    }
    const mean = sum / w;
    scores[y] = sumSq / w - mean * mean;
  }
  (canvas as OffscreenCanvas).width = 0;
  return scores;
}

/**
 * Build a paginated PDF from the master image, rendering one page at a time so a
 * single giant canvas is never required (spec §5.6, §5.9). Each page embeds a
 * JPEG at the source region's native resolution.
 */
export async function buildPdfFromMaster(
  master: Blob,
  meta: CaptureResult,
  opts: PdfBuildOptions,
): Promise<Blob> {
  const bmp = await decodeBitmap(master);
  try {
    const ptPerPx =
      Number.isFinite(meta.devicePixelRatio) && meta.devicePixelRatio > 0 && meta.scale > 0
        ? PT_PER_CSS_PX / (meta.devicePixelRatio * meta.scale)
        : PT_PER_CSS_PX;

    const cfg: PdfLayoutConfig = {
      paper: opts.pdf.paper,
      orientation: opts.pdf.orientation,
      margin: opts.pdf.margin,
      customMarginPt: opts.pdf.customMarginPt,
      ptPerPx,
    };

    let slices = paginatePdf(bmp.width, bmp.height, cfg);
    if (opts.pdf.smartBreaks && slices.length > 1) {
      const scores = computeRowScores(bmp);
      if (scores) slices = paginateSmart(bmp.width, bmp.height, cfg, scores);
    }

    const quality = opts.jpegQuality ?? 0.85;
    const pages: PdfPageImage[] = [];
    for (let i = 0; i < slices.length; i++) {
      const s = slices[i];
      const { canvas, ctx } = createCanvas(bmp.width, s.srcH);
      fillBackground(ctx, bmp.width, s.srcH, '#ffffff');
      ctx.drawImage(bmp, 0, s.srcY, bmp.width, s.srcH, 0, 0, bmp.width, s.srcH);
      const jpegBlob = await canvasToBlob(canvas, 'image/jpeg', quality);
      const jpeg = new Uint8Array(await jpegBlob.arrayBuffer());
      pages.push({
        jpeg,
        imgWpx: bmp.width,
        imgHpx: s.srcH,
        pageWpt: s.pageWpt,
        pageHpt: s.pageHpt,
        drawX: s.drawX,
        drawY: s.drawY,
        drawW: s.drawW,
        drawH: s.drawH,
        footer: opts.pdf.footer ? footerText(meta, i + 1, slices.length) : undefined,
      });
      // Release the page canvas backing store.
      (canvas as OffscreenCanvas).width = 0;
    }

    const bytes = buildPdf(pages);
    return new Blob([bytes as BlobPart], { type: 'application/pdf' });
  } catch (e) {
    if (e instanceof CaptureError) throw e;
    throw new CaptureError('ENCODE_FAILED', e instanceof Error ? e.message : String(e));
  } finally {
    bmp.close?.();
  }
}
