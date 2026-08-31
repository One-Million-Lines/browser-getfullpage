/** Central tuning constants. All values are local, deterministic, and testable. */

/** Overlap between consecutive vertical slices, in CSS pixels, to hide seams. */
export const SLICE_OVERLAP_CSS_PX = 2;

/** Bounded wait for the scroll position to stabilise after a scroll request. */
export const SCROLL_STABILISE_TIMEOUT_MS = 1500;

/** Poll interval while waiting for scroll/layout stabilisation. */
export const STABILISE_POLL_MS = 32;

/** Number of consecutive stable dimension checks before we stop expanding. */
export const STABLE_CHECKS_REQUIRED = 3;

/** Bounded wait for fonts/images currently loading before the first capture. */
export const INITIAL_LOAD_WAIT_MS = 700;

/** Default settle delay after each scroll for lazy content (Auto resolves here). */
export const DEFAULT_SETTLE_DELAY_MS = 150;

/** Chromium throttles captureVisibleTab; keep a minimum gap between calls. */
export const MIN_CAPTURE_INTERVAL_MS = 220;

/** Retry policy for a single slice capture. */
export const CAPTURE_MAX_ATTEMPTS = 3;
export const CAPTURE_BACKOFF_BASE_MS = 250;

/** Safety ceiling for total document height (CSS px) to avoid infinite scroll. */
export const DEFAULT_MAX_PAGE_HEIGHT_PX = 60000;

/** Safety ceiling for number of slices. */
export const DEFAULT_MAX_SLICES = 240;

/** Soft memory ceiling for a single composited bitmap (bytes). 512 MiB. */
export const DEFAULT_MEMORY_CEILING_BYTES = 512 * 1024 * 1024;

/**
 * Conservative maximum canvas dimension and area shared across engines.
 * Chromium caps a canvas at 16384 per side; Firefox at 32767; Safari lower.
 * We use the safe intersection for a single canvas and tile beyond it.
 */
export const MAX_CANVAS_SIDE_PX = 16384;
export const MAX_CANVAS_AREA_PX = 268_000_000; // ~ 16384 * 16384 safe area

/** Filename base length cap (excluding extension). */
export const MAX_FILENAME_BASE = 120;

/** IndexedDB database + store names for transient capture data. */
export const DB_NAME = 'getfullpage';
export const DB_VERSION = 1;
export const STORE_SLICES = 'slices';
export const STORE_RESULTS = 'results';
export const STORE_META = 'meta';

/** Runtime Port name used to keep MV3 coordination alive during a capture. */
export const CAPTURE_PORT = 'getfullpage-capture';

/** JPEG default quality and allowed range. */
export const JPEG_DEFAULT_QUALITY = 0.92;
export const JPEG_MIN_QUALITY = 0.6;
export const JPEG_MAX_QUALITY = 1.0;

/** Preview zoom bounds. */
export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 4.0;

export const PDF_PAPER = {
  a4: { w: 595.28, h: 841.89 },
  letter: { w: 612, h: 792 },
  legal: { w: 612, h: 1008 },
} as const;

export type PdfPaperName = keyof typeof PDF_PAPER | 'fit' | 'custom';
