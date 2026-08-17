import { CaptureError } from '@/shared/errors';

/**
 * Clipboard adapter. Tries the modern async Clipboard API with a ClipboardItem
 * from a direct user gesture (spec §5.9). No `clipboardWrite` permission is
 * requested; if the platform rejects image writes the caller shows a
 * download-PNG fallback.
 */

export function clipboardImageSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.clipboard !== 'undefined' &&
    typeof (navigator.clipboard as { write?: unknown }).write === 'function' &&
    typeof ClipboardItem !== 'undefined'
  );
}

/** Write a PNG blob to the clipboard. Throws CLIPBOARD_UNSUPPORTED on failure. */
export async function copyImageToClipboard(pngBlob: Blob): Promise<void> {
  if (!clipboardImageSupported()) {
    throw new CaptureError('CLIPBOARD_UNSUPPORTED');
  }
  try {
    const item = new ClipboardItem({ 'image/png': pngBlob });
    await navigator.clipboard.write([item]);
  } catch (e) {
    throw new CaptureError('CLIPBOARD_UNSUPPORTED', e instanceof Error ? e.message : String(e));
  }
}
