import { ext } from '@/platform/browser';
import { clearSlices, getResult } from '@/platform/idb';
import { downloadBlob } from '@/platform/downloads';
import { compositeCapture } from '@/capture/compositor';
import { encodeImage, extForFormat } from '@/export/image';
import { renderFilename, hostFromUrl, sanitizeSubfolder } from '@/shared/filename';
import { toCaptureError } from '@/shared/errors';
import type {
  RuntimeMessage,
  StitchCompleteMessage,
  StitchFailedMessage,
  StitchStartMessage,
} from '@/shared/messages';

/**
 * Offscreen document (Chromium): composites captured slices with canvas access
 * off the service worker, and — for auto-download — encodes and saves the image
 * without opening a preview tab (spec §5.6, §5.10). Everything stays local.
 */

async function handleStitch(msg: StitchStartMessage): Promise<void> {
  try {
    const result = await compositeCapture(msg.composite);

    if (msg.download) {
      const stored = await getResult(msg.captureId);
      if (stored) {
        const blob = await encodeImage(stored.blob, msg.download.format, msg.download.jpegQuality);
        const filename = renderFilename(
          msg.download.filenameTemplate,
          {
            title: result.title,
            host: hostFromUrl(result.url),
            date: new Date(result.capturedAt),
            width: result.widthPx,
            height: result.heightPx,
          },
          extForFormat(msg.download.format),
        );
        await downloadBlob(blob, filename, {
          subfolder: sanitizeSubfolder(msg.download.subfolder),
          preferApi: true,
        });
      }
    }

    // Slices are no longer needed once the master image exists.
    await clearSlices(msg.captureId);

    const done: StitchCompleteMessage = { type: 'STITCH_COMPLETE', captureId: msg.captureId, result };
    ext.runtime.sendMessage(done).catch(() => undefined);
  } catch (e) {
    const err = toCaptureError(e);
    const failed: StitchFailedMessage = {
      type: 'STITCH_FAILED',
      captureId: msg.captureId,
      code: err.code,
      detail: err.message,
    };
    ext.runtime.sendMessage(failed).catch(() => undefined);
  }
}

ext.runtime.onMessage.addListener((message: RuntimeMessage) => {
  if (message?.type === 'STITCH_START') {
    void handleStitch(message);
  }
  return undefined;
});

ext.runtime.sendMessage({ type: 'OFFSCREEN_READY' }).catch(() => undefined);
