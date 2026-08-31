import { ext, hasOffscreen, runtimeUrl } from './browser';

/**
 * Offscreen document lifecycle (Chromium only). The service worker has no DOM
 * and can be terminated, so compositing runs in an offscreen document with
 * canvas access (spec §5.6). Firefox/Safari lack this API and composite in a
 * context that already has a DOM; callers feature-detect with hasOffscreen().
 */

const OFFSCREEN_URL = 'offscreen.html';

interface OffscreenApi {
  createDocument(opts: {
    url: string;
    reasons: string[];
    justification: string;
  }): Promise<void>;
  closeDocument(): Promise<void>;
  hasDocument?(): Promise<boolean>;
}

function offscreenApi(): OffscreenApi | undefined {
  return (ext as unknown as { offscreen?: OffscreenApi }).offscreen;
}

interface RuntimeWithContexts {
  getContexts?(filter: { contextTypes: string[]; documentUrls?: string[] }): Promise<unknown[]>;
}

let creating: Promise<void> | null = null;

async function documentExists(): Promise<boolean> {
  const runtime = ext.runtime as unknown as RuntimeWithContexts;
  if (typeof runtime.getContexts === 'function') {
    try {
      const contexts = await runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT'],
        documentUrls: [runtimeUrl(OFFSCREEN_URL)],
      });
      return contexts.length > 0;
    } catch {
      /* fall through */
    }
  }
  const api = offscreenApi();
  if (api?.hasDocument) {
    try {
      return await api.hasDocument();
    } catch {
      return false;
    }
  }
  return false;
}

/** Ensure exactly one offscreen document exists. No-op where unsupported. */
export async function ensureOffscreen(): Promise<boolean> {
  if (!hasOffscreen()) return false;
  const api = offscreenApi();
  if (!api) return false;

  if (await documentExists()) return true;
  if (creating) {
    await creating;
    return true;
  }
  creating = api
    .createDocument({
      url: OFFSCREEN_URL,
      reasons: ['BLOBS'],
      justification: 'Composite captured page slices into a single image using canvas off the worker.',
    })
    .catch(async (e) => {
      // Another context may have created it in a race; tolerate that.
      if (await documentExists()) return;
      throw e;
    })
    .finally(() => {
      creating = null;
    });
  await creating;
  return true;
}

export async function closeOffscreen(): Promise<void> {
  const api = offscreenApi();
  if (!api) return;
  try {
    if (await documentExists()) await api.closeDocument();
  } catch {
    /* best effort */
  }
}
