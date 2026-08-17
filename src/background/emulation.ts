import { ext } from '@/platform/browser';
import { CaptureError } from '@/shared/errors';
import type { DeviceProfile } from '@/shared/devices';

/**
 * Mobile device emulation via the Chromium `debugger` protocol (spec addition:
 * "capture as mobile"). We override device metrics (viewport width/height,
 * device pixel ratio, mobile flag), enable touch, and set a mobile user-agent,
 * then capture each viewport with `Page.captureScreenshot` so the screenshot
 * reflects the emulated mobile layout. Everything is cleared and detached on
 * completion, so the user's tab is restored (spec §5.4 cleanup guarantee).
 *
 * Chromium only: `chrome.debugger` does not exist on Firefox/Safari.
 */

const PROTOCOL_VERSION = '1.3';

interface Debuggee {
  tabId: number;
}
interface DebuggerApi {
  attach(target: Debuggee, version: string, cb: () => void): void;
  detach(target: Debuggee, cb: () => void): void;
  sendCommand(target: Debuggee, method: string, params: object, cb: (result?: unknown) => void): void;
}

function dbg(): DebuggerApi | undefined {
  return (ext as unknown as { debugger?: DebuggerApi }).debugger;
}

/** True on Chromium builds where the debugger protocol is available. */
export function hasDebuggerApi(): boolean {
  return typeof dbg() !== 'undefined';
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function lastErrorMessage(): string | undefined {
  const err = (ext.runtime as unknown as { lastError?: { message?: string } }).lastError;
  return err?.message;
}

export class MobileEmulator {
  private target: Debuggee;
  private attached = false;

  constructor(
    tabId: number,
    private profile: DeviceProfile,
  ) {
    this.target = { tabId };
  }

  private send<T = unknown>(method: string, params: object = {}): Promise<T> {
    const api = dbg();
    if (!api) return Promise.reject(new CaptureError('MOBILE_UNAVAILABLE', 'debugger API unavailable'));
    return new Promise<T>((resolve, reject) => {
      api.sendCommand(this.target, method, params, (result) => {
        const msg = lastErrorMessage();
        if (msg) reject(new CaptureError('MOBILE_UNAVAILABLE', `${method}: ${msg}`));
        else resolve(result as T);
      });
    });
  }

  async attach(): Promise<void> {
    const api = dbg();
    if (!api) throw new CaptureError('MOBILE_UNAVAILABLE', 'debugger API unavailable');
    await new Promise<void>((resolve, reject) => {
      api.attach(this.target, PROTOCOL_VERSION, () => {
        const msg = lastErrorMessage();
        if (msg) reject(new CaptureError('MOBILE_UNAVAILABLE', msg));
        else resolve();
      });
    });
    this.attached = true;

    await this.send('Page.enable');
    await this.send('Emulation.setDeviceMetricsOverride', {
      width: this.profile.width,
      height: this.profile.height,
      deviceScaleFactor: this.profile.dpr,
      mobile: true,
      screenWidth: this.profile.width,
      screenHeight: this.profile.height,
    });
    try {
      await this.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    } catch {
      /* touch emulation is best-effort */
    }
    try {
      await this.send('Emulation.setUserAgentOverride', { userAgent: this.profile.userAgent });
    } catch {
      /* UA override is best-effort */
    }
    // Allow the page to reflow into the emulated viewport before measuring.
    await delay(350);
  }

  /** Capture the current (emulated) viewport as a PNG data URL. */
  async captureViewport(): Promise<string> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await this.send<{ data: string }>('Page.captureScreenshot', { format: 'png' });
        if (res?.data) return `data:image/png;base64,${res.data}`;
      } catch (e) {
        lastError = e;
        await delay(180 * (attempt + 1));
      }
    }
    throw new CaptureError(
      'CAPTURE_API_FAILED',
      lastError instanceof Error ? lastError.message : String(lastError),
      true,
    );
  }

  async detach(): Promise<void> {
    if (!this.attached) return;
    this.attached = false;
    const api = dbg();
    if (!api) return;
    try {
      await this.send('Emulation.clearDeviceMetricsOverride');
    } catch {
      /* ignore */
    }
    try {
      await this.send('Emulation.setTouchEmulationEnabled', { enabled: false });
    } catch {
      /* ignore */
    }
    try {
      await this.send('Emulation.setUserAgentOverride', { userAgent: '' });
    } catch {
      /* ignore */
    }
    await new Promise<void>((resolve) => {
      api.detach(this.target, () => {
        void lastErrorMessage();
        resolve();
      });
    });
  }
}
