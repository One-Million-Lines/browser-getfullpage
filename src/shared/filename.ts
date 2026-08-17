import { MAX_FILENAME_BASE } from './constants';

export interface FilenameTokens {
  title: string;
  host: string;
  /** Date object of capture; formatting is local time. */
  date: Date;
  width: number;
  height: number;
}

/** Characters invalid across Windows/macOS/Linux filesystems. */
const INVALID_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g;

/** Reserved Windows device names. */
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

function pad(n: number, len = 2): string {
  return String(n).padStart(len, '0');
}

export function formatDate(d: Date): string {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

export function formatTime(d: Date): string {
  return `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/** Extract a filesystem-safe host label from a URL. */
export function hostFromUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname || 'page';
  } catch {
    return 'page';
  }
}

/** Collapse whitespace and strip characters unsafe in a path segment. */
export function sanitizeSegment(input: string): string {
  const cleaned = (input ?? '')
    .replace(INVALID_CHARS, ' ')
    .replace(/[.\s]+$/g, '') // no trailing dots/spaces
    .replace(/^[.\s]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return 'page';
  if (RESERVED.test(cleaned)) return `_${cleaned}`;
  return cleaned;
}

/**
 * Render a filename template with tokens, sanitise it, and cap the base length.
 * Tokens: {title} {host} {date} {time} {width} {height}
 */
export function renderFilename(template: string, tokens: FilenameTokens, ext: string): string {
  const map: Record<string, string> = {
    title: sanitizeSegment(tokens.title || tokens.host),
    host: sanitizeSegment(tokens.host),
    date: formatDate(tokens.date),
    time: formatTime(tokens.date),
    width: String(Math.round(tokens.width)),
    height: String(Math.round(tokens.height)),
  };

  const rendered = (template || 'getfullpage-{host}-{date}-{time}').replace(
    /\{(title|host|date|time|width|height)\}/g,
    (_, key: string) => map[key] ?? '',
  );

  let base = sanitizeSegment(rendered).replace(/\s+/g, '-');
  if (!base) base = 'getfullpage';
  if (base.length > MAX_FILENAME_BASE) base = base.slice(0, MAX_FILENAME_BASE).replace(/[-.\s]+$/, '');
  const cleanExt = ext.replace(/^\.+/, '').toLowerCase();
  return `${base}.${cleanExt}`;
}

/**
 * Sanitise a Downloads subfolder path: forward slashes only, no traversal, no
 * leading/trailing slash. Each segment is individually sanitised.
 */
export function sanitizeSubfolder(input: string): string {
  if (!input) return '';
  return input
    .replace(/\\/g, '/')
    .split('/')
    .map((s) => s.trim())
    .filter((s) => s && s !== '.' && s !== '..')
    .map((s) => sanitizeSegment(s))
    .join('/');
}
