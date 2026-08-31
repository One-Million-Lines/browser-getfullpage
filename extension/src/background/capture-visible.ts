import { captureVisibleTab } from '@/platform/browser';
import {
  CAPTURE_BACKOFF_BASE_MS,
  CAPTURE_MAX_ATTEMPTS,
  MIN_CAPTURE_INTERVAL_MS,
} from '@/shared/constants';
import { CaptureError } from '@/shared/errors';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

let lastCaptureAt = 0;

/**
 * Capture the visible tab with throttling and bounded exponential backoff.
 * Chromium rate-limits captureVisibleTab (MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND);
 * we pace calls and retry transient failures up to 3 times (spec §5.3, §8).
 */
export async function captureVisible(
  windowId: number,
  isCancelled: () => boolean,
): Promise<string> {
  let attempt = 0;
  let lastError: unknown;
  while (attempt < CAPTURE_MAX_ATTEMPTS) {
    if (isCancelled()) throw new CaptureError('CANCELLED');

    const since = Date.now() - lastCaptureAt;
    if (since < MIN_CAPTURE_INTERVAL_MS) await sleep(MIN_CAPTURE_INTERVAL_MS - since);

    try {
      const dataUrl = await captureVisibleTab(windowId);
      lastCaptureAt = Date.now();
      if (!dataUrl || !dataUrl.startsWith('data:image')) {
        throw new Error('empty capture result');
      }
      return dataUrl;
    } catch (e) {
      lastError = e;
      attempt += 1;
      lastCaptureAt = Date.now();
      if (attempt >= CAPTURE_MAX_ATTEMPTS) break;
      await sleep(CAPTURE_BACKOFF_BASE_MS * 2 ** (attempt - 1));
    }
  }
  throw new CaptureError(
    'CAPTURE_API_FAILED',
    lastError instanceof Error ? lastError.message : String(lastError),
    true,
  );
}
