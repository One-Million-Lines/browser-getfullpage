/**
 * Temporarily freezes CSS animations/transitions and forces instant scrolling so
 * programmatic scrolls are deterministic (spec §5.5). Media playback is left
 * untouched by default. Every injected style is removed on cleanup.
 */

const STYLE_ID = 'getfullpage-freeze-style';

export function freezePage(freezeAnimations: boolean): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  const rules: string[] = [
    // Force instant, programmatic scrolling regardless of scroll-behavior:smooth.
    'html, body, * { scroll-behavior: auto !important; }',
    // Hide scrollbars so they are not captured and the layout width is stable.
    'html { scrollbar-width: none !important; }',
    '::-webkit-scrollbar { display: none !important; width: 0 !important; height: 0 !important; }',
  ];
  if (freezeAnimations) {
    rules.push(
      '*, *::before, *::after {' +
        ' animation-play-state: paused !important;' +
        ' animation-delay: 0s !important;' +
        ' transition: none !important;' +
        ' caret-color: transparent !important;' +
        ' }',
    );
  }
  style.textContent = rules.join('\n');
  (document.head || document.documentElement).appendChild(style);
}

export function unfreezePage(): void {
  document.getElementById(STYLE_ID)?.remove();
}
