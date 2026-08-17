/** Structured, user-friendly error taxonomy (spec §8). */

export type CaptureErrorCode =
  | 'RESTRICTED_URL'
  | 'FILE_ACCESS_DENIED'
  | 'TAB_CHANGED'
  | 'TAB_NAVIGATED'
  | 'TAB_INACTIVE'
  | 'PAGE_TOO_LARGE'
  | 'TRUNCATED'
  | 'SCROLL_ROOT_IMMOVABLE'
  | 'CAPTURE_API_FAILED'
  | 'ENCODE_FAILED'
  | 'CLIPBOARD_UNSUPPORTED'
  | 'DOWNLOAD_DENIED'
  | 'MOBILE_UNAVAILABLE'
  | 'STITCH_FAILED'
  | 'ALREADY_RUNNING'
  | 'CANCELLED'
  | 'INTERNAL';

const FRIENDLY: Record<CaptureErrorCode, string> = {
  RESTRICTED_URL:
    'This page can’t be captured. Browser system pages, extension pages, and stores are protected.',
  FILE_ACCESS_DENIED:
    'To capture local files, enable “Allow access to file URLs” for GetFullPage in your browser’s extensions settings.',
  TAB_CHANGED: 'The active tab changed during capture, so it was stopped and the page restored.',
  TAB_NAVIGATED: 'The page navigated during capture, so it was stopped and the page restored.',
  TAB_INACTIVE: 'The tab became inactive during capture. Keep the tab focused while capturing.',
  PAGE_TOO_LARGE:
    'This page is larger than the configured memory limit. Increase the limit in Settings or capture a region.',
  TRUNCATED:
    'This page kept growing (likely infinite scroll). Capture stopped at the configured maximum and is marked truncated.',
  SCROLL_ROOT_IMMOVABLE: 'The page’s scroll container could not be moved, so the full page can’t be captured.',
  CAPTURE_API_FAILED: 'The browser’s screenshot API failed repeatedly. Please retry.',
  ENCODE_FAILED: 'The image or PDF could not be encoded. Try a different format or a smaller capture.',
  CLIPBOARD_UNSUPPORTED:
    'Copying an image to the clipboard isn’t supported here. Download the PNG instead.',
  DOWNLOAD_DENIED: 'Download permission was denied. Grant it in Settings or use the preview to save.',
  MOBILE_UNAVAILABLE:
    'Mobile capture needs the debugger permission and is available on Chromium browsers. Enable it in Settings, and close DevTools on the page first.',
  STITCH_FAILED: 'The captured slices could not be combined. Please retry.',
  ALREADY_RUNNING: 'A capture is already running for this tab.',
  CANCELLED: 'Capture cancelled.',
  INTERNAL: 'Something went wrong during capture. Please retry.',
};

export class CaptureError extends Error {
  readonly code: CaptureErrorCode;
  readonly retryable: boolean;

  constructor(code: CaptureErrorCode, detail?: string, retryable = false) {
    super(detail ? `${FRIENDLY[code]} (${detail})` : FRIENDLY[code]);
    this.name = 'CaptureError';
    this.code = code;
    this.retryable = retryable;
  }

  /** Message safe to show to the user. */
  get friendly(): string {
    return FRIENDLY[this.code];
  }

  static friendlyFor(code: CaptureErrorCode): string {
    return FRIENDLY[code];
  }
}

export function isCaptureError(e: unknown): e is CaptureError {
  return e instanceof CaptureError;
}

export function toCaptureError(e: unknown): CaptureError {
  if (isCaptureError(e)) return e;
  const detail = e instanceof Error ? e.message : String(e);
  return new CaptureError('INTERNAL', detail);
}
