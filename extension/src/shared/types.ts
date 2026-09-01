import type { PdfPaperName } from './constants';

export type CaptureId = string;

export type CaptureMode = 'full' | 'viewport' | 'region' | 'element';

export type ImageFormat = 'png' | 'jpeg';

export type ExportFormat = ImageFormat | 'pdf';

/** State machine per spec §5.1. */
export type CaptureState =
  | 'idle'
  | 'preparing'
  | 'measuring'
  | 'capturing'
  | 'stitching'
  | 'ready'
  | 'cancelled'
  | 'failed';

/** Geometry the content script measures before capture (spec §5.2). */
export interface PageMeasurement {
  /** Full document width/height in CSS pixels. */
  docWidth: number;
  docHeight: number;
  /** Visible viewport in CSS pixels. */
  viewportWidth: number;
  viewportHeight: number;
  /** Original scroll offsets to restore afterwards. */
  originalScrollX: number;
  originalScrollY: number;
  devicePixelRatio: number;
  /** Browser zoom factor when exposed, else 1. */
  zoom: number;
  /** True when the primary scroll root is an app container, not the document. */
  usesScrollContainer: boolean;
  /** Number of fixed/sticky candidates detected. */
  fixedCount: number;
}

/** One planned capture step. */
export interface SlicePlan {
  index: number;
  /** CSS-pixel scroll target for this slice. */
  scrollY: number;
  /** CSS-pixel height of usable content for this slice. */
  sliceHeightCss: number;
}

/** The full capture plan produced from a measurement. */
export interface CapturePlan {
  totalWidthCss: number;
  totalHeightCss: number;
  viewportHeightCss: number;
  stepCss: number;
  overlapCss: number;
  slices: SlicePlan[];
  truncated: boolean;
  truncationReason?: string;
}

/** A captured viewport slice reported by the content/background pair. */
export interface CapturedSlice {
  captureId: CaptureId;
  index: number;
  /** Data URL from tabs.captureVisibleTab (image/png). */
  dataUrl: string;
  /** Actual scroll position reached, CSS px. */
  scrollX: number;
  scrollY: number;
  /** Actual captured bitmap size in physical pixels. */
  bitmapWidth: number;
  bitmapHeight: number;
  /** Device pixel ratio the bitmap was captured at. */
  scale: number;
}

/** Final composited result metadata (pixels are stored separately as a Blob). */
export interface CaptureResult {
  captureId: CaptureId;
  mode: CaptureMode;
  /** Physical pixel dimensions of the final image. */
  widthPx: number;
  heightPx: number;
  /** Scale factor applied to source (1 = physical resolution, <1 = downscaled). */
  scale: number;
  /** Effective device pixel ratio of the source page. */
  devicePixelRatio: number;
  format: ImageFormat;
  url: string;
  title: string;
  /** ISO timestamp of capture completion. */
  capturedAt: string;
  truncated: boolean;
  truncationReason?: string;
  /** Estimated byte size of the encoded image. */
  estimatedBytes: number;
}

/** Identity lock so stale tabs/documents cannot corrupt a session (spec §5.1). */
export interface CaptureTarget {
  captureId: CaptureId;
  tabId: number;
  windowId: number;
  url: string;
  /** Cheap document identity token (URL + docHeight snapshot). */
  documentToken: string;
}

export interface CaptureProgress {
  captureId: CaptureId;
  state: CaptureState;
  current: number;
  total: number;
  message?: string;
}

/* --------------------------------- settings -------------------------------- */

export type PostCaptureBehavior = 'preview' | 'download';
export type SettleDelaySetting = 'auto' | 100 | 250 | 500 | 1000;
export type FixedHandling = 'hide-repeated' | 'keep-all';
export type PdfOrientation = 'auto' | 'portrait' | 'landscape';
export type PdfMargin = 'none' | 'narrow' | 'normal' | 'custom';

export interface PdfDefaults {
  paper: PdfPaperName;
  orientation: PdfOrientation;
  margin: PdfMargin;
  customMarginPt: number;
  smartBreaks: boolean;
  footer: boolean;
}

export interface Settings {
  /** Schema version for migrations. */
  schemaVersion: number;
  defaultFormat: ImageFormat;
  jpegQuality: number;
  postCapture: PostCaptureBehavior;
  filenameTemplate: string;
  downloadSubfolder: string;
  settleDelay: SettleDelaySetting;
  freezeAnimations: boolean;
  fixedHandling: FixedHandling;
  maxPageHeightPx: number;
  maxSlices: number;
  memoryCeilingBytes: number;
  pdf: PdfDefaults;
  /** P1 features behind a flag. */
  enableEditor: boolean;
  enableHistory: boolean;
  historyLimit: number;
}

/** Inputs the compositor needs to stitch slices into a master image. */
export interface CompositeParams {
  captureId: CaptureId;
  mode: CaptureMode;
  url: string;
  title: string;
  /** Total document height in CSS px from the final plan. */
  totalHeightCss: number;
  /** Viewport height in CSS px used during capture. */
  viewportHeightCss: number;
  truncated: boolean;
  truncationReason?: string;
  memoryCeilingBytes: number;
}
