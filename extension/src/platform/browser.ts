/**
 * Cross-browser WebExtension adapter. Chrome/Edge expose `chrome` with MV3
 * promise support; Firefox and Safari expose `browser`. A single promise-based
 * root works for all three. Browser-specific behaviour is isolated behind the
 * small typed helpers in this module (spec §6.4, §6.5, §7).
 */

type AnyApi = typeof chrome & { runtime: typeof chrome.runtime };

const root: AnyApi =
  ((globalThis as unknown as { browser?: AnyApi }).browser as AnyApi) ??
  (globalThis as unknown as { chrome: AnyApi }).chrome;

export const ext = root;

/** True on Chromium builds where chrome.offscreen exists. */
export function hasOffscreen(): boolean {
  return typeof (root as unknown as { offscreen?: unknown }).offscreen !== 'undefined';
}

/** True when the current background context has DOM/canvas (Firefox event page). */
export function backgroundHasDom(): boolean {
  return typeof document !== 'undefined' && typeof document.createElement === 'function';
}

export function isFirefox(): boolean {
  return typeof (globalThis as unknown as { browser?: unknown }).browser !== 'undefined' && !hasOffscreen();
}

export function runtimeUrl(path: string): string {
  return root.runtime.getURL(path);
}

/* ------------------------------- tabs helpers ------------------------------ */

export async function queryActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  const tabs = await root.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

export async function getTab(tabId: number): Promise<chrome.tabs.Tab | undefined> {
  try {
    return await root.tabs.get(tabId);
  } catch {
    return undefined;
  }
}

export async function captureVisibleTab(windowId: number): Promise<string> {
  return root.tabs.captureVisibleTab(windowId, { format: 'png' });
}

export async function focusTab(tabId: number, windowId: number): Promise<void> {
  try {
    await root.windows.update(windowId, { focused: true });
    await root.tabs.update(tabId, { active: true });
  } catch {
    /* best effort */
  }
}

export async function createTab(url: string): Promise<chrome.tabs.Tab> {
  return root.tabs.create({ url });
}

/* ----------------------------- scripting helper ---------------------------- */

export async function injectFile(tabId: number, file: string): Promise<void> {
  await root.scripting.executeScript({ target: { tabId }, files: [file] });
}

/* ------------------------------ storage.local ------------------------------ */

export async function storageGet<T>(key: string): Promise<T | undefined> {
  const obj = await root.storage.local.get(key);
  return obj[key] as T | undefined;
}

export async function storageSet(key: string, value: unknown): Promise<void> {
  await root.storage.local.set({ [key]: value });
}

export async function storageRemove(key: string): Promise<void> {
  await root.storage.local.remove(key);
}
