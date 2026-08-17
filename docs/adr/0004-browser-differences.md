# ADR 0004 — Browser differences behind typed adapters

## Status

Accepted.

## Context

Chromium, Firefox, and Safari differ in background model, the offscreen API, and the API namespace.
The spec forbids weakening permissions for all browsers to simplify one, and requires a typed platform
adapter with documented differences.

## Decision

Isolate every difference behind small typed adapters in `src/platform/` and a generated per‑target
manifest. Shared capture/editor/export code is namespace‑ and host‑agnostic.

| Concern | Chromium | Firefox | Safari |
|---|---|---|---|
| API namespace | `chrome.*` (MV3 promises) | `browser.*` promises | `browser.*` promises |
| Background | service worker (no DOM) | non‑persistent **event page** (has DOM) | service worker‑like |
| Compositing host | **offscreen document** (`offscreen` perm) | **background page DOM** | **preview page** (offscreen not available) |
| Manifest background key | `service_worker` | `background.scripts` | `service_worker` |
| Extra permission | `offscreen` | — | — |
| Store identity | — | `browser_specific_settings.gecko` | Xcode bundle id / entitlements |

Implementation details:

- `platform/browser.ts` resolves the API root (`browser ?? chrome`) and exposes `hasOffscreen()` and
  `backgroundHasDom()` feature detections.
- `finalize()` in the service worker picks the compositing host: offscreen on Chromium; the background
  DOM on Firefox; and, as a universal fallback, the **preview page composites from persisted params**
  so the default flow works even where headless compositing is unavailable.
- Slices and results live in a shared **IndexedDB**, accessible from the worker, offscreen document,
  and preview alike.
- Manifests are generated from `src/config/manifest.ts`; there is no hand‑edited per‑browser manifest
  to drift.

## Consequences

- One codebase, three packages, no permission dilution.
- The default "open preview" path is the most portable and is the primary verified flow; offscreen and
  background‑DOM compositing are optimisations for headless auto‑download.
- New platform quirks are added as adapters/feature‑detects, not as `if (chrome)` scattered through the
  capture logic.
