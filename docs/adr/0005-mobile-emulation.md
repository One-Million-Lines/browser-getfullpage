# ADR 0005 — Mobile capture via device emulation

## Status

Accepted.

## Context

Users want to capture the **mobile version** of a page, not just what their desktop renders. A faithful
mobile screenshot must switch the page into its responsive/mobile layout: narrow CSS viewport width,
mobile device‑pixel‑ratio, touch, and a mobile user‑agent. Content scripts cannot change the viewport
width that CSS media queries key off, and resizing the real browser window is clamped to a platform
minimum (~500 px) and is disruptive.

## Options considered

1. **Resize/open a mobile‑sized window** — no special permission, but Chrome clamps window width so
   true phone widths (~390 px) are unreachable, and it cannot set a mobile UA or high DPR.
2. **`chrome.debugger` + `Emulation` protocol** — the same mechanism DevTools device mode uses:
   `setDeviceMetricsOverride` (width/height/DPR/mobile), `setTouchEmulationEnabled`, and
   `setUserAgentOverride`. Faithful, but Chromium‑only and requires the `debugger` permission.

## Decision

Use the **debugger `Emulation`** approach (option 2), integrated into the existing scroll‑and‑stitch
engine rather than replacing it:

- `background/emulation.ts` `MobileEmulator` attaches the debugger, applies device metrics + touch +
  user‑agent for the selected `DeviceProfile`, and captures each viewport with `Page.captureScreenshot`
  (which reflects the emulation) instead of `tabs.captureVisibleTab`.
- Emulation is applied **before** the content script measures, so measurement, planning, fixed/sticky
  handling, lazy‑scroll, stitching, preview, and export are all reused unchanged and simply operate on
  the mobile viewport.
- The emulator is **detached and all overrides cleared in `finally`**, so the user's tab is restored
  exactly (verified by the e2e: `window.innerWidth` returns to desktop after capture). The page is
  **not reloaded**, which keeps restoration exact at the cost of not switching server‑side UA‑sniffed
  HTML (documented in known limitations).
- The `debugger` permission is **optional and Chromium‑only** (`optional_permissions` on the Chromium
  manifest, absent on Firefox/Safari). It is requested at runtime from a user gesture — the Settings
  toggle or the preview's "Capture as mobile" button — never held by default.

Exposure: a Settings default (`mobileEmulation` + `mobileDevice`) and a one‑click preview toggle. The
result records the device so the preview shows a "📱 device" pill and can re‑capture as desktop.

## Consequences

- Faithful phone‑width, high‑DPR, mobile‑UA screenshots on Chromium, verified end‑to‑end (a responsive
  fixture renders its mobile breakpoint, image width = 390×3 = 1170 px).
- Chromium‑only; Firefox/Safari hide the feature (no `debugger`/`Emulation` API).
- Requires the target tab to have no other debugger client (DevTools closed); surfaced as a friendly
  `MOBILE_UNAVAILABLE` error.
