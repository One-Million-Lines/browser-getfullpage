/**
 * Local, privacy-preserving review prompt.
 *
 * A usage counter is incremented locally on each successful capture. Once it
 * reaches a threshold, a self-contained rating widget is shown (once). Choosing
 * 4–5 stars opens the Chrome Web Store review page; 1–3 stars reveals a comment
 * box whose contents are posted to the same feedback endpoint as the Settings
 * feedback form, tagged with the star count. Nothing is tracked remotely and no
 * prompt is shown until the user has actually used the extension.
 */

import { storageGet, storageSet } from '@/platform/browser';
import { REVIEW } from '@/config/product';
import { RELEASE_VERSION } from '@/config/product';

const USAGE_KEY = 'review:usageCount';
const STATE_KEY = 'review:state';

type ReviewState = 'pending' | 'dismissed' | 'done';

/** Increment the local usage counter and return the new total. */
export async function recordUsage(): Promise<number> {
  const current = (await storageGet<number>(USAGE_KEY)) ?? 0;
  const next = current + 1;
  await storageSet(USAGE_KEY, next);
  return next;
}

async function getState(): Promise<ReviewState> {
  return (await storageGet<ReviewState>(STATE_KEY)) ?? 'pending';
}

/** True when the user has used the extension enough and hasn't yet responded. */
export async function shouldPromptForReview(): Promise<boolean> {
  if ((await getState()) !== 'pending') return false;
  const uses = (await storageGet<number>(USAGE_KEY)) ?? 0;
  return uses >= REVIEW.promptAfterUses;
}

async function setState(state: ReviewState): Promise<void> {
  await storageSet(STATE_KEY, state);
}

/** POST a rating (and optional comment) to the shared feedback endpoint. */
async function submitRating(stars: number, comment: string): Promise<void> {
  await fetch(REVIEW.feedbackEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      extension: REVIEW.extensionId,
      version: RELEASE_VERSION,
      type: 'review',
      stars,
      description: comment,
      timestamp: new Date().toISOString(),
    }),
  });
}

const WIDGET_ID = 'gfp-review-widget';

/**
 * Mount the review widget into the current document if the usage threshold has
 * been reached. Safe to call on every preview load; it no-ops otherwise.
 */
export async function maybeMountReviewWidget(): Promise<void> {
  if (!(await shouldPromptForReview())) return;
  if (document.getElementById(WIDGET_ID)) return;
  mountReviewWidget();
}

function mountReviewWidget(): void {
  const host = document.createElement('div');
  host.id = WIDGET_ID;
  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = CSS;
  shadow.appendChild(style);

  const card = document.createElement('div');
  card.className = 'card';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', 'Leave a review');
  card.innerHTML = TEMPLATE;
  shadow.appendChild(card);
  document.body.appendChild(host);

  const close = () => {
    host.remove();
  };
  const dismiss = () => {
    void setState('dismissed');
    close();
  };

  card.querySelector<HTMLButtonElement>('.close')?.addEventListener('click', dismiss);

  const lowSection = card.querySelector<HTMLDivElement>('.low')!;
  const thanks = card.querySelector<HTMLDivElement>('.thanks')!;
  const starsRow = card.querySelector<HTMLDivElement>('.stars')!;
  const comment = card.querySelector<HTMLTextAreaElement>('.comment')!;
  const submitBtn = card.querySelector<HTMLButtonElement>('.submit')!;
  const intro = card.querySelector<HTMLParagraphElement>('.q')!;
  let chosen = 0;

  const paintStars = (upTo: number) => {
    starsRow.querySelectorAll<HTMLButtonElement>('.star').forEach((btn, i) => {
      btn.classList.toggle('on', i < upTo);
    });
  };

  starsRow.querySelectorAll<HTMLButtonElement>('.star').forEach((btn, i) => {
    const value = i + 1;
    btn.addEventListener('mouseenter', () => paintStars(value));
    btn.addEventListener('mouseleave', () => paintStars(chosen));
    btn.addEventListener('click', () => {
      chosen = value;
      paintStars(value);
      if (value >= 4) {
        // Happy path: send them straight to the store review page.
        void setState('done');
        window.open(REVIEW.chromeStoreReviewUrl, '_blank', 'noopener');
        close();
      } else {
        // Unhappy path: collect a private comment for the feedback endpoint.
        intro.textContent = 'Sorry to hear that — what could we improve?';
        lowSection.hidden = false;
        comment.focus();
      }
    });
  });

  submitBtn.addEventListener('click', () => {
    submitBtn.disabled = true;
    void submitRating(chosen, comment.value.trim())
      .catch(() => undefined)
      .finally(() => {
        void setState('done');
        lowSection.hidden = true;
        starsRow.hidden = true;
        intro.hidden = true;
        thanks.hidden = false;
        setTimeout(close, 2200);
      });
  });
}

const TEMPLATE = `
  <button class="close" type="button" aria-label="Dismiss">×</button>
  <p class="q">Enjoying GetFullPage? Rate your experience</p>
  <div class="stars" role="radiogroup" aria-label="Rating">
    <button class="star" type="button" aria-label="1 star">★</button>
    <button class="star" type="button" aria-label="2 stars">★</button>
    <button class="star" type="button" aria-label="3 stars">★</button>
    <button class="star" type="button" aria-label="4 stars">★</button>
    <button class="star" type="button" aria-label="5 stars">★</button>
  </div>
  <div class="low" hidden>
    <textarea class="comment" rows="3" placeholder="Tell us how we can improve…" maxlength="2000"></textarea>
    <button class="submit" type="button">Send feedback</button>
  </div>
  <div class="thanks" hidden>Thanks for helping us improve! 🙌</div>
`;

const CSS = `
  :host { all: initial; }
  .card {
    position: fixed; z-index: 2147483647; right: 20px; bottom: 20px;
    width: 320px; max-width: calc(100vw - 40px);
    font: 14px/1.45 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    color: #e5e7eb; background: #131a2c;
    border: 1px solid rgba(255,255,255,0.1); border-radius: 14px;
    padding: 16px 18px; box-shadow: 0 18px 50px rgba(0,0,0,0.45);
  }
  .close {
    position: absolute; top: 8px; right: 10px; cursor: pointer;
    background: none; border: none; color: #94a3b8; font-size: 18px; line-height: 1;
    padding: 2px 6px; border-radius: 6px;
  }
  .close:hover { background: rgba(255,255,255,0.08); color: #fff; }
  .q { margin: 2px 24px 12px 0; font-weight: 600; }
  .stars { display: flex; gap: 4px; }
  .star {
    cursor: pointer; background: none; border: none; padding: 2px;
    font-size: 28px; line-height: 1; color: #3b4763; transition: color .12s ease;
  }
  .star:hover, .star.on { color: #fbbf24; }
  .low { margin-top: 12px; }
  .comment {
    width: 100%; box-sizing: border-box; resize: vertical;
    background: #1b2438; color: #e5e7eb; border: 1px solid rgba(255,255,255,0.12);
    border-radius: 8px; padding: 8px 10px; font: inherit; min-height: 64px;
  }
  .comment:focus { outline: 2px solid #4ade80; outline-offset: 1px; }
  .submit {
    margin-top: 8px; cursor: pointer; font: inherit; font-weight: 600;
    background: #16a34a; color: #fff; border: none; border-radius: 8px; padding: 8px 14px;
  }
  .submit:hover { background: #15803d; }
  .submit:disabled { opacity: 0.6; cursor: default; }
  .thanks { margin-top: 4px; color: #4ade80; font-weight: 600; }
`;
