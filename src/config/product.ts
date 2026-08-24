/** Product identity and release metadata. Manifests are generated, not hand-edited. */

export const RELEASE_VERSION = '1.1.1';

/** Baseline that reliably supports MV3 service workers + offscreen documents. */
export const MINIMUM_CHROME_VERSION = '116';

/** Firefox baseline with modern captureVisibleTab + MV3 event-page behaviour. */
export const MINIMUM_FIREFOX_VERSION = '126.0';

export const GECKO_ID = 'getfullpage@onemillionlines.com';

export const PRODUCT = {
  name: 'GetFullPage — Full Page Screenshot',
  shortName: 'GetFullPage',
  /** Chrome caps the manifest description at 132 chars. */
  description:
    'Capture an entire webpage as one image or PDF. One click, one complete page, nothing uploaded. 100% local, no account.',
  homepage: 'https://onemillionlines.com',
} as const;

export type BuildTarget = 'chrome' | 'firefox' | 'safari';
