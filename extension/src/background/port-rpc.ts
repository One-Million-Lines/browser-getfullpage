import type {
  ContentCommand,
  ContentEvent,
  PortMessageFromContent,
  RpcResponse,
} from '@/shared/messages';
import { isRpcResponse } from '@/shared/messages';
import { CaptureError } from '@/shared/errors';

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Background-side RPC over the long-lived capture Port. Correlates requests with
 * responses by id, surfaces unsolicited content events (cancel/ready), and
 * rejects everything if the port disconnects — which is exactly what happens if
 * the MV3 service worker is torn down (spec §5.1).
 */
export class PortRpc {
  private port: chrome.runtime.Port;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private disposed = false;

  constructor(
    port: chrome.runtime.Port,
    private handlers: { onEvent?: (e: ContentEvent) => void; onDisconnect?: () => void },
  ) {
    this.port = port;
    port.onMessage.addListener((msg: PortMessageFromContent) => this.onMessage(msg));
    port.onDisconnect.addListener(() => this.onDisconnect());
  }

  private onMessage(msg: PortMessageFromContent): void {
    if (isRpcResponse(msg)) {
      const res = msg as RpcResponse;
      const p = this.pending.get(res.id);
      if (!p) return;
      clearTimeout(p.timer);
      this.pending.delete(res.id);
      if (res.ok) p.resolve(res.result);
      else p.reject(new CaptureError(res.error?.code ?? 'INTERNAL', res.error?.detail));
    } else {
      this.handlers.onEvent?.(msg as ContentEvent);
    }
  }

  private onDisconnect(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new CaptureError('TAB_CHANGED', 'capture port disconnected'));
    }
    this.pending.clear();
    this.handlers.onDisconnect?.();
  }

  request<T>(cmd: ContentCommand, args?: unknown, timeoutMs = 25000): Promise<T> {
    if (this.disposed) return Promise.reject(new CaptureError('TAB_CHANGED', 'port closed'));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new CaptureError('INTERNAL', `content did not respond to "${cmd}"`));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      try {
        this.port.postMessage({ id, cmd, args });
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new CaptureError('TAB_CHANGED', e instanceof Error ? e.message : String(e)));
      }
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new CaptureError('CANCELLED'));
    }
    this.pending.clear();
    try {
      this.port.disconnect();
    } catch {
      /* ignore */
    }
  }
}
