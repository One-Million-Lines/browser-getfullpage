/**
 * In-page capture overlay rendered in a shadow root so page CSS cannot affect
 * it. Shows preparation/progress state with a live region and a Cancel button,
 * and is hidden immediately before each screenshot so it never appears in the
 * captured image (spec §5.3, §9 accessibility).
 */

import { t } from '@/shared/i18n';

const HOST_ID = 'getfullpage-overlay-host';

let host: HTMLDivElement | null = null;
let statusEl: HTMLDivElement | null = null;
let barEl: HTMLDivElement | null = null;
let onCancel: (() => void) | null = null;

const CSS = `
:host { all: initial; }
.wrap {
  position: fixed; z-index: 2147483647; top: 16px; left: 50%;
  transform: translateX(-50%);
  font: 500 13px/1.4 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  color: #f8fafc; background: rgba(17, 24, 39, 0.94);
  border: 1px solid rgba(255,255,255,0.12); border-radius: 12px;
  padding: 12px 14px; box-shadow: 0 8px 30px rgba(0,0,0,0.35);
  display: flex; align-items: center; gap: 12px; min-width: 240px;
  backdrop-filter: blur(4px);
}
.dot { width: 10px; height: 10px; border-radius: 50%; background: #6366f1; flex: none;
  box-shadow: 0 0 0 4px rgba(99,102,241,0.25); animation: pulse 1.1s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) { .dot { animation: none; } }
@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.35; } }
.col { display: flex; flex-direction: column; gap: 6px; flex: 1; }
.status { white-space: nowrap; }
.track { height: 4px; border-radius: 999px; background: rgba(255,255,255,0.15); overflow: hidden; }
.bar { height: 100%; width: 0%; background: #6366f1; transition: width .2s ease; }
button {
  all: unset; cursor: pointer; color: #cbd5e1; font-size: 12px; padding: 4px 8px;
  border-radius: 8px; border: 1px solid rgba(255,255,255,0.18);
}
button:hover, button:focus-visible { background: rgba(255,255,255,0.1); color: #fff; outline: 2px solid #818cf8; }
`;

export function showOverlay(message: string, cancel: () => void): void {
  onCancel = cancel;
  if (host) {
    setStatus(message);
    host.style.display = '';
    return;
  }
  host = document.createElement('div');
  host.id = HOST_ID;
  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = CSS;
  shadow.appendChild(style);

  const wrap = document.createElement('div');
  wrap.className = 'wrap';
  wrap.setAttribute('role', 'status');
  wrap.setAttribute('aria-live', 'polite');

  const dot = document.createElement('div');
  dot.className = 'dot';

  const col = document.createElement('div');
  col.className = 'col';
  statusEl = document.createElement('div');
  statusEl.className = 'status';
  statusEl.textContent = message;
  const track = document.createElement('div');
  track.className = 'track';
  barEl = document.createElement('div');
  barEl.className = 'bar';
  track.appendChild(barEl);
  col.append(statusEl, track);

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = t('cancelButton', undefined, 'Cancel');
  btn.setAttribute('aria-label', t('cancelCaptureAria', undefined, 'Cancel capture'));
  btn.addEventListener('click', () => onCancel?.());

  wrap.append(dot, col, btn);
  shadow.appendChild(wrap);
  (document.body || document.documentElement).appendChild(host);
}

export function setStatus(message: string): void {
  if (statusEl) statusEl.textContent = message;
}

export function setProgress(current: number, total: number, message?: string): void {
  if (barEl && total > 0) barEl.style.width = `${Math.round((current / total) * 100)}%`;
  if (message) setStatus(message);
  else if (total > 0) {
    setStatus(t('capturingProgress', [String(current), String(total)], `Capturing ${current} of ${total}…`));
  }
}

/** Hide without destroying, so it can be restored after a screenshot. */
export function hideOverlay(): void {
  if (host) host.style.display = 'none';
}

export function unhideOverlay(): void {
  if (host) host.style.display = '';
}

export function destroyOverlay(): void {
  host?.remove();
  host = null;
  statusEl = null;
  barEl = null;
  onCancel = null;
}
