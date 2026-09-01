import { injectFile } from '@/platform/browser';
import { putSlice, setMarker } from '@/platform/idb';
import { decodeBitmap } from '@/capture/canvas';
import { maybeExtendPlan, planCapture, type PlanOptions } from '@/capture/plan';
import { captureVisible } from './capture-visible';
import { PortRpc } from './port-rpc';
import { CaptureError, isCaptureError } from '@/shared/errors';
import type {
  BeforeShotArgs,
  ProgressArgs,
  ScrollToArgs,
  ScrollToResult,
} from '@/shared/messages';
import type {
  CaptureMode,
  CaptureProgress,
  CaptureState,
  CaptureTarget,
  CapturePlan,
  PageMeasurement,
  Settings,
} from '@/shared/types';

export interface RunResult {
  captureId: string;
  mode: CaptureMode;
  url: string;
  title: string;
  plan: CapturePlan;
  measurement: PageMeasurement;
}

export interface SessionDeps {
  target: CaptureTarget;
  title: string;
  mode: CaptureMode;
  settings: Settings;
  onProgress: (p: CaptureProgress) => void;
}

/**
 * Drives a single capture through the state machine
 * idle → preparing → measuring → capturing → stitching → ready, with cancelled
 * and failed terminal paths and guaranteed cleanup in finally (spec §5.1).
 */
export class CaptureSession {
  readonly captureId: string;
  private state: CaptureState = 'idle';
  private cancelled = false;
  private cancelReason: CaptureError | null = null;
  private rpc: PortRpc | null = null;
  private portResolver: ((port: chrome.runtime.Port) => void) | null = null;
  private portPromise: Promise<chrome.runtime.Port>;

  constructor(private deps: SessionDeps) {
    this.captureId = deps.target.captureId;
    this.portPromise = new Promise((resolve) => (this.portResolver = resolve));
  }

  /** Called by the service worker when the content port connects. */
  attachPort(port: chrome.runtime.Port): void {
    this.portResolver?.(port);
  }

  isCancelled = (): boolean => this.cancelled;

  cancel(reason?: CaptureError): void {
    if (this.cancelled) return;
    this.cancelled = true;
    this.cancelReason = reason ?? new CaptureError('CANCELLED');
    this.rpc?.dispose();
  }

  private setState(state: CaptureState): void {
    this.state = state;
    this.deps.onProgress({
      captureId: this.captureId,
      state,
      current: 0,
      total: this.plan?.slices.length ?? 0,
    });
  }

  private plan: CapturePlan | null = null;

  async run(): Promise<RunResult> {
    const { target, settings, mode } = this.deps;
    try {
      await setMarker(this.captureId);

      /* ---------------------------- preparing ---------------------------- */
      this.setState('preparing');
      await injectFile(target.tabId, 'content.js');
      const port = await this.waitForPort(8000);
      if (this.cancelled) throw this.cancelReason;
      this.rpc = new PortRpc(port, {
        onEvent: (e) => {
          if (e.event === 'cancel') this.cancel(new CaptureError('CANCELLED'));
        },
        onDisconnect: () => {
          if (this.state !== 'stitching' && this.state !== 'ready') {
            this.cancel(new CaptureError('TAB_CHANGED', 'content disconnected'));
          }
        },
      });

      /* ---------------------------- measuring ---------------------------- */
      this.setState('measuring');
      const measurement = await this.rpc.request<PageMeasurement>('prepare', {
        freezeAnimations: settings.freezeAnimations,
        fixedHandling: settings.fixedHandling,
        settleDelay: settings.settleDelay,
      });
      this.throwIfCancelled();

      const planOpts: PlanOptions = {
        maxPageHeightPx: settings.maxPageHeightPx,
        maxSlices: settings.maxSlices,
        mode: mode === 'viewport' ? 'viewport' : 'full',
      };
      this.plan = planCapture(measurement, planOpts);

      /* ---------------------------- capturing ---------------------------- */
      this.setState('capturing');
      let firstDims: { w: number; h: number } | null = null;

      for (let i = 0; i < this.plan.slices.length; i++) {
        this.throwIfCancelled();
        const slice = this.plan.slices[i];
        const total = this.plan.slices.length;

        const scrolled = await this.rpc.request<ScrollToResult>('scrollTo', {
          scrollY: slice.scrollY,
        } satisfies ScrollToArgs);
        this.throwIfCancelled();

        // Extend for lazy growth only near the end and within safety limits.
        if (i === this.plan.slices.length - 1 && planOpts.mode !== 'viewport') {
          this.plan = maybeExtendPlan(this.plan, scrolled.docHeight, planOpts);
        }

        await this.rpc.request('beforeShot', {
          index: i,
          total,
          isFirst: i === 0,
        } satisfies BeforeShotArgs);

        let dataUrl: string;
        try {
          dataUrl = await captureVisible(target.windowId, this.isCancelled);
        } finally {
          await this.rpc.request('afterShot').catch(() => undefined);
        }
        this.throwIfCancelled();

        if (!firstDims) {
          const bmp = await decodeBitmap(dataUrl);
          firstDims = { w: bmp.width, h: bmp.height };
          bmp.close?.();
        }

        await putSlice({
          captureId: this.captureId,
          index: i,
          dataUrl,
          scrollX: scrolled.actualScrollX,
          scrollY: scrolled.actualScrollY,
          bitmapWidth: firstDims.w,
          bitmapHeight: firstDims.h,
          scale: measurement.devicePixelRatio,
        });

        const current = i + 1;
        this.deps.onProgress({
          captureId: this.captureId,
          state: 'capturing',
          current,
          total: this.plan.slices.length,
        });
        await this.rpc
          .request('progress', {
            current,
            total: this.plan.slices.length,
          } satisfies ProgressArgs)
          .catch(() => undefined);
      }

      /* ---------------------------- stitching ---------------------------- */
      this.setState('stitching');
      await this.rpc.request('cleanup').catch(() => undefined);
      this.rpc.dispose();
      this.rpc = null;

      this.setState('ready');
      return {
        captureId: this.captureId,
        mode,
        url: target.url,
        title: this.deps.title,
        plan: this.plan,
        measurement,
      };
    } catch (e) {
      const err = this.cancelled ? this.cancelReason ?? new CaptureError('CANCELLED') : toErr(e);
      this.state = this.cancelled ? 'cancelled' : 'failed';
      // Guaranteed cleanup: restore the page and drop the port.
      try {
        await this.rpc?.request('cleanup');
      } catch {
        /* the tab may be gone; nothing else to restore */
      }
      this.rpc?.dispose();
      this.rpc = null;
      throw err;
    } finally {
      await setMarker(null);
    }
  }

  private throwIfCancelled(): void {
    if (this.cancelled) throw this.cancelReason ?? new CaptureError('CANCELLED');
  }

  private async waitForPort(timeoutMs: number): Promise<chrome.runtime.Port> {
    return Promise.race([
      this.portPromise,
      new Promise<chrome.runtime.Port>((_, reject) =>
        setTimeout(
          () => reject(new CaptureError('INTERNAL', 'content script did not connect')),
          timeoutMs,
        ),
      ),
    ]);
  }
}

function toErr(e: unknown): CaptureError {
  return isCaptureError(e) ? e : new CaptureError('INTERNAL', e instanceof Error ? e.message : String(e));
}
