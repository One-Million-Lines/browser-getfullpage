import {
  backgroundHasDom,
  createTab,
  ext,
  focusTab,
  getTab,
  hasOffscreen,
  queryActiveTab,
  runtimeUrl,
  storageGet,
  storageRemove,
  storageSet,
} from '@/platform/browser';
import { clearAllTransient, clearSlices, getMarker, getResult, purgeCapture, setMarker } from '@/platform/idb';
import { closeOffscreen, ensureOffscreen } from '@/platform/offscreen';
import { loadSettings } from '@/platform/settings-store';
import { downloadBlob } from '@/platform/downloads';
import { compositeCapture } from '@/capture/compositor';
import { encodeImage, extForFormat } from '@/export/image';
import { CaptureSession } from './session';
import { documentToken, isCapturableUrl } from './tab-validation';
import { CAPTURE_PORT } from '@/shared/constants';
import { CaptureError, toCaptureError } from '@/shared/errors';
import { hostFromUrl, renderFilename, sanitizeSubfolder } from '@/shared/filename';
import { recordUsage } from '@/shared/review';
import { t } from '@/shared/i18n';
import type { RuntimeMessage } from '@/shared/messages';
import type {
  CaptureId,
  CaptureMode,
  CaptureProgress,
  CaptureResult,
  CompositeParams,
  Settings,
} from '@/shared/types';
import type { RunResult } from './session';

/* ------------------------------ session state ------------------------------ */

let activeSession: CaptureSession | null = null;
let activeTabId: number | null = null;

interface StoredTarget {
  tabId: number;
  windowId: number;
  url: string;
}

const targetKey = (id: CaptureId) => `target:${id}`;

/* ----------------------------- offscreen stitch ---------------------------- */

interface PendingStitch {
  resolve: (r: CaptureResult) => void;
  reject: (e: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
}
const pendingStitch = new Map<CaptureId, PendingStitch>();

function stitchViaOffscreen(
  captureId: CaptureId,
  composite: CompositeParams,
  download?: { format: Settings['defaultFormat']; jpegQuality: number; filenameTemplate: string; subfolder: string },
): Promise<CaptureResult> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingStitch.delete(captureId);
      reject(new CaptureError('STITCH_FAILED', 'offscreen compositing timed out'));
    }, 120000);
    pendingStitch.set(captureId, { resolve, reject, timer });
    ensureOffscreen()
      .then((ok) => {
        if (!ok) throw new CaptureError('STITCH_FAILED', 'offscreen unavailable');
        return ext.runtime.sendMessage({ type: 'STITCH_START', captureId, composite, download });
      })
      .catch((e) => {
        const p = pendingStitch.get(captureId);
        if (p) {
          clearTimeout(p.timer);
          pendingStitch.delete(captureId);
          p.reject(e);
        }
      });
  });
}

/* ------------------------------ action badge ------------------------------- */

function setBadge(text: string, color = '#4f46e5'): void {
  try {
    ext.action.setBadgeText({ text });
    ext.action.setBadgeBackgroundColor({ color });
  } catch {
    /* action API may be unavailable in some contexts */
  }
}

function setActionError(code: string): void {
  setBadge('!', '#dc2626');
  try {
    ext.action.setTitle({
      title: t('actionErrorTitle', CaptureError.friendlyFor(code as never), `GetFullPage — ${CaptureError.friendlyFor(code as never)}`),
    });
  } catch {
    /* ignore */
  }
}

function clearBadgeSoon(): void {
  setTimeout(() => {
    setBadge('');
    try {
      ext.action.setTitle({ title: t('actionTitle', undefined, 'Capture full page (GetFullPage)') });
    } catch {
      /* ignore */
    }
  }, 2500);
}

function onProgress(p: CaptureProgress): void {
  if (p.state === 'capturing' && p.total > 0) {
    setBadge(`${Math.round((p.current / p.total) * 100)}`);
  } else if (p.state === 'preparing' || p.state === 'measuring') {
    setBadge('…');
  } else if (p.state === 'stitching') {
    setBadge('✓', '#16a34a');
  }
  ext.runtime.sendMessage({ type: 'CAPTURE_PROGRESS', progress: p }).catch(() => undefined);
}

/* --------------------------------- finalize -------------------------------- */

function toComposite(run: RunResult, settings: Settings): CompositeParams {
  return {
    captureId: run.captureId,
    mode: run.mode,
    url: run.url,
    title: run.title,
    totalHeightCss: run.plan.totalHeightCss,
    viewportHeightCss: run.plan.viewportHeightCss,
    truncated: run.plan.truncated,
    truncationReason: run.plan.truncationReason,
    memoryCeilingBytes: settings.memoryCeilingBytes,
  };
}

const compositeKey = (id: CaptureId) => `composite:${id}`;

async function purgeAll(captureId: CaptureId): Promise<void> {
  await purgeCapture(captureId);
  await storageRemove(targetKey(captureId));
  await storageRemove(compositeKey(captureId));
}

function openPreview(captureId: CaptureId): Promise<chrome.tabs.Tab> {
  return createTab(`${runtimeUrl('preview/preview.html')}?id=${encodeURIComponent(captureId)}`);
}

function openPreviewError(code: string, tabId?: number): Promise<chrome.tabs.Tab> {
  const t = tabId != null ? `&tab=${tabId}` : '';
  return createTab(`${runtimeUrl('preview/preview.html')}?error=${encodeURIComponent(code)}${t}`);
}

const downloadOpts = (settings: Settings) => ({
  format: settings.defaultFormat,
  jpegQuality: settings.jpegQuality,
  filenameTemplate: settings.filenameTemplate,
  subfolder: settings.downloadSubfolder,
});

/** Composite in the background (Firefox event page) and clear source slices. */
async function compositeInBackground(
  composite: CompositeParams,
  download?: ReturnType<typeof downloadOpts>,
): Promise<void> {
  const result = await compositeCapture(composite);
  if (download) {
    const stored = await getResult(composite.captureId);
    if (stored) {
      const blob = await encodeImage(stored.blob, download.format, download.jpegQuality);
      const filename = renderFilename(
        download.filenameTemplate,
        {
          title: result.title,
          host: hostFromUrl(result.url),
          date: new Date(result.capturedAt),
          width: result.widthPx,
          height: result.heightPx,
        },
        extForFormat(download.format),
      );
      await downloadBlob(blob, filename, {
        subfolder: sanitizeSubfolder(download.subfolder),
        preferApi: true,
      });
    }
  }
  await clearSlices(composite.captureId);
}

/**
 * Produce the master result in IndexedDB. Composites headlessly where possible
 * (offscreen on Chromium, background DOM on Firefox); if neither is available
 * the preview page composites from the persisted params as a fallback. Never
 * throws — the preview flow always has a path to the image.
 */
async function produceResult(
  composite: CompositeParams,
  download?: ReturnType<typeof downloadOpts>,
): Promise<boolean> {
  try {
    if (hasOffscreen()) {
      await stitchViaOffscreen(composite.captureId, composite, download);
      return true;
    }
    if (backgroundHasDom()) {
      await compositeInBackground(composite, download);
      return true;
    }
  } catch {
    /* fall back to preview-side compositing */
  }
  return false;
}

async function finalize(run: RunResult, settings: Settings): Promise<void> {
  const composite = toComposite(run, settings);
  // Persist params so the preview can composite even if headless stitching fails.
  await storageSet(compositeKey(run.captureId), composite);

  // Count each successful capture toward the local review prompt.
  await recordUsage().catch(() => undefined);

  if (settings.postCapture === 'download') {
    const ok = await produceResult(composite, downloadOpts(settings));
    if (ok) {
      await purgeAll(run.captureId);
      return;
    }
    // Fall through to preview so the user can still save manually.
  } else {
    // Best-effort headless compositing so the preview opens with the image ready.
    await produceResult(composite);
  }
  await openPreview(run.captureId);
}

/* ------------------------------- start capture ----------------------------- */

async function clearStaleState(): Promise<void> {
  // Any open preview already holds its image in memory, so it is safe to wipe
  // leftover transient data and stale keys from previous captures here.
  try {
    await clearAllTransient();
    const all = await ext.storage.local.get(null);
    const stale = Object.keys(all).filter((k) => k.startsWith('target:') || k.startsWith('composite:'));
    if (stale.length) await ext.storage.local.remove(stale);
  } catch {
    /* best effort */
  }
}

async function startCapture(
  tabIdArg?: number,
  mode: CaptureMode = 'full',
): Promise<void> {
  // Second invocation cancels the active capture (spec §5.1).
  if (activeSession) {
    activeSession.cancel(new CaptureError('CANCELLED'));
    return;
  }

  const tab = tabIdArg != null ? await getTab(tabIdArg) : await queryActiveTab();
  if (!tab || tab.id == null || tab.windowId == null) {
    setActionError('INTERNAL');
    clearBadgeSoon();
    return;
  }

  const check = isCapturableUrl(tab.url);
  if (!check.ok) {
    setActionError(check.code ?? 'RESTRICTED_URL');
    clearBadgeSoon();
    return;
  }

  const settings = await loadSettings();

  await clearStaleState();
  const captureId = crypto.randomUUID();
  const url = tab.url ?? '';
  await storageSet(targetKey(captureId), { tabId: tab.id, windowId: tab.windowId, url } as StoredTarget);

  const session = new CaptureSession({
    target: { captureId, tabId: tab.id, windowId: tab.windowId, url, documentToken: documentToken(url) },
    title: tab.title ?? '',
    mode,
    settings,
    onProgress,
  });
  activeSession = session;
  activeTabId = tab.id;

  try {
    const run = await session.run();
    await finalize(run, settings);
    clearBadgeSoon();
  } catch (e) {
    const err = toCaptureError(e);
    await purgeAll(captureId);
    if (err.code !== 'CANCELLED') {
      setActionError(err.code);
      await openPreviewError(err.code, tab.id).catch(() => undefined);
    }
    clearBadgeSoon();
  } finally {
    if (activeSession === session) {
      activeSession = null;
      activeTabId = null;
    }
  }
}

async function retake(captureId: CaptureId): Promise<void> {
  const target = await storageGet<StoredTarget>(targetKey(captureId));
  if (!target) {
    setActionError('INTERNAL');
    return;
  }
  await focusTab(target.tabId, target.windowId);
  await startCapture(target.tabId, 'full');
}

/* ------------------------------- event wiring ------------------------------ */

ext.action.onClicked.addListener((tab) => {
  void startCapture(tab?.id, 'full');
});

(ext.commands?.onCommand as chrome.events.Event<(command: string) => void> | undefined)?.addListener(
  (command: string) => {
    if (command === 'capture-full-page') void startCapture(undefined, 'full');
    else if (command === 'capture-viewport') void startCapture(undefined, 'viewport');
  },
);

ext.runtime.onConnect.addListener((port) => {
  if (port.name === CAPTURE_PORT && activeSession) {
    activeSession.attachPort(port);
  } else if (port.name === CAPTURE_PORT) {
    // No active session owns this port; close it so the content script restores.
    try {
      port.disconnect();
    } catch {
      /* ignore */
    }
  }
});

ext.runtime.onMessage.addListener((message: RuntimeMessage) => {
  switch (message?.type) {
    case 'CAPTURE_START':
      void startCapture(message.tabId, message.mode ?? 'full');
      return false;
    case 'CAPTURE_CANCEL':
      activeSession?.cancel(new CaptureError('CANCELLED'));
      return false;
    case 'RETAKE':
      void retake(message.captureId);
      return false;
    case 'STITCH_COMPLETE': {
      const p = pendingStitch.get(message.captureId);
      if (p) {
        clearTimeout(p.timer);
        pendingStitch.delete(message.captureId);
        p.resolve(message.result);
      }
      return false;
    }
    case 'STITCH_FAILED': {
      const p = pendingStitch.get(message.captureId);
      if (p) {
        clearTimeout(p.timer);
        pendingStitch.delete(message.captureId);
        p.reject(new CaptureError(message.code, message.detail));
      }
      return false;
    }
    default:
      return false;
  }
});

ext.tabs.onRemoved.addListener((tabId) => {
  if (activeSession && tabId === activeTabId) {
    activeSession.cancel(new CaptureError('TAB_CHANGED', 'tab closed'));
  }
});

ext.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (activeSession && tabId === activeTabId && changeInfo.url) {
    activeSession.cancel(new CaptureError('TAB_NAVIGATED'));
  }
});

ext.tabs.onActivated.addListener((info) => {
  if (activeSession && activeTabId != null && info.tabId !== activeTabId) {
    activeSession.cancel(new CaptureError('TAB_INACTIVE'));
  }
});

async function recover(): Promise<void> {
  try {
    const marker = await getMarker();
    if (marker) {
      await purgeAll(marker);
      await setMarker(null);
    }
    await closeOffscreen();
  } catch {
    /* best effort */
  }
}

(ext.runtime.onStartup as chrome.events.Event<() => void> | undefined)?.addListener(() => void recover());
ext.runtime.onInstalled.addListener(() => void recover());
