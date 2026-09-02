import { ext } from '@/platform/browser';
import type { CaptureStartMessage } from '@/shared/messages';

const LOG = '[GFP popup]';

async function capture(mode: 'full' | 'viewport'): Promise<void> {
  let resolvedTabId: number | undefined;
  try {
    // Query the active tab here, in the popup's window context, where
    // currentWindow is unambiguously the browser window that owns this popup.
    const tabs = await ext.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];

    if (!tab?.id) {
      console.error(LOG, 'no active tab found — cannot start capture (tabs:', tabs.length, ')');
      return;
    }

    resolvedTabId = tab.id;
    console.log(LOG, 'starting', mode, 'capture — tabId:', resolvedTabId);

    const msg: CaptureStartMessage = { type: 'CAPTURE_START', tabId: resolvedTabId, mode };
    await ext.runtime.sendMessage(msg);
    console.log(LOG, 'CAPTURE_START sent successfully');
  } catch (err) {
    console.error(LOG, 'error starting', mode, 'capture (tabId:', resolvedTabId, '):', err);
  } finally {
    window.close();
  }
}

const fullBtn = document.getElementById('btnFullPage') as HTMLButtonElement | null;
const vpBtn = document.getElementById('btnViewport') as HTMLButtonElement | null;

if (fullBtn) {
  fullBtn.onclick = () => void capture('full');
} else {
  console.error(LOG, 'btnFullPage not found in popup DOM — check popup.html');
}

if (vpBtn) {
  vpBtn.onclick = () => void capture('viewport');
} else {
  console.error(LOG, 'btnViewport not found in popup DOM — check popup.html');
}

console.log(LOG, 'popup ready');
