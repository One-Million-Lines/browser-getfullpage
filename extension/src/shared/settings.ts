import {
  DEFAULT_MAX_PAGE_HEIGHT_PX,
  DEFAULT_MAX_SLICES,
  DEFAULT_MEMORY_CEILING_BYTES,
  JPEG_DEFAULT_QUALITY,
  JPEG_MAX_QUALITY,
  JPEG_MIN_QUALITY,
} from './constants';
import type { Settings } from './types';

export const SETTINGS_SCHEMA_VERSION = 1;

export const DEFAULT_SETTINGS: Settings = {
  schemaVersion: SETTINGS_SCHEMA_VERSION,
  defaultFormat: 'png',
  jpegQuality: JPEG_DEFAULT_QUALITY,
  postCapture: 'preview',
  filenameTemplate: 'getfullpage-{host}-{date}-{time}',
  downloadSubfolder: '',
  settleDelay: 'auto',
  freezeAnimations: true,
  fixedHandling: 'hide-repeated',
  maxPageHeightPx: DEFAULT_MAX_PAGE_HEIGHT_PX,
  maxSlices: DEFAULT_MAX_SLICES,
  memoryCeilingBytes: DEFAULT_MEMORY_CEILING_BYTES,
  pdf: {
    paper: 'a4',
    orientation: 'auto',
    margin: 'normal',
    customMarginPt: 24,
    smartBreaks: true,
    footer: false,
  },
  enableEditor: true,
  enableHistory: false,
  historyLimit: 20,
};

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

/** Coerce arbitrary stored data into a valid Settings object. */
export function normalizeSettings(raw: unknown): Settings {
  const base = { ...DEFAULT_SETTINGS };
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Partial<Settings> & Record<string, unknown>;

  const out: Settings = {
    ...base,
    ...r,
    jpegQuality: clamp(Number(r.jpegQuality ?? base.jpegQuality), JPEG_MIN_QUALITY, JPEG_MAX_QUALITY),
    maxPageHeightPx: clamp(Number(r.maxPageHeightPx ?? base.maxPageHeightPx), 2000, 200000),
    maxSlices: clamp(Number(r.maxSlices ?? base.maxSlices), 4, 2000),
    memoryCeilingBytes: clamp(
      Number(r.memoryCeilingBytes ?? base.memoryCeilingBytes),
      64 * 1024 * 1024,
      4096 * 1024 * 1024,
    ),
    pdf: { ...base.pdf, ...(r.pdf as object) },
    schemaVersion: SETTINGS_SCHEMA_VERSION,
  };

  if (out.defaultFormat !== 'png' && out.defaultFormat !== 'jpeg') out.defaultFormat = 'png';
  if (out.postCapture !== 'preview' && out.postCapture !== 'download') out.postCapture = 'preview';
  return out;
}

/**
 * Apply forward-only migrations. New versions add a case; older stored data is
 * upgraded field-by-field without losing user choices.
 */
export function migrateSettings(raw: unknown): Settings {
  const data = (raw && typeof raw === 'object' ? { ...(raw as object) } : {}) as Record<string, unknown>;
  let version = typeof data.schemaVersion === 'number' ? data.schemaVersion : 0;

  // v0 -> v1: introduce structured pdf defaults + memory ceiling.
  if (version < 1) {
    if (typeof data.pdf !== 'object') data.pdf = { ...DEFAULT_SETTINGS.pdf };
    if (typeof data.memoryCeilingBytes !== 'number') {
      data.memoryCeilingBytes = DEFAULT_SETTINGS.memoryCeilingBytes;
    }
    version = 1;
  }

  data.schemaVersion = version;
  return normalizeSettings(data);
}
