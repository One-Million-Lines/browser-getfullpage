/** Structured, user-friendly error taxonomy (spec §8). */

import { t } from './i18n';

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
  | 'STITCH_FAILED'
  | 'ALREADY_RUNNING'
  | 'CANCELLED'
  | 'INTERNAL';

const FRIENDLY: Record<CaptureErrorCode, { key: string; fallback: string }> = {
  RESTRICTED_URL: {
    key: 'errorRestrictedUrl',
    fallback: 'This page can’t be captured. Browser system pages, extension pages, and stores are protected.',
  },
  FILE_ACCESS_DENIED: {
    key: 'errorFileAccessDenied',
    fallback:
      'To capture local files, enable “Allow access to file URLs” for GetFullPage in your browser’s extensions settings.',
  },
  TAB_CHANGED: {
    key: 'errorTabChanged',
    fallback: 'The active tab changed during capture, so it was stopped and the page restored.',
  },
  TAB_NAVIGATED: {
    key: 'errorTabNavigated',
    fallback: 'The page navigated during capture, so it was stopped and the page restored.',
  },
  TAB_INACTIVE: {
    key: 'errorTabInactive',
    fallback: 'The tab became inactive during capture. Keep the tab focused while capturing.',
  },
  PAGE_TOO_LARGE: {
    key: 'errorPageTooLarge',
    fallback: 'This page is larger than the configured memory limit. Increase the limit in Settings or capture a region.',
  },
  TRUNCATED: {
    key: 'errorTruncated',
    fallback:
      'This page kept growing (likely infinite scroll). Capture stopped at the configured maximum and is marked truncated.',
  },
  SCROLL_ROOT_IMMOVABLE: {
    key: 'errorScrollRootImmovable',
    fallback: 'The page’s scroll container could not be moved, so the full page can’t be captured.',
  },
  CAPTURE_API_FAILED: {
    key: 'errorCaptureApiFailed',
    fallback: 'The browser’s screenshot API failed repeatedly. Please retry.',
  },
  ENCODE_FAILED: {
    key: 'errorEncodeFailed',
    fallback: 'The image or PDF could not be encoded. Try a different format or a smaller capture.',
  },
  CLIPBOARD_UNSUPPORTED: {
    key: 'errorClipboardUnsupported',
    fallback: 'Copying an image to the clipboard isn’t supported here. Download the PNG instead.',
  },
  DOWNLOAD_DENIED: {
    key: 'errorDownloadDenied',
    fallback: 'Download permission was denied. Grant it in Settings or use the preview to save.',
  },
  STITCH_FAILED: {
    key: 'errorStitchFailed',
    fallback: 'The captured slices could not be combined. Please retry.',
  },
  ALREADY_RUNNING: {
    key: 'errorAlreadyRunning',
    fallback: 'A capture is already running for this tab.',
  },
  CANCELLED: {
    key: 'errorCancelled',
    fallback: 'Capture cancelled.',
  },
  INTERNAL: {
    key: 'errorInternal',
    fallback: 'Something went wrong during capture. Please retry.',
  },
};

function friendly(code: CaptureErrorCode): string {
  const entry = FRIENDLY[code] ?? FRIENDLY.INTERNAL;
  return t(entry.key, undefined, entry.fallback);
}

export class CaptureError extends Error {
  readonly code: CaptureErrorCode;
  readonly retryable: boolean;

  constructor(code: CaptureErrorCode, detail?: string, retryable = false) {
    const message = friendly(code);
    super(detail ? `${message} (${detail})` : message);
    this.name = 'CaptureError';
    this.code = code;
    this.retryable = retryable;
  }

  /** Message safe to show to the user. */
  get friendly(): string {
    return friendly(this.code);
  }

  static friendlyFor(code: CaptureErrorCode): string {
    return friendly(code);
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
