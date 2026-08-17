import {
  GECKO_ID,
  MINIMUM_CHROME_VERSION,
  MINIMUM_FIREFOX_VERSION,
  PRODUCT,
  RELEASE_VERSION,
  type BuildTarget,
} from './product';

/**
 * Generates the Manifest V3 document per build target.
 *
 * Permission strategy (spec §6): only `activeTab`, `scripting`, and `storage`
 * are required. `downloads` is optional and requested at runtime when the user
 * enables auto-download or a Downloads subfolder. No host_permissions, no
 * static content scripts, no `tabs`, no `<all_urls>`.
 */

export interface ManifestReport {
  target: BuildTarget;
  version: string;
  permissions: string[];
  optionalPermissions: string[];
  hostPermissions: string[];
  rationale: Record<string, string>;
}

const ICONS = {
  '16': 'icons/icon-16.png',
  '32': 'icons/icon-32.png',
  '48': 'icons/icon-48.png',
  '128': 'icons/icon-128.png',
};

/** Minimum required permissions that map 1:1 to implemented functionality. */
const REQUIRED_PERMISSIONS = ['activeTab', 'scripting', 'storage'];

/** `offscreen` is Chromium-only and required to composite off the service worker. */
const CHROMIUM_PERMISSIONS = [...REQUIRED_PERMISSIONS, 'offscreen'];

/** Optional, requested at runtime only when a feature needs them. */
const OPTIONAL_PERMISSIONS = ['downloads'];

/** `debugger` powers mobile device emulation; Chromium-only, requested at runtime. */
const CHROMIUM_OPTIONAL_PERMISSIONS = [...OPTIONAL_PERMISSIONS, 'debugger'];

const PERMISSION_RATIONALE: Record<string, string> = {
  activeTab:
    'Temporarily access and capture only the tab on which the user explicitly invokes GetFullPage. No permanent access to every site.',
  scripting:
    'Inject the capture controller and temporary CSS after the user gesture. Used only on the active tab; no static all-URLs content script.',
  storage: 'Save local preferences and transient capture metadata. Local only; never synced or transmitted.',
  offscreen:
    'Chromium only: composite captured slices with canvas access off the service worker, which cannot use the DOM and may be terminated.',
  downloads:
    'Optional. Requested at runtime only when the user enables auto-download or a Downloads subfolder. Manual export uses a user-gesture download and needs no permission.',
  debugger:
    'Optional, Chromium only. Requested at runtime only when the user chooses "capture as mobile"; used solely to emulate a mobile viewport/user-agent locally during capture, then detached.',
};

export function buildManifest(target: BuildTarget = 'chrome'): Record<string, unknown> {
  const isFirefox = target === 'firefox';
  const permissions = isFirefox ? REQUIRED_PERMISSIONS : CHROMIUM_PERMISSIONS;
  // `debugger` (mobile emulation) is Chromium-only; Firefox/Safari omit it.
  const optionalPermissions = target === 'chrome' ? CHROMIUM_OPTIONAL_PERMISSIONS : OPTIONAL_PERMISSIONS;

  const manifest: Record<string, unknown> = {
    manifest_version: 3,
    name: PRODUCT.name,
    short_name: PRODUCT.shortName,
    version: RELEASE_VERSION,
    description: trimDescription(PRODUCT.description, 132),
    homepage_url: PRODUCT.homepage,
    icons: ICONS,
    permissions,
    optional_permissions: optionalPermissions,
    action: {
      default_title: 'Capture full page (GetFullPage)',
      default_icon: ICONS,
    },
    options_ui: {
      page: 'options/options.html',
      open_in_tab: true,
    },
    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'self'",
    },
    web_accessible_resources: [
      {
        resources: ['preview/preview.html', 'icons/*'],
        matches: ['<all_urls>'],
      },
    ],
    commands: {
      'capture-full-page': {
        suggested_key: { default: 'Alt+Shift+P', mac: 'Command+Shift+P' },
        description: 'Capture the full page',
      },
      'capture-viewport': {
        description: 'Capture the visible viewport only',
      },
    },
  };

  if (isFirefox) {
    // Firefox MV3 uses an event page (with DOM) rather than a service worker.
    manifest.background = { scripts: ['service-worker.js'], type: 'module' };
    manifest.browser_specific_settings = {
      gecko: { id: GECKO_ID, strict_min_version: MINIMUM_FIREFOX_VERSION },
    };
  } else {
    manifest.minimum_chrome_version = MINIMUM_CHROME_VERSION;
    manifest.background = { service_worker: 'service-worker.js', type: 'module' };
  }

  return manifest;
}

export function manifestReport(target: BuildTarget = 'chrome'): ManifestReport {
  const m = buildManifest(target) as Record<string, string[]>;
  return {
    target,
    version: RELEASE_VERSION,
    permissions: m.permissions,
    optionalPermissions: m.optional_permissions,
    hostPermissions: [],
    rationale: PERMISSION_RATIONALE,
  };
}

/** Chrome caps the manifest description at 132 chars; trim on a word boundary. */
function trimDescription(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > max - 24 ? cut.slice(0, lastSpace) : cut).replace(/[\s—–-]+$/, '') + '…';
}
