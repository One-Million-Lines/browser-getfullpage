import { ext, hasOffscreen, storageGet } from '@/platform/browser';
import { clearSlices, getResult } from '@/platform/idb';
import { loadSettings } from '@/platform/settings-store';
import { downloadBlob } from '@/platform/downloads';
import { requestPermissions } from '@/platform/permissions';
import { clipboardImageSupported, copyImageToClipboard } from '@/platform/clipboard';
import { compositeCapture } from '@/capture/compositor';
import { encodeImage, extForFormat } from '@/export/image';
import { buildPdfFromMaster } from '@/export/pdf';
import { cropImage, rotateImage, type CropRect } from './edit-image';
import { CaptureError, toCaptureError } from '@/shared/errors';
import { hostFromUrl, renderFilename } from '@/shared/filename';
import { ZOOM_MAX, ZOOM_MIN } from '@/shared/constants';
import type { CaptureResult, CompositeParams, ImageFormat, Settings } from '@/shared/types';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const el = {
  overlay: $('overlay'),
  overlayText: $<HTMLParagraphElement>('overlayText'),
  errorView: $('errorView'),
  errorTitle: $('errorTitle'),
  errorText: $('errorText'),
  errorRetry: $<HTMLButtonElement>('errorRetry'),
  errorClose: $<HTMLButtonElement>('errorClose'),
  toast: $('toast'),
  image: $<HTMLImageElement>('image'),
  stage: $('stage'),
  canvasWrap: $('canvasWrap'),
  zoomLabel: $('zoomLabel'),
  metaName: $('metaName'),
  metaDims: $('metaDims'),
  metaSize: $('metaSize'),
  metaUrl: $('metaUrl'),
  metaTime: $('metaTime'),
  metaWarn: $('metaWarn'),
  metaDevice: $('metaDevice'),
  cropLayer: $('cropLayer'),
  cropBox: $<HTMLDivElement>('cropBox'),
};

interface PreviewState {
  captureId: string;
  meta: CaptureResult;
  original: Blob;
  current: Blob;
  width: number;
  height: number;
  dirty: boolean;
  zoom: number;
  settings: Settings;
  objectUrl: string;
}

let state: PreviewState | null = null;

/* --------------------------------- helpers --------------------------------- */

function toast(message: string, ms = 2600): void {
  el.toast.textContent = message;
  el.toast.hidden = false;
  window.clearTimeout((toast as unknown as { t?: number }).t);
  (toast as unknown as { t?: number }).t = window.setTimeout(() => (el.toast.hidden = true), ms);
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function filenameFor(ext: string): string {
  if (!state) return `getfullpage.${ext}`;
  return renderFilename(
    state.settings.filenameTemplate,
    {
      title: state.meta.title,
      host: hostFromUrl(state.meta.url),
      date: new Date(state.meta.capturedAt),
      width: state.width,
      height: state.height,
    },
    ext,
  );
}

function showOverlay(text: string): void {
  el.overlayText.textContent = text;
  el.overlay.hidden = false;
}
function hideOverlay(): void {
  el.overlay.hidden = true;
}

function showError(code: string, tabId?: number): void {
  hideOverlay();
  el.errorText.textContent = CaptureError.friendlyFor(code as never);
  el.errorView.hidden = false;
  el.errorRetry.onclick = () => {
    if (tabId != null) {
      ext.runtime.sendMessage({ type: 'CAPTURE_START', tabId, mode: 'full' }).catch(() => undefined);
      window.close();
    } else if (state) {
      ext.runtime.sendMessage({ type: 'RETAKE', captureId: state.captureId }).catch(() => undefined);
      window.close();
    } else {
      toast('Click the GetFullPage toolbar icon on the page you want to capture.');
    }
  };
  el.errorClose.onclick = () => window.close();
}

/* ------------------------------- image + zoom ------------------------------ */

function setImage(blob: Blob, width: number, height: number): void {
  if (!state) return;
  if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
  state.current = blob;
  state.width = width;
  state.height = height;
  state.objectUrl = URL.createObjectURL(blob);
  el.image.src = state.objectUrl;
  el.image.onload = () => applyZoom();
  renderMeta();
}

function setZoom(z: number): void {
  if (!state) return;
  state.zoom = Math.min(8, Math.max(0.05, z));
  applyZoom();
}

function applyZoom(): void {
  if (!state) return;
  const displayW = Math.max(1, Math.round(state.width * state.zoom));
  el.image.style.width = `${displayW}px`;
  el.image.style.height = 'auto';
  el.canvasWrap.style.width = `${displayW}px`;
  el.zoomLabel.textContent = `${Math.round(state.zoom * 100)}%`;
}

function fitWidth(): void {
  if (!state) return;
  const avail = el.stage.clientWidth - 48;
  setZoom(avail / state.width);
}
function fitPage(): void {
  if (!state) return;
  const availW = el.stage.clientWidth - 48;
  const availH = el.stage.clientHeight - 48;
  setZoom(Math.min(availW / state.width, availH / state.height));
}
function zoomStep(factor: number): void {
  if (!state) return;
  const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, state.zoom * factor));
  setZoom(next);
}

/* -------------------------------- metadata --------------------------------- */

function renderMeta(): void {
  if (!state) return;
  const ext0 = state.settings.defaultFormat === 'jpeg' ? 'jpg' : 'png';
  el.metaName.textContent = filenameFor(ext0);
  el.metaDims.textContent = `${state.width} × ${state.height} px`;
  el.metaSize.textContent = `~${formatBytes(state.current.size)}`;
  el.metaUrl.textContent = state.meta.url;
  el.metaUrl.title = state.meta.url;
  el.metaTime.textContent = new Date(state.meta.capturedAt).toLocaleString();
  if (state.meta.mobile) {
    el.metaDevice.hidden = false;
    el.metaDevice.textContent = `📱 ${state.meta.deviceLabel ?? 'Mobile'}`;
  } else {
    el.metaDevice.hidden = true;
  }
  if (state.meta.truncated || state.meta.truncationReason) {
    el.metaWarn.hidden = false;
    el.metaWarn.textContent = `⚠ ${state.meta.truncationReason ?? 'Result was truncated.'}`;
  } else {
    el.metaWarn.hidden = true;
  }
  updateMobileButton();
}

/* ------------------------------- mobile toggle ----------------------------- */

function wireMobileButton(): void {
  const btn = $<HTMLButtonElement>('btnMobile');
  // Mobile emulation uses the Chromium debugger protocol; hide elsewhere.
  if (!hasOffscreen()) {
    btn.hidden = true;
    return;
  }
  btn.hidden = false;
  btn.onclick = async () => {
    if (!state) return;
    const targetMobile = !state.meta.mobile;
    if (targetMobile) {
      const granted = await requestPermissions(['debugger']);
      if (!granted) {
        toast('Mobile capture needs the debugger permission (grant it to continue).');
        return;
      }
    }
    ext.runtime
      .sendMessage({ type: 'RETAKE', captureId: state.captureId, mobile: targetMobile })
      .catch(() => undefined);
    window.close();
  };
}

function updateMobileButton(): void {
  const btn = $<HTMLButtonElement>('btnMobile');
  if (btn.hidden) return;
  btn.textContent = state?.meta.mobile ? 'Recapture as desktop' : 'Capture as mobile';
}

/* --------------------------------- exports --------------------------------- */

async function exportImage(format: ImageFormat): Promise<void> {
  if (!state) return;
  try {
    const blob =
      format === 'png' ? state.current : await encodeImage(state.current, 'jpeg', state.settings.jpegQuality);
    await downloadBlob(blob, filenameFor(extForFormat(format)), {
      subfolder: state.settings.downloadSubfolder || undefined,
    });
    state.dirty = false;
  } catch (e) {
    toast(toCaptureError(e).friendly);
  }
}

async function exportPdf(): Promise<void> {
  if (!state) return;
  showOverlay('Building PDF…');
  try {
    const meta = { ...state.meta, widthPx: state.width, heightPx: state.height };
    const blob = await buildPdfFromMaster(state.current, meta, {
      pdf: state.settings.pdf,
      jpegQuality: 0.85,
    });
    await downloadBlob(blob, filenameFor('pdf'), {
      subfolder: state.settings.downloadSubfolder || undefined,
    });
    state.dirty = false;
  } catch (e) {
    toast(toCaptureError(e).friendly);
  } finally {
    hideOverlay();
  }
}

async function copyImage(): Promise<void> {
  if (!state) return;
  if (!clipboardImageSupported()) {
    toast('Clipboard image copy isn’t supported here — downloading PNG instead.');
    await exportImage('png');
    return;
  }
  try {
    await copyImageToClipboard(state.current);
    toast('Image copied to clipboard.');
  } catch {
    toast('Couldn’t copy image — downloading PNG instead.');
    await exportImage('png');
  }
}

/* ----------------------------------- crop ---------------------------------- */

let cropActive = false;

function toggleCrop(): void {
  if (!state) return;
  cropActive = !cropActive;
  el.cropLayer.hidden = !cropActive;
  $<HTMLButtonElement>('btnCrop').setAttribute('aria-pressed', String(cropActive));
  if (cropActive) {
    // Reset the crop box to a central default.
    el.cropBox.style.left = '10%';
    el.cropBox.style.top = '10%';
    el.cropBox.style.width = '80%';
    el.cropBox.style.height = '40%';
  }
}

function setupCropDragging(): void {
  let mode: 'move' | 'nw' | 'ne' | 'sw' | 'se' | null = null;
  let startX = 0;
  let startY = 0;
  let box = { left: 0, top: 0, w: 0, h: 0 };

  const onDown = (e: PointerEvent) => {
    const target = e.target as HTMLElement;
    if (target.classList.contains('handle')) {
      mode = (['nw', 'ne', 'sw', 'se'].find((c) => target.classList.contains(c)) as typeof mode) ?? null;
    } else {
      mode = 'move';
    }
    const rect = el.cropBox.getBoundingClientRect();
    const wrap = el.canvasWrap.getBoundingClientRect();
    box = { left: rect.left - wrap.left, top: rect.top - wrap.top, w: rect.width, h: rect.height };
    startX = e.clientX;
    startY = e.clientY;
    el.cropBox.setPointerCapture(e.pointerId);
    e.preventDefault();
  };

  const onMove = (e: PointerEvent) => {
    if (!mode) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    const wrap = el.canvasWrap.getBoundingClientRect();
    let { left, top, w, h } = box;
    if (mode === 'move') {
      left += dx;
      top += dy;
    } else {
      if (mode.includes('w')) {
        left += dx;
        w -= dx;
      }
      if (mode.includes('e')) w += dx;
      if (mode.includes('n')) {
        top += dy;
        h -= dy;
      }
      if (mode.includes('s')) h += dy;
    }
    w = Math.max(20, w);
    h = Math.max(20, h);
    left = Math.max(0, Math.min(left, wrap.width - w));
    top = Math.max(0, Math.min(top, wrap.height - h));
    el.cropBox.style.left = `${left}px`;
    el.cropBox.style.top = `${top}px`;
    el.cropBox.style.width = `${w}px`;
    el.cropBox.style.height = `${h}px`;
  };

  const onUp = () => {
    mode = null;
  };

  el.cropBox.addEventListener('pointerdown', onDown);
  el.cropBox.addEventListener('pointermove', onMove);
  el.cropBox.addEventListener('pointerup', onUp);
}

async function applyCrop(): Promise<void> {
  if (!state) return;
  const wrap = el.canvasWrap.getBoundingClientRect();
  const box = el.cropBox.getBoundingClientRect();
  const scaleX = state.width / wrap.width;
  const scaleY = state.height / wrap.height;
  const rect: CropRect = {
    x: (box.left - wrap.left) * scaleX,
    y: (box.top - wrap.top) * scaleY,
    w: box.width * scaleX,
    h: box.height * scaleY,
  };
  showOverlay('Cropping…');
  try {
    const edited = await cropImage(state.current, rect);
    state.dirty = true;
    setImage(edited.blob, edited.width, edited.height);
    $<HTMLButtonElement>('btnReset').hidden = false;
    toggleCrop();
  } catch (e) {
    toast(toCaptureError(e).friendly);
  } finally {
    hideOverlay();
  }
}

async function rotate(): Promise<void> {
  if (!state) return;
  showOverlay('Rotating…');
  try {
    const edited = await rotateImage(state.current, 'cw');
    state.dirty = true;
    setImage(edited.blob, edited.width, edited.height);
    $<HTMLButtonElement>('btnReset').hidden = false;
  } catch (e) {
    toast(toCaptureError(e).friendly);
  } finally {
    hideOverlay();
  }
}

function resetEdits(): void {
  if (!state) return;
  state.dirty = false;
  setImage(state.original, state.meta.widthPx, state.meta.heightPx);
  $<HTMLButtonElement>('btnReset').hidden = true;
}

/* ---------------------------------- wiring --------------------------------- */

function wireToolbar(): void {
  $<HTMLButtonElement>('btnPng').onclick = () => void exportImage('png');
  $<HTMLButtonElement>('btnJpeg').onclick = () => void exportImage('jpeg');
  $<HTMLButtonElement>('btnPdf').onclick = () => void exportPdf();
  $<HTMLButtonElement>('btnCopy').onclick = () => void copyImage();
  $<HTMLButtonElement>('btnCrop').onclick = () => toggleCrop();
  $<HTMLButtonElement>('btnRotate').onclick = () => void rotate();
  $<HTMLButtonElement>('btnReset').onclick = () => resetEdits();
  $<HTMLButtonElement>('btnRetake').onclick = () => {
    if (state) {
      ext.runtime.sendMessage({ type: 'RETAKE', captureId: state.captureId, mobile: state.meta.mobile }).catch(() => undefined);
      window.close();
    }
  };
  wireMobileButton();
  $<HTMLButtonElement>('btnSettings').onclick = () => {
    if (ext.runtime.openOptionsPage) ext.runtime.openOptionsPage();
  };

  $<HTMLButtonElement>('btnFitWidth').onclick = () => fitWidth();
  $<HTMLButtonElement>('btnFitPage').onclick = () => fitPage();
  $<HTMLButtonElement>('zoomIn').onclick = () => zoomStep(1.25);
  $<HTMLButtonElement>('zoomOut').onclick = () => zoomStep(0.8);
  $<HTMLButtonElement>('zoom100').onclick = () => setZoom(1);
  $<HTMLButtonElement>('cropApply').onclick = () => void applyCrop();
  $<HTMLButtonElement>('cropCancel').onclick = () => toggleCrop();

  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement) return;
    if (e.key === '+' || e.key === '=') zoomStep(1.25);
    else if (e.key === '-') zoomStep(0.8);
    else if (e.key === '0') setZoom(1);
    else if (e.key === 'Escape' && cropActive) toggleCrop();
  });

  window.addEventListener('beforeunload', (e) => {
    if (state?.dirty) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
}

/* ----------------------------------- init ---------------------------------- */

async function loadCapture(captureId: string): Promise<void> {
  const settings = await loadSettings();

  let result = await getResult(captureId);
  if (!result) {
    // Headless compositing did not run; composite from persisted params here.
    const params = await storageGet<CompositeParams>(`composite:${captureId}`);
    if (params) {
      showOverlay('Stitching capture…');
      try {
        await compositeCapture(params);
      } catch (e) {
        showError(toCaptureError(e).code);
        return;
      }
    }
    result = await getResult(captureId);
  }

  if (!result) {
    showError('STITCH_FAILED');
    return;
  }

  // Free the transient slices; the master image is enough for every export.
  await clearSlices(captureId).catch(() => undefined);

  state = {
    captureId,
    meta: result.meta,
    original: result.blob,
    current: result.blob,
    width: result.meta.widthPx,
    height: result.meta.heightPx,
    dirty: false,
    zoom: 1,
    settings,
    objectUrl: '',
  };

  setImage(result.blob, result.meta.widthPx, result.meta.heightPx);
  hideOverlay();
  requestAnimationFrame(() => fitWidth());
}

async function init(): Promise<void> {
  wireToolbar();
  setupCropDragging();

  const params = new URLSearchParams(location.search);
  const errorCode = params.get('error');
  const tabParam = params.get('tab');
  const id = params.get('id');

  if (errorCode) {
    showError(errorCode, tabParam ? Number(tabParam) : undefined);
    return;
  }
  if (!id) {
    showError('INTERNAL');
    return;
  }
  await loadCapture(id);
}

void init();
