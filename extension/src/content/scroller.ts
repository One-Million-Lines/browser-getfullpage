import {
  SCROLL_STABILISE_TIMEOUT_MS,
  STABILISE_POLL_MS,
} from '@/shared/constants';
import { getScrollPos, setScrollPos, type ScrollRoot } from './measure';

const raf = () =>
  new Promise<void>((resolve) => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
    else setTimeout(resolve, 16);
  });

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Scroll to a Y position and wait until the position stabilises (spec §5.3):
 * request scroll, wait two animation frames, then poll until the scroll offset
 * stops changing or a timeout elapses. Returns the actual position reached.
 */
export async function scrollToStable(
  root: ScrollRoot,
  targetY: number,
  settleMs: number,
): Promise<{ x: number; y: number }> {
  setScrollPos(root, 0, targetY);
  await raf();
  await raf();

  let last = getScrollPos(root).y;
  const start = Date.now();
  // Poll for stability: two identical reads in a row means settled.
  for (;;) {
    await delay(STABILISE_POLL_MS);
    const now = getScrollPos(root).y;
    if (Math.abs(now - last) < 1) break;
    last = now;
    if (Date.now() - start > SCROLL_STABILISE_TIMEOUT_MS) break;
  }

  // Allow lazy-loaded/rendered content to settle before the screenshot.
  if (settleMs > 0) await delay(settleMs);

  return getScrollPos(root);
}
