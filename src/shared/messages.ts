import type {
  CaptureId,
  CaptureProgress,
  CaptureResult,
  CompositeParams,
  ImageFormat,
  PageMeasurement,
} from './types';
import type { CaptureErrorCode } from './errors';

/* ---------------------------- content <-> background ----------------------------
 * A long-lived runtime Port drives capture so an MV3 service worker restart
 * aborts cleanly instead of corrupting coordination (spec §5.1). The background
 * is the coordinator; the content script is a passive RPC responder.
 * ------------------------------------------------------------------------------ */

export type ContentCommand =
  | 'prepare'
  | 'measure'
  | 'scrollTo'
  | 'beforeShot'
  | 'afterShot'
  | 'progress'
  | 'cleanup';

export interface ScrollToArgs {
  scrollY: number;
}
export interface ScrollToResult {
  actualScrollX: number;
  actualScrollY: number;
  viewportWidth: number;
  viewportHeight: number;
  devicePixelRatio: number;
  docHeight: number;
  docWidth: number;
}

export interface BeforeShotArgs {
  index: number;
  total: number;
  isFirst: boolean;
}

export interface ProgressArgs {
  current: number;
  total: number;
  message?: string;
}

/** Request sent background → content over the Port. */
export interface RpcRequest {
  id: number;
  cmd: ContentCommand;
  args?: unknown;
}

/** Response sent content → background over the Port. */
export interface RpcResponse {
  id: number;
  ok: boolean;
  result?: unknown;
  error?: { code: CaptureErrorCode; detail?: string };
}

/** Unsolicited events sent content → background (e.g. user pressed Cancel). */
export interface ContentEvent {
  event: 'cancel' | 'page-changed' | 'ready';
  detail?: string;
}

export type PortMessageFromContent = RpcResponse | ContentEvent;
export type PortMessageFromBackground = RpcRequest;

export function isRpcResponse(m: PortMessageFromContent): m is RpcResponse {
  return typeof (m as RpcResponse).id === 'number';
}

/* ----------------------------- runtime messages -----------------------------
 * Used for background <-> offscreen and background <-> preview/options.
 * Every message carries a `type` discriminator; capture-scoped messages carry
 * a captureId and are rejected when stale (spec message contract).
 * -------------------------------------------------------------------------- */

export interface StitchDownloadRequest {
  format: ImageFormat;
  jpegQuality: number;
  filenameTemplate: string;
  subfolder: string;
}

export interface StitchStartMessage {
  type: 'STITCH_START';
  captureId: CaptureId;
  composite: CompositeParams;
  /** When present, the compositor also encodes and downloads the result. */
  download?: StitchDownloadRequest;
}

export interface StitchCompleteMessage {
  type: 'STITCH_COMPLETE';
  captureId: CaptureId;
  result: CaptureResult;
}

export interface StitchFailedMessage {
  type: 'STITCH_FAILED';
  captureId: CaptureId;
  code: CaptureErrorCode;
  detail?: string;
}

export interface OffscreenReadyMessage {
  type: 'OFFSCREEN_READY';
}

export interface CaptureStartMessage {
  type: 'CAPTURE_START';
  /** Optional explicit tab; defaults to the active tab. */
  tabId?: number;
  mode?: 'full' | 'viewport';
  /** Force mobile emulation on/off for this capture; defaults to the setting. */
  mobile?: boolean;
}

export interface CaptureCancelMessage {
  type: 'CAPTURE_CANCEL';
  captureId?: CaptureId;
}

export interface CaptureProgressMessage {
  type: 'CAPTURE_PROGRESS';
  progress: CaptureProgress;
}

export interface CaptureFailedMessage {
  type: 'CAPTURE_FAILED';
  captureId: CaptureId;
  code: CaptureErrorCode;
  detail?: string;
}

export interface GetResultMessage {
  type: 'GET_RESULT';
  captureId: CaptureId;
}

export interface RetakeMessage {
  type: 'RETAKE';
  captureId: CaptureId;
  /** Force mobile emulation on/off for the retake; defaults to the setting. */
  mobile?: boolean;
}

export interface MeasuredMessage {
  type: 'PAGE_MEASURED';
  captureId: CaptureId;
  measurement: PageMeasurement;
}

export type RuntimeMessage =
  | StitchStartMessage
  | StitchCompleteMessage
  | StitchFailedMessage
  | OffscreenReadyMessage
  | CaptureStartMessage
  | CaptureCancelMessage
  | CaptureProgressMessage
  | CaptureFailedMessage
  | GetResultMessage
  | RetakeMessage
  | MeasuredMessage;
