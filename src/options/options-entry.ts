import { loadSettings, resetSettings, saveSettings } from '@/platform/settings-store';
import { requestDownloadsPermission } from '@/platform/downloads';
import { requestPermissions } from '@/platform/permissions';
import { hasOffscreen } from '@/platform/browser';
import { DEVICE_PROFILES } from '@/shared/devices';
import { hostFromUrl, renderFilename } from '@/shared/filename';
import { DEFAULT_SETTINGS } from '@/shared/settings';
import type { FixedHandling, ImageFormat, PostCaptureBehavior, SettleDelaySetting, Settings } from '@/shared/types';
import type { PdfMargin, PdfOrientation } from '@/shared/types';
import type { PdfPaperName } from '@/shared/constants';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const controls = {
  defaultFormat: $<HTMLSelectElement>('defaultFormat'),
  jpegQuality: $<HTMLInputElement>('jpegQuality'),
  jpegQualityVal: $('jpegQualityVal'),
  postCapture: $<HTMLSelectElement>('postCapture'),
  filenameTemplate: $<HTMLInputElement>('filenameTemplate'),
  filenamePreview: $('filenamePreview'),
  downloadSubfolder: $<HTMLInputElement>('downloadSubfolder'),
  downloadsPermHint: $('downloadsPermHint'),
  settleDelay: $<HTMLSelectElement>('settleDelay'),
  freezeAnimations: $<HTMLInputElement>('freezeAnimations'),
  fixedHandling: $<HTMLSelectElement>('fixedHandling'),
  maxPageHeightPx: $<HTMLInputElement>('maxPageHeightPx'),
  maxSlices: $<HTMLInputElement>('maxSlices'),
  memoryCeilingMiB: $<HTMLInputElement>('memoryCeilingMiB'),
  pdfPaper: $<HTMLSelectElement>('pdfPaper'),
  pdfOrientation: $<HTMLSelectElement>('pdfOrientation'),
  pdfMargin: $<HTMLSelectElement>('pdfMargin'),
  pdfSmartBreaks: $<HTMLInputElement>('pdfSmartBreaks'),
  pdfFooter: $<HTMLInputElement>('pdfFooter'),
  mobileEmulation: $<HTMLInputElement>('mobileEmulation'),
  mobileDevice: $<HTMLSelectElement>('mobileDevice'),
  mobileSection: $('mobileSection'),
  mobilePermHint: $('mobilePermHint'),
  enableEditor: $<HTMLInputElement>('enableEditor'),
  enableHistory: $<HTMLInputElement>('enableHistory'),
  resetBtn: $<HTMLButtonElement>('resetBtn'),
  saved: $('saved'),
};

let settings: Settings = { ...DEFAULT_SETTINGS };

function flashSaved(): void {
  controls.saved.hidden = false;
  controls.saved.style.opacity = '1';
  window.clearTimeout((flashSaved as unknown as { t?: number }).t);
  (flashSaved as unknown as { t?: number }).t = window.setTimeout(() => {
    controls.saved.style.opacity = '0';
  }, 1200);
}

function updateFilenamePreview(): void {
  const ext = settings.defaultFormat === 'jpeg' ? 'jpg' : 'png';
  controls.filenamePreview.textContent = renderFilename(
    controls.filenameTemplate.value,
    { title: 'Example Page', host: hostFromUrl('https://example.com/pricing'), date: new Date(), width: 1280, height: 3400 },
    ext,
  );
}

function render(): void {
  controls.defaultFormat.value = settings.defaultFormat;
  controls.jpegQuality.value = String(settings.jpegQuality);
  controls.jpegQualityVal.textContent = `${Math.round(settings.jpegQuality * 100)}%`;
  controls.postCapture.value = settings.postCapture;
  controls.filenameTemplate.value = settings.filenameTemplate;
  controls.downloadSubfolder.value = settings.downloadSubfolder;
  controls.settleDelay.value = String(settings.settleDelay);
  controls.freezeAnimations.checked = settings.freezeAnimations;
  controls.fixedHandling.value = settings.fixedHandling;
  controls.maxPageHeightPx.value = String(settings.maxPageHeightPx);
  controls.maxSlices.value = String(settings.maxSlices);
  controls.memoryCeilingMiB.value = String(Math.round(settings.memoryCeilingBytes / (1024 * 1024)));
  controls.pdfPaper.value = settings.pdf.paper;
  controls.pdfOrientation.value = settings.pdf.orientation;
  controls.pdfMargin.value = settings.pdf.margin;
  controls.pdfSmartBreaks.checked = settings.pdf.smartBreaks;
  controls.pdfFooter.checked = settings.pdf.footer;
  controls.mobileEmulation.checked = settings.mobileEmulation;
  controls.mobileDevice.value = settings.mobileDevice;
  controls.enableEditor.checked = settings.enableEditor;
  controls.enableHistory.checked = settings.enableHistory;
  controls.downloadsPermHint.hidden = !(settings.postCapture === 'download' || settings.downloadSubfolder);
  updateFilenamePreview();
}

async function persist(): Promise<void> {
  await saveSettings(settings);
  flashSaved();
}

function collect(): void {
  settings.defaultFormat = controls.defaultFormat.value as ImageFormat;
  settings.jpegQuality = Number(controls.jpegQuality.value);
  settings.postCapture = controls.postCapture.value as PostCaptureBehavior;
  settings.filenameTemplate = controls.filenameTemplate.value.trim() || DEFAULT_SETTINGS.filenameTemplate;
  settings.downloadSubfolder = controls.downloadSubfolder.value.trim();
  const settle = controls.settleDelay.value;
  settings.settleDelay = (settle === 'auto' ? 'auto' : Number(settle)) as SettleDelaySetting;
  settings.freezeAnimations = controls.freezeAnimations.checked;
  settings.fixedHandling = controls.fixedHandling.value as FixedHandling;
  settings.maxPageHeightPx = Number(controls.maxPageHeightPx.value);
  settings.maxSlices = Number(controls.maxSlices.value);
  settings.memoryCeilingBytes = Number(controls.memoryCeilingMiB.value) * 1024 * 1024;
  settings.pdf.paper = controls.pdfPaper.value as PdfPaperName;
  settings.pdf.orientation = controls.pdfOrientation.value as PdfOrientation;
  settings.pdf.margin = controls.pdfMargin.value as PdfMargin;
  settings.pdf.smartBreaks = controls.pdfSmartBreaks.checked;
  settings.pdf.footer = controls.pdfFooter.checked;
  settings.mobileEmulation = controls.mobileEmulation.checked;
  settings.mobileDevice = controls.mobileDevice.value;
  settings.enableEditor = controls.enableEditor.checked;
  settings.enableHistory = controls.enableHistory.checked;
}

/** When auto-download or a subfolder is enabled, request the optional permission. */
async function maybeRequestDownloads(): Promise<void> {
  const needs = settings.postCapture === 'download' || settings.downloadSubfolder !== '';
  if (!needs) return;
  const granted = await requestDownloadsPermission();
  if (!granted && settings.postCapture === 'download') {
    settings.postCapture = 'preview';
    render();
    await persist();
  }
}

function wire(): void {
  const onChange = async (requestPerms = false) => {
    collect();
    if (requestPerms) await maybeRequestDownloads();
    render();
    await persist();
  };

  for (const elId of [
    'defaultFormat',
    'jpegQuality',
    'settleDelay',
    'freezeAnimations',
    'fixedHandling',
    'maxPageHeightPx',
    'maxSlices',
    'memoryCeilingMiB',
    'pdfPaper',
    'pdfOrientation',
    'pdfMargin',
    'pdfSmartBreaks',
    'pdfFooter',
    'mobileDevice',
    'enableEditor',
    'enableHistory',
    'filenameTemplate',
  ]) {
    const node = document.getElementById(elId) as HTMLElement;
    node.addEventListener('input', () => void onChange(false));
    node.addEventListener('change', () => void onChange(false));
  }

  // Permission-triggering controls request on change (a user gesture).
  controls.postCapture.addEventListener('change', () => void onChange(true));
  controls.downloadSubfolder.addEventListener('change', () => void onChange(true));

  // Mobile emulation requests the optional debugger permission when enabled.
  controls.mobileEmulation.addEventListener('change', async () => {
    collect();
    if (settings.mobileEmulation) {
      const granted = await requestPermissions(['debugger']);
      if (!granted) settings.mobileEmulation = false;
    }
    render();
    await persist();
  });

  controls.resetBtn.addEventListener('click', async () => {
    settings = await resetSettings();
    render();
    flashSaved();
  });
}

function populateDevices(): void {
  controls.mobileDevice.innerHTML = '';
  for (const d of DEVICE_PROFILES) {
    const opt = document.createElement('option');
    opt.value = d.key;
    opt.textContent = d.label;
    controls.mobileDevice.appendChild(opt);
  }
}

function gateMobile(): void {
  // Mobile emulation relies on the Chromium debugger protocol.
  const supported = hasOffscreen();
  if (!supported) {
    controls.mobileEmulation.checked = false;
    controls.mobileEmulation.disabled = true;
    controls.mobileDevice.disabled = true;
    controls.mobilePermHint.textContent =
      'Mobile capture is available on Chromium-based browsers (Chrome, Edge, Brave, Opera, Vivaldi, Arc).';
  }
}

async function init(): Promise<void> {
  settings = await loadSettings();
  populateDevices();
  render();
  gateMobile();
  wire();
}

void init();
