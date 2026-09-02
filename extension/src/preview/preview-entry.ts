import { ext, storageGet } from '@/platform/browser';
import { clearSlices, getResult } from '@/platform/idb';
import { loadSettings } from '@/platform/settings-store';
import { downloadBlob } from '@/platform/downloads';
import { clipboardImageSupported, copyImageToClipboard } from '@/platform/clipboard';
import { compositeCapture } from '@/capture/compositor';
import { encodeImage, extForFormat } from '@/export/image';
import { buildPdfFromMaster } from '@/export/pdf';
import { cropImage, rotateImage, type CropRect } from './edit-image';
import { DrawManager, applyBlurRegions, type DrawState, type DrawTool } from './draw-tools';
import { CaptureError, toCaptureError } from '@/shared/errors';
import { hostFromUrl, renderFilename } from '@/shared/filename';
import { maybeMountReviewWidget } from '@/shared/review';
import { localizeDocument, t } from '@/shared/i18n';
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
  cropLayer: $('cropLayer'),
  cropBox: $<HTMLDivElement>('cropBox'),
  annotateGroup: $('annotateGroup'),
  annotateColor: $<HTMLInputElement>('annotateColor'),
  annotateStroke: $<HTMLSelectElement>('annotateStroke'),
  annotateFontSize: $<HTMLSelectElement>('annotateFontSize'),
  btnAnnotate: $<HTMLButtonElement>('btnAnnotate'),
  btnAnnotateUndo: $<HTMLButtonElement>('btnAnnotateUndo'),
  btnAnnotateRedo: $<HTMLButtonElement>('btnAnnotateRedo'),
  btnAnnotateClear: $<HTMLButtonElement>('btnAnnotateClear'),
  btnAnnotateApply: $<HTMLButtonElement>('btnAnnotateApply'),
  btnAnnotateClose: $<HTMLButtonElement>('btnAnnotateClose'),
  btnToolRect: $<HTMLButtonElement>('btnToolRect'),
  btnToolEllipse: $<HTMLButtonElement>('btnToolEllipse'),
  btnToolLine: $<HTMLButtonElement>('btnToolLine'),
  btnToolArrow: $<HTMLButtonElement>('btnToolArrow'),
  btnToolText: $<HTMLButtonElement>('btnToolText'),
  btnToolBlur: $<HTMLButtonElement>('btnToolBlur'),
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
let drawManager: DrawManager | null = null;
let annotateActive = false;

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
      toast(
        t(
          'clickToolbarInstruction',
          undefined,
          'Click the GetFullPage toolbar icon on the page you want to capture.',
        ),
      );
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
  const size = formatBytes(state.current.size);
  el.metaName.textContent = filenameFor(ext0);
  el.metaDims.textContent = t(
    'metaDimensions',
    [String(state.width), String(state.height)],
    `${state.width} × ${state.height} px`,
  );
  el.metaSize.textContent = t('metaApproxSize', size, `~${size}`);
  el.metaUrl.textContent = state.meta.url;
  el.metaUrl.title = state.meta.url;
  el.metaTime.textContent = new Date(state.meta.capturedAt).toLocaleString();
  if (state.meta.truncated || state.meta.truncationReason) {
    el.metaWarn.hidden = false;
    el.metaWarn.textContent = `⚠ ${state.meta.truncationReason ?? t('resultTruncated', undefined, 'Result was truncated.')}`;
  } else {
    el.metaWarn.hidden = true;
  }
}

/* --------------------------------- exports --------------------------------- */

/** Returns a blob with annotations (including blur) composited in, without modifying state. */
async function blobWithAnnotations(): Promise<Blob> {
  if (!state) return new Blob();
  if (!drawManager || !drawManager.hasAnnotations()) return state.current;
  const withBlur = await applyBlurRegions(state.current, drawManager.getShapes(), state.width, state.height);
  const result = await drawManager.flatten(withBlur);
  return result.blob;
}

async function exportImage(format: ImageFormat): Promise<void> {
  if (!state) return;
  try {
    const base = await blobWithAnnotations();
    const blob =
      format === 'png' ? base : await encodeImage(base, 'jpeg', state.settings.jpegQuality);
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
  showOverlay(t('buildingPdf', undefined, 'Building PDF…'));
  try {
    const base = await blobWithAnnotations();
    const meta = { ...state.meta, widthPx: state.width, heightPx: state.height };
    const blob = await buildPdfFromMaster(base, meta, {
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
    toast(
      t(
        'clipboardUnsupportedToast',
        undefined,
        "Clipboard image copy isn\u2019t supported here \u2014 downloading PNG instead.",
      ),
    );
    await exportImage('png');
    return;
  }
  try {
    const blob = await blobWithAnnotations();
    await copyImageToClipboard(blob);
    toast(t('imageCopiedToast', undefined, 'Image copied to clipboard.'));
  } catch {
    toast(t('copyFailedToast', undefined, "Couldn\u2019t copy image \u2014 downloading PNG instead."));
    await exportImage('png');
  }
}

/* ----------------------------------- crop ---------------------------------- */

let cropActive = false;

function setCropActive(active: boolean): void {
  cropActive = active;
  el.cropLayer.hidden = !active;
  $<HTMLButtonElement>('btnCrop').setAttribute('aria-pressed', String(active));
}

function toggleCrop(): void {
  if (!state) return;

  if (cropActive) {
    setCropActive(false);
    return;
  }

  // Crop and annotate are mutually exclusive editing modes.
  if (annotateActive) toggleAnnotate();
  if (drawManager?.hasAnnotations()) {
    toast(t('applyAnnotationsFirstToast', undefined, 'Apply or clear annotations before cropping or rotating.'));
    return;
  }

  setCropActive(true);
  // Reset the crop box to a central default.
  el.cropBox.style.left = '10%';
  el.cropBox.style.top = '10%';
  el.cropBox.style.width = '80%';
  el.cropBox.style.height = '40%';
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
  showOverlay(t('cropping', undefined, 'Cropping…'));
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

  // Rotate is an immediate action, so leave no editing mode active.
  if (cropActive) setCropActive(false);
  if (annotateActive) toggleAnnotate();
  if (drawManager?.hasAnnotations()) {
    toast(t('applyAnnotationsFirstToast', undefined, 'Apply or clear annotations before cropping or rotating.'));
    return;
  }
  showOverlay(t('rotating', undefined, 'Rotating…'));
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
  setCropActive(false);
  destroyDrawManager();
  state.dirty = false;
  setImage(state.original, state.meta.widthPx, state.meta.heightPx);
  $<HTMLButtonElement>('btnReset').hidden = true;
}

function destroyDrawManager(): void {
  drawManager?.destroy();
  drawManager = null;
  annotateActive = false;
  el.annotateGroup.hidden = true;
  el.btnAnnotate.setAttribute('aria-pressed', 'false');
  el.btnAnnotateUndo.disabled = true;
  el.btnAnnotateRedo.disabled = true;
  for (const btn of [
    el.btnToolRect,
    el.btnToolEllipse,
    el.btnToolLine,
    el.btnToolArrow,
    el.btnToolText,
    el.btnToolBlur,
  ]) {
    btn.setAttribute('aria-pressed', 'false');
  }
}

function toggleAnnotate(): void {
  if (!state) return;

  // Crop and annotate are mutually exclusive editing modes.
  if (!annotateActive && cropActive) setCropActive(false);
  annotateActive = !annotateActive;
  el.annotateGroup.hidden = !annotateActive;
  el.btnAnnotate.setAttribute('aria-pressed', String(annotateActive));

  if (annotateActive && !drawManager) {
    drawManager = new DrawManager(el.canvasWrap, state.width, state.height, (drawState: DrawState) => {
      el.btnAnnotateUndo.disabled = !drawState.canUndo;
      el.btnAnnotateRedo.disabled = !drawState.canRedo;
    }, el.image);
    drawManager.setColor(el.annotateColor.value);
    drawManager.setStrokeWidth(Number(el.annotateStroke.value));
    drawManager.setFontSize(Number(el.annotateFontSize.value));
    drawManager.setTool('arrow');
    el.btnToolArrow.setAttribute('aria-pressed', 'true');
    el.annotateStroke.style.display = '';
    el.annotateFontSize.style.display = 'none';
  }

  if (drawManager) {
    drawManager.setEnabled(annotateActive);
  }

  if (!annotateActive && drawManager && !drawManager.hasAnnotations()) {
    destroyDrawManager();
  }
}

async function applyAnnotations(): Promise<void> {
  if (!state || !drawManager) return;
  if (!drawManager.hasAnnotations()) {
    toast(t('noAnnotationsToast', undefined, 'Draw some annotations first.'));
    return;
  }
  showOverlay(t('applyingAnnotations', undefined, 'Applying annotations…'));
  try {
    const withBlur = await applyBlurRegions(state.current, drawManager.getShapes(), state.width, state.height);
    const result = await drawManager.flatten(withBlur);
    state.dirty = true;
    destroyDrawManager();
    setImage(result.blob, result.width, result.height);
    $<HTMLButtonElement>('btnReset').hidden = false;
    toast(t('annotationsAppliedToast', undefined, 'Annotations applied.'));
  } catch (e) {
    toast((e as Error).message);
  } finally {
    hideOverlay();
  }
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
  el.btnAnnotate.onclick = () => toggleAnnotate();
  $<HTMLButtonElement>('btnRetake').onclick = () => {
    if (state) {
      ext.runtime.sendMessage({ type: 'RETAKE', captureId: state.captureId }).catch(() => undefined);
      window.close();
    }
  };
  $<HTMLButtonElement>('btnFeedback').onclick = () => {
    void ext.tabs.create({ url: ext.runtime.getURL('options/options.html#feedback') });
  };
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

  const fillColorPicker = $('fillColorPicker');
  const fillColorPalette = $('fillColorPalette');
  const fillColorPickerButton = $<HTMLButtonElement>('btnFillColorPicker');
  const fillColorPickerValue = $('fillColorPickerValue');
  const colorPalette = $('colorPalette');
  const colorPickerButton = $<HTMLButtonElement>('btnColorPicker');
  const colorPickerValue = $('colorPickerValue');

  const setColorPaletteOpen = (open: boolean): void => {
    colorPalette.hidden = !open;
    colorPickerButton.setAttribute('aria-expanded', String(open));
  };
  const setFillPaletteOpen = (open: boolean): void => {
    fillColorPalette.hidden = !open;
    fillColorPickerButton.setAttribute('aria-expanded', String(open));
  };

  const selectStrokeColor = (color: string, swatch?: HTMLButtonElement): void => {
    el.annotateColor.value = color;
    colorPickerValue.style.setProperty('--ck-color', color);
    drawManager?.setColor(color);
    colorPalette.querySelectorAll('.swatch').forEach(item => item.classList.remove('active'));
    swatch?.classList.add('active');
  };

  const selectFillColor = (fill: string, swatch?: HTMLButtonElement): void => {
    drawManager?.setFillColor(fill);
    if (fill === 'transparent') {
      fillColorPickerValue.style.removeProperty('background');
      fillColorPickerValue.classList.add('swatch-nofill');
    } else {
      fillColorPickerValue.style.background = fill;
      fillColorPickerValue.classList.remove('swatch-nofill');
    }
    fillColorPalette.querySelectorAll('.swatch').forEach(s => s.classList.remove('active'));
    swatch?.classList.add('active');
  };

  colorPickerButton.onclick = () => setColorPaletteOpen(colorPalette.hidden);
  fillColorPickerButton.onclick = () => setFillPaletteOpen(fillColorPalette.hidden);
  const toolButtons: Array<[HTMLButtonElement, DrawTool]> = [
    [el.btnToolRect, 'rect'],
    [el.btnToolEllipse, 'ellipse'],
    [el.btnToolLine, 'line'],
    [el.btnToolArrow, 'arrow'],
    [el.btnToolText, 'text'],
    [el.btnToolBlur, 'blur'],
  ];
  for (const [btn, tool] of toolButtons) {
    btn.onclick = () => {
      if (!drawManager) return;
      drawManager.setTool(tool);
      for (const [button] of toolButtons) button.setAttribute('aria-pressed', 'false');
      btn.setAttribute('aria-pressed', 'true');
      const hasFill = tool === 'rect' || tool === 'ellipse';
      fillColorPicker.style.display = hasFill ? '' : 'none';
      if (!hasFill) setFillPaletteOpen(false);
      // Stroke width is irrelevant for text; show the font-size picker instead.
      el.annotateStroke.style.display = tool === 'text' ? 'none' : '';
      el.annotateFontSize.style.display = tool === 'text' ? '' : 'none';
    };
  }

  el.annotateStroke.onchange = () => drawManager?.setStrokeWidth(Number(el.annotateStroke.value));
  el.annotateFontSize.onchange = () => drawManager?.setFontSize(Number(el.annotateFontSize.value));
  el.btnAnnotateUndo.onclick = () => drawManager?.undo();
  el.btnAnnotateRedo.onclick = () => drawManager?.redo();
  el.btnAnnotateClear.onclick = () => drawManager?.clearAll();
  el.btnAnnotateApply.onclick = () => void applyAnnotations();
  el.btnAnnotateClose.onclick = () => toggleAnnotate();

  // Color swatches (stroke palette)
  el.annotateGroup.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const swatch = target.closest<HTMLButtonElement>('#colorPalette .swatch:not(.swatch-more)');
    if (swatch && swatch.dataset.color) {
      selectStrokeColor(swatch.dataset.color, swatch);
      setColorPaletteOpen(false);
    }
    const fillSwatch = target.closest<HTMLButtonElement>('#fillColorPalette .swatch:not(.swatch-more)');
    if (fillSwatch) {
      selectFillColor(fillSwatch.dataset.fill ?? 'transparent', fillSwatch);
      setFillPaletteOpen(false);
    }
  });
  $<HTMLButtonElement>('btnCustomColor').onclick = () => el.annotateColor.click();
  el.annotateColor.oninput = () => selectStrokeColor(el.annotateColor.value);
  $<HTMLButtonElement>('btnCustomFill').onclick = () => $<HTMLInputElement>('annotateFill').click();
  $<HTMLInputElement>('annotateFill').oninput = (e) => selectFillColor((e.target as HTMLInputElement).value);

  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement) return;
    if (e.key === '+' || e.key === '=') zoomStep(1.25);
    else if (e.key === '-') zoomStep(0.8);
    else if (e.key === '0') setZoom(1);
    else if (e.key === 'Escape' && !colorPalette.hidden) setColorPaletteOpen(false);
    else if (e.key === 'Escape' && !fillColorPalette.hidden) setFillPaletteOpen(false);
    else if (e.key === 'Escape' && cropActive) toggleCrop();
  });

  document.addEventListener('click', (e) => {
    if (!(e.target instanceof Element) || !e.target.closest('#colorPicker')) setColorPaletteOpen(false);
    if (!(e.target instanceof Element) || !e.target.closest('#fillColorPicker')) setFillPaletteOpen(false);
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
  destroyDrawManager();
  const settings = await loadSettings();

  let result = await getResult(captureId);
  if (!result) {
    // Headless compositing did not run; composite from persisted params here.
    const params = await storageGet<CompositeParams>(`composite:${captureId}`);
    if (params) {
      showOverlay(t('stitchingCapture', undefined, 'Stitching capture…'));
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

  // Offer a review once the user has captured enough times (local-only gate).
  void maybeMountReviewWidget().catch(() => undefined);
}

async function init(): Promise<void> {
  localizeDocument();
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
