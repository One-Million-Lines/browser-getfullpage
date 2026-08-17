import { CAPTURE_PORT, DEFAULT_SETTLE_DELAY_MS } from '@/shared/constants';
import type {
  BeforeShotArgs,
  ContentEvent,
  ProgressArgs,
  RpcRequest,
  RpcResponse,
  ScrollToArgs,
  ScrollToResult,
} from '@/shared/messages';
import type { FixedHandling, PageMeasurement, SettleDelaySetting } from '@/shared/types';
import { detectScrollRoot, getScrollPos, measure, setScrollPos, type ScrollRoot } from './measure';
import { scrollToStable } from './scroller';
import { collectFixedCandidates, hideRepeatedFixed, restoreFixed, type FixedCandidate } from './fixed';
import { freezePage, unfreezePage } from './freeze';
import { destroyOverlay, hideOverlay, setProgress, showOverlay, unhideOverlay } from './overlay';

interface PrepareArgs {
  freezeAnimations: boolean;
  fixedHandling: FixedHandling;
  settleDelay: SettleDelaySetting;
}

interface Ctx {
  root: ScrollRoot;
  candidates: FixedCandidate[];
  originalX: number;
  originalY: number;
  settleMs: number;
  fixedHandling: FixedHandling;
  active: boolean;
}

type WindowWithGuard = Window & { __getfullpageTeardown?: () => void };

function resolveSettle(setting: SettleDelaySetting): number {
  return setting === 'auto' ? DEFAULT_SETTLE_DELAY_MS : setting;
}

(function main() {
  const w = window as WindowWithGuard;
  // A previous capture may have left a controller; tear it down first.
  try {
    w.__getfullpageTeardown?.();
  } catch {
    /* ignore */
  }

  const port = chrome.runtime.connect({ name: CAPTURE_PORT });
  let ctx: Ctx | null = null;

  const send = (msg: RpcResponse | ContentEvent) => {
    try {
      port.postMessage(msg);
    } catch {
      /* port closed */
    }
  };

  function cleanup(): void {
    if (ctx) {
      restoreFixed(ctx.candidates);
      setScrollPos(ctx.root, ctx.originalX, ctx.originalY);
      ctx.active = false;
    }
    unfreezePage();
    destroyOverlay();
    ctx = null;
  }

  w.__getfullpageTeardown = () => {
    cleanup();
    try {
      port.disconnect();
    } catch {
      /* ignore */
    }
  };

  function prepare(args: PrepareArgs): PageMeasurement {
    freezePage(args.freezeAnimations);
    showOverlay('Preparing capture…', () => send({ event: 'cancel' }));

    const root = detectScrollRoot();
    const start = getScrollPos(root);
    const candidates = args.fixedHandling === 'keep-all' ? [] : collectFixedCandidates();
    const m = measure(root);

    ctx = {
      root,
      candidates,
      originalX: start.x,
      originalY: start.y,
      settleMs: resolveSettle(args.settleDelay),
      fixedHandling: args.fixedHandling,
      active: true,
    };

    return {
      docWidth: m.docWidth,
      docHeight: m.docHeight,
      viewportWidth: m.viewportWidth,
      viewportHeight: m.viewportHeight,
      originalScrollX: start.x,
      originalScrollY: start.y,
      devicePixelRatio: m.devicePixelRatio,
      zoom: 1,
      usesScrollContainer: root.kind === 'element',
      fixedCount: candidates.length,
    };
  }

  async function scrollTo(args: ScrollToArgs): Promise<ScrollToResult> {
    if (!ctx) throw new Error('not prepared');
    const pos = await scrollToStable(ctx.root, args.scrollY, ctx.settleMs);
    const m = measure(ctx.root);
    return {
      actualScrollX: pos.x,
      actualScrollY: pos.y,
      viewportWidth: m.viewportWidth,
      viewportHeight: m.viewportHeight,
      devicePixelRatio: m.devicePixelRatio,
      docHeight: m.docHeight,
      docWidth: m.docWidth,
    };
  }

  function beforeShot(args: BeforeShotArgs): void {
    if (!ctx) return;
    if (!args.isFirst && ctx.fixedHandling === 'hide-repeated') {
      hideRepeatedFixed(ctx.candidates, window.innerWidth, window.innerHeight);
    }
    hideOverlay();
  }

  function afterShot(): void {
    if (!ctx) return;
    unhideOverlay();
    restoreFixed(ctx.candidates);
  }

  async function dispatch(req: RpcRequest): Promise<unknown> {
    switch (req.cmd) {
      case 'prepare':
        return prepare(req.args as PrepareArgs);
      case 'scrollTo':
        return scrollTo(req.args as ScrollToArgs);
      case 'beforeShot':
        beforeShot(req.args as BeforeShotArgs);
        return {};
      case 'afterShot':
        afterShot();
        return {};
      case 'progress': {
        const a = req.args as ProgressArgs;
        setProgress(a.current, a.total, a.message);
        return {};
      }
      case 'cleanup':
        cleanup();
        return {};
      default:
        throw new Error(`unknown command: ${String(req.cmd)}`);
    }
  }

  port.onMessage.addListener((raw: RpcRequest) => {
    void (async () => {
      try {
        const result = await dispatch(raw);
        send({ id: raw.id, ok: true, result });
      } catch (e) {
        send({
          id: raw.id,
          ok: false,
          error: { code: 'INTERNAL', detail: e instanceof Error ? e.message : String(e) },
        });
      }
    })();
  });

  port.onDisconnect.addListener(() => {
    // Service worker restarted or capture ended abnormally: always restore.
    cleanup();
    w.__getfullpageTeardown = undefined;
  });

  send({ event: 'ready' });
})();
