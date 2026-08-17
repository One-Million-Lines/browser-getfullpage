# ADR 0001 — Capture strategy: scroll‑and‑stitch

## Status

Accepted.

## Context

Full‑page capture is not a single native call in Chromium. The available primitive,
`tabs.captureVisibleTab`, captures **only the visible viewport** of the active tab. To capture
everything below the fold we must scroll the page, capture each viewport, and compose the frames.

## Decision

Implement a coordinated **scroll‑and‑stitch** pipeline:

1. The **background coordinator** (`background/session.ts`) runs a state machine:
   `idle → preparing → measuring → capturing → stitching → ready`, with `cancelled`/`failed` terminal
   paths and cleanup guaranteed in `finally`.
2. An injected **content script** measures the page, detects the scroll root, and for each planned Y
   position: scrolls, waits two animation frames, polls until the scroll position stabilises, allows a
   settle delay for lazy content, hides the overlay, and (on later slices) hides repeated fixed/sticky
   elements. All mutations are restored exactly afterward.
3. The coordinator calls `captureVisibleTab` per viewport (throttled, with bounded exponential
   backoff), and writes each slice to **IndexedDB** immediately so a service‑worker restart cannot
   lose progress.
4. The **compositor** decodes slices with `createImageBitmap` and draws them onto a canvas at
   physical‑pixel resolution using **measured** scale factors (`bitmapHeight / viewportHeightCss`),
   not assumptions. Consecutive slices overlap by 1–2 CSS px so rounding never produces seams; the
   last slice is cropped to the remaining document height.
5. A long‑lived **runtime Port** between content and background keeps coordination alive under MV3;
   if it disconnects, the page is restored and the capture aborts cleanly.

Planning, geometry, overlap/crop, and de‑duplication are **pure functions** (`capture/plan.ts`,
`capture/geometry.ts`) and are unit‑tested.

## Consequences

- Correct capture on real pages, verified by an automated real‑Chromium pixel test.
- De‑duplication is based on **scroll position** (a failed scroll), never pixel content — content‑hash
  de‑dup was rejected because distinct all‑white viewports would be wrongly skipped, leaving gaps.
- The approach is browser‑agnostic; only the capture API and compositing host differ per platform
  (see ADR 0004).
