import { MAX_CANVAS_AREA_PX, MAX_CANVAS_SIDE_PX } from '@/shared/constants';

export interface SizeDecision {
  /** Whether the target fits within a single safe canvas. */
  fitsSingleCanvas: boolean;
  /** Whether it fits within the memory budget at full resolution. */
  fitsMemory: boolean;
  /** Scale (<=1) that should be applied so the result fits both limits. */
  scale: number;
  /** Estimated bytes for the composited RGBA bitmap at the chosen scale. */
  estimatedBytes: number;
  /** Human-readable note when downscaling/tiling is required. */
  note?: string;
}

/** Bytes for an RGBA bitmap plus a working-copy overhead factor. */
export function estimateBytes(widthPx: number, heightPx: number, overhead = 1.5): number {
  return Math.ceil(widthPx * heightPx * 4 * overhead);
}

/**
 * Decide how to render a target of (widthPx x heightPx) given hard canvas limits
 * and a soft memory ceiling. Never downscales silently — the returned scale is
 * surfaced to the user (spec §5.6).
 */
export function decideSize(
  widthPx: number,
  heightPx: number,
  memoryCeilingBytes: number,
  opts?: { maxSide?: number; maxArea?: number; allowDownscale?: boolean },
): SizeDecision {
  const maxSide = opts?.maxSide ?? MAX_CANVAS_SIDE_PX;
  const maxArea = opts?.maxArea ?? MAX_CANVAS_AREA_PX;
  const allowDownscale = opts?.allowDownscale ?? true;

  const fitsSide = widthPx <= maxSide && heightPx <= maxSide;
  const fitsArea = widthPx * heightPx <= maxArea;
  const fitsSingleCanvas = fitsSide && fitsArea;
  const fullBytes = estimateBytes(widthPx, heightPx);
  const fitsMemory = fullBytes <= memoryCeilingBytes;

  if (fitsSingleCanvas && fitsMemory) {
    return { fitsSingleCanvas, fitsMemory, scale: 1, estimatedBytes: fullBytes };
  }

  if (!allowDownscale) {
    return {
      fitsSingleCanvas,
      fitsMemory,
      scale: 1,
      estimatedBytes: fullBytes,
      note: 'Exceeds single-canvas or memory limits; tiled rendering required (PDF renders page-by-page).',
    };
  }

  // Compute the largest scale that satisfies every constraint.
  const sideScale = Math.min(1, maxSide / widthPx, maxSide / heightPx);
  const areaScale = Math.min(1, Math.sqrt(maxArea / (widthPx * heightPx)));
  const memScale = Math.min(1, Math.sqrt(memoryCeilingBytes / fullBytes));
  const scale = Math.max(0.05, Math.min(sideScale, areaScale, memScale));

  const scaledW = Math.floor(widthPx * scale);
  const scaledH = Math.floor(heightPx * scale);
  return {
    fitsSingleCanvas,
    fitsMemory,
    scale,
    estimatedBytes: estimateBytes(scaledW, scaledH),
    note: `Scaled to ${Math.round(scale * 100)}% to fit rendering limits (${scaledW}×${scaledH}px).`,
  };
}

/**
 * Compute row ranges for tiling a tall image into safe horizontal bands.
 * Used for PDF page-by-page rendering and extreme-page PNG export.
 */
export function tileRows(heightPx: number, maxSide = MAX_CANVAS_SIDE_PX): Array<[number, number]> {
  const bands: Array<[number, number]> = [];
  const band = Math.max(1, maxSide);
  for (let y = 0; y < heightPx; y += band) {
    bands.push([y, Math.min(heightPx, y + band)]);
  }
  if (bands.length === 0) bands.push([0, heightPx]);
  return bands;
}
