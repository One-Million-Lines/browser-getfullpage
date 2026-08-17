import type { CaptureErrorCode } from '@/shared/errors';

/** URLs the browser refuses to inject into or blanks on capture (spec §8). */
const RESTRICTED_SCHEMES = [
  'chrome:',
  'chrome-untrusted:',
  'chrome-extension:',
  'moz-extension:',
  'safari-web-extension:',
  'edge:',
  'about:',
  'view-source:',
  'devtools:',
  'data:',
  'javascript:',
];

const RESTRICTED_HOSTS = [
  'chrome.google.com', // legacy web store
  'chromewebstore.google.com',
  'addons.mozilla.org',
  'microsoftedge.microsoft.com',
];

export interface UrlCheck {
  ok: boolean;
  code?: CaptureErrorCode;
}

export function isCapturableUrl(url: string | undefined): UrlCheck {
  if (!url) return { ok: false, code: 'RESTRICTED_URL' };
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, code: 'RESTRICTED_URL' };
  }

  const scheme = parsed.protocol.toLowerCase();
  if (RESTRICTED_SCHEMES.includes(scheme)) return { ok: false, code: 'RESTRICTED_URL' };

  // Browser store pages block content-script injection.
  if (
    (scheme === 'https:' || scheme === 'http:') &&
    RESTRICTED_HOSTS.some((h) => parsed.hostname === h || parsed.hostname.endsWith(`.${h}`))
  ) {
    if (parsed.pathname.includes('webstore') || parsed.hostname.startsWith('chromewebstore') ||
      parsed.hostname.includes('addons') || parsed.pathname.includes('addons')) {
      return { ok: false, code: 'RESTRICTED_URL' };
    }
  }

  // file:// works only when the user grants file access; attempt and surface a
  // friendly error if injection fails.
  return { ok: true };
}

/** Cheap document identity token to detect navigation mid-capture (spec §5.1). */
export function documentToken(url: string, docHeight = 0): string {
  return `${url}#${Math.round(docHeight)}`;
}
