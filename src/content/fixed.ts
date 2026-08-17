import { shouldHideFixed } from '@/capture/fixed-classify';

export interface FixedCandidate {
  el: HTMLElement;
  /** Original `style` attribute so inline styles restore byte-for-byte (spec §5.4). */
  originalStyleAttr: string | null;
  hidden: boolean;
}

/** Collect fixed/sticky elements once, before capture starts. */
export function collectFixedCandidates(): FixedCandidate[] {
  const out: FixedCandidate[] = [];
  const root = document.body || document.documentElement;
  const nodes = root.querySelectorAll<HTMLElement>('*');
  for (const el of nodes) {
    const pos = getComputedStyle(el).position;
    if (pos === 'fixed' || pos === 'sticky') {
      out.push({ el, originalStyleAttr: el.getAttribute('style'), hidden: false });
    }
  }
  return out;
}

/**
 * Hide fixed/sticky elements that would repeat on this slice. Uses
 * visibility:hidden (not display:none) so layout does not reflow. Called before
 * every non-first screenshot; restoreFixed() reverses it after the screenshot.
 */
export function hideRepeatedFixed(
  candidates: FixedCandidate[],
  viewportW: number,
  viewportH: number,
): void {
  for (const c of candidates) {
    const rect = c.el.getBoundingClientRect();
    if (shouldHideFixed(rect, viewportW, viewportH)) {
      c.el.style.setProperty('visibility', 'hidden', 'important');
      c.hidden = true;
    }
  }
}

/** Restore every candidate's exact original inline style. */
export function restoreFixed(candidates: FixedCandidate[]): void {
  for (const c of candidates) {
    if (!c.hidden) continue;
    if (c.originalStyleAttr === null) c.el.removeAttribute('style');
    else c.el.setAttribute('style', c.originalStyleAttr);
    c.hidden = false;
  }
}
