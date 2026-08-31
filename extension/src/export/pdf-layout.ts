import { PDF_PAPER, type PdfPaperName } from '@/shared/constants';
import type { PdfMargin, PdfOrientation } from '@/shared/types';

/** Points per CSS pixel at 96 dpi (72/96). Callers pass an adjusted value for DPR. */
export const PT_PER_CSS_PX = 72 / 96;

export interface PdfLayoutConfig {
  paper: PdfPaperName;
  orientation: PdfOrientation;
  margin: PdfMargin;
  customMarginPt: number;
  /** Custom paper size in points, used when paper === 'custom'. */
  customPaperPt?: { w: number; h: number };
  /** Points per image pixel (accounts for devicePixelRatio + any downscale). */
  ptPerPx: number;
}

export interface PdfPageSlice {
  /** Source pixel rows [srcY, srcY+srcH) for this page. */
  srcY: number;
  srcH: number;
  pageWpt: number;
  pageHpt: number;
  drawX: number;
  drawY: number;
  drawW: number;
  drawH: number;
}

function marginPoints(margin: PdfMargin, custom: number): number {
  switch (margin) {
    case 'none':
      return 0;
    case 'narrow':
      return 18; // 0.25"
    case 'normal':
      return 36; // 0.5"
    case 'custom':
      return Math.max(0, custom);
  }
}

interface ResolvedPaper {
  pageWpt: number;
  pageHpt: number;
  margin: number;
  contentWpt: number;
  contentHpt: number;
}

export function resolvePaper(
  cfg: PdfLayoutConfig,
  imgWpx: number,
  imgHpx: number,
): ResolvedPaper {
  const margin = marginPoints(cfg.margin, cfg.customMarginPt);
  const imgWpt = imgWpx * cfg.ptPerPx;

  let pageWpt: number;
  let pageHpt: number;

  if (cfg.paper === 'fit') {
    pageWpt = imgWpt + margin * 2;
    // A4-like portrait ratio for the content band so tall pages split sensibly.
    pageHpt = imgWpt * Math.SQRT2 + margin * 2;
  } else if (cfg.paper === 'custom' && cfg.customPaperPt) {
    pageWpt = cfg.customPaperPt.w;
    pageHpt = cfg.customPaperPt.h;
  } else {
    const base = PDF_PAPER[cfg.paper as keyof typeof PDF_PAPER] ?? PDF_PAPER.a4;
    pageWpt = base.w;
    pageHpt = base.h;
  }

  // Orientation.
  const wantLandscape =
    cfg.orientation === 'landscape' ||
    (cfg.orientation === 'auto' && imgWpx > imgHpx && cfg.paper !== 'fit');
  if (wantLandscape && pageWpt < pageHpt) {
    [pageWpt, pageHpt] = [pageHpt, pageWpt];
  }
  if (cfg.orientation === 'portrait' && pageWpt > pageHpt) {
    [pageWpt, pageHpt] = [pageHpt, pageWpt];
  }

  const contentWpt = Math.max(1, pageWpt - margin * 2);
  const contentHpt = Math.max(1, pageHpt - margin * 2);
  return { pageWpt, pageHpt, margin, contentWpt, contentHpt };
}

/**
 * Split an image into PDF pages. Each page fits the image to the content width
 * and takes as many source rows as fit the content height. Pure and testable.
 */
export function paginatePdf(imgWpx: number, imgHpx: number, cfg: PdfLayoutConfig): PdfPageSlice[] {
  const paper = resolvePaper(cfg, imgWpx, imgHpx);
  // Points per source pixel when the image width fills the content width.
  const scale = paper.contentWpt / imgWpx;
  const srcRowsPerPage = Math.max(1, Math.floor(paper.contentHpt / scale));

  const slices: PdfPageSlice[] = [];
  for (let srcY = 0; srcY < imgHpx; srcY += srcRowsPerPage) {
    const srcH = Math.min(srcRowsPerPage, imgHpx - srcY);
    const drawW = imgWpx * scale;
    const drawH = srcH * scale;
    slices.push({
      srcY,
      srcH,
      pageWpt: paper.pageWpt,
      pageHpt: paper.pageHpt,
      drawX: paper.margin,
      drawY: paper.pageHpt - paper.margin - drawH,
      drawW,
      drawH,
    });
  }
  if (slices.length === 0) {
    slices.push({
      srcY: 0,
      srcH: imgHpx,
      pageWpt: paper.pageWpt,
      pageHpt: paper.pageHpt,
      drawX: paper.margin,
      drawY: paper.margin,
      drawW: imgWpx * scale,
      drawH: imgHpx * scale,
    });
  }
  return slices;
}

/**
 * Smart break selection (spec §5.9 P1): given per-row "content scores" (higher =
 * busier row, e.g. text), nudge a nominal break toward the emptiest row within a
 * bounded window so pages don't cut through a line of text.
 */
export function chooseBreakRow(nominalY: number, rowScores: number[], window: number): number {
  const lo = Math.max(1, nominalY - window);
  const hi = Math.min(rowScores.length - 1, nominalY + window);
  if (hi <= lo) return nominalY;
  let bestY = nominalY;
  let bestScore = Infinity;
  for (let y = lo; y <= hi; y++) {
    // Prefer emptier rows; tie-break toward the nominal position.
    const penalty = rowScores[y] + Math.abs(y - nominalY) * 0.001;
    if (penalty < bestScore) {
      bestScore = penalty;
      bestY = y;
    }
  }
  return bestY;
}

/** Re-paginate using smart breaks derived from row content scores. */
export function paginateSmart(
  imgWpx: number,
  imgHpx: number,
  cfg: PdfLayoutConfig,
  rowScores: number[],
): PdfPageSlice[] {
  const nominal = paginatePdf(imgWpx, imgHpx, cfg);
  if (nominal.length <= 1) return nominal;
  const paper = resolvePaper(cfg, imgWpx, imgHpx);
  const scale = paper.contentWpt / imgWpx;
  const srcRowsPerPage = Math.max(1, Math.floor(paper.contentHpt / scale));
  const window = Math.min(Math.floor(srcRowsPerPage * 0.08), 120);

  const slices: PdfPageSlice[] = [];
  let srcY = 0;
  while (srcY < imgHpx) {
    let srcH = Math.min(srcRowsPerPage, imgHpx - srcY);
    const nominalEnd = srcY + srcH;
    if (nominalEnd < imgHpx) {
      const adjustedEnd = chooseBreakRow(nominalEnd, rowScores, window);
      srcH = Math.max(1, adjustedEnd - srcY);
    }
    const drawH = srcH * scale;
    slices.push({
      srcY,
      srcH,
      pageWpt: paper.pageWpt,
      pageHpt: paper.pageHpt,
      drawX: paper.margin,
      drawY: paper.pageHpt - paper.margin - drawH,
      drawW: imgWpx * scale,
      drawH,
    });
    srcY += srcH;
  }
  return slices;
}
