/** Scroll-root detection and page measurement (spec §5.2). */

export type ScrollRoot =
  | { kind: 'window'; el: HTMLElement }
  | { kind: 'element'; el: HTMLElement };

function isScrollable(el: Element): boolean {
  const style = getComputedStyle(el);
  const oy = style.overflowY;
  return (oy === 'auto' || oy === 'scroll' || oy === 'overlay') && el.scrollHeight > el.clientHeight + 4;
}

/**
 * Determine the primary scroll root. Prefer the document scrolling element; when
 * the document itself cannot scroll (app-style layouts with an inner scroll
 * container and body overflow:hidden), pick the largest scrollable descendant.
 */
export function detectScrollRoot(): ScrollRoot {
  const scrollingEl = (document.scrollingElement as HTMLElement) || document.documentElement;
  const docCanScroll = scrollingEl.scrollHeight > scrollingEl.clientHeight + 4;
  if (docCanScroll) return { kind: 'window', el: scrollingEl };

  // Search for the tallest scrollable container.
  let best: HTMLElement | null = null;
  let bestArea = 0;
  const all = document.body ? document.body.querySelectorAll<HTMLElement>('*') : [];
  for (const el of all) {
    if (!isScrollable(el)) continue;
    const rect = el.getBoundingClientRect();
    const area = rect.width * rect.height;
    if (area > bestArea && rect.width > window.innerWidth * 0.5) {
      best = el;
      bestArea = area;
    }
  }
  if (best) return { kind: 'element', el: best };
  return { kind: 'window', el: scrollingEl };
}

export function getScrollPos(root: ScrollRoot): { x: number; y: number } {
  if (root.kind === 'window') {
    return { x: window.scrollX, y: window.scrollY };
  }
  return { x: root.el.scrollLeft, y: root.el.scrollTop };
}

export function setScrollPos(root: ScrollRoot, x: number, y: number): void {
  if (root.kind === 'window') {
    window.scrollTo(x, y);
  } else {
    root.el.scrollLeft = x;
    root.el.scrollTop = y;
  }
}

export interface Measured {
  docWidth: number;
  docHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  devicePixelRatio: number;
}

const maxOf = (...n: number[]) => Math.max(...n.filter((v) => Number.isFinite(v) && v > 0), 0);

/** Measure document/viewport dimensions using the maximum reliable values. */
export function measure(root: ScrollRoot): Measured {
  const de = document.documentElement;
  const body = document.body;

  const viewportWidth = de.clientWidth || window.innerWidth;
  const viewportHeight = window.innerHeight || de.clientHeight;

  let docWidth: number;
  let docHeight: number;
  if (root.kind === 'element') {
    docWidth = maxOf(root.el.scrollWidth, viewportWidth);
    docHeight = maxOf(root.el.scrollHeight, viewportHeight);
  } else {
    docWidth = maxOf(
      de.scrollWidth,
      de.offsetWidth,
      de.clientWidth,
      body ? body.scrollWidth : 0,
      body ? body.offsetWidth : 0,
      viewportWidth,
    );
    docHeight = maxOf(
      de.scrollHeight,
      de.offsetHeight,
      de.clientHeight,
      body ? body.scrollHeight : 0,
      body ? body.offsetHeight : 0,
      viewportHeight,
    );
  }

  return {
    docWidth,
    docHeight,
    viewportWidth,
    viewportHeight,
    devicePixelRatio: window.devicePixelRatio || 1,
  };
}
