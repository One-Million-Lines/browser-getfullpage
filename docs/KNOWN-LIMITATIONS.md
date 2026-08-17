# Known limitations

GetFullPage prioritises capture correctness, guaranteed cleanup, memory safety, privacy, and minimal
permissions. The following are known, intentional limitations for v1.

## Capture

- **Layout‑viewport width only.** v1 captures the page at the layout‑viewport width. Content that
  overflows horizontally beyond the viewport is not tiled left‑to‑right (this would multiply memory
  and complexity). Horizontal tiling is a candidate for a future release behind a setting.
- **Infinite scroll is bounded.** Pages that keep growing are captured up to the configured maximum
  height / slice count and the result is clearly **labelled as truncated**. GetFullPage never loops
  indefinitely.
- **Cross‑origin iframes / DRM / protected surfaces.** Regions the browser blanks or refuses to
  capture (cross‑origin iframes it protects, DRM video, WebGL/canvas under certain policies) are
  captured as the browser renders them to the visible tab — GetFullPage cannot reveal what the
  browser hides.
- **Restricted pages.** Browser system pages (`chrome://`, `edge://`, `about:`), extension pages,
  view‑source, and the browser stores cannot be injected into and fail with a friendly message.
- **`file://` pages** require the browser’s “Allow access to file URLs” to be enabled for the
  extension; otherwise capture fails with an actionable message.
- **Substantial mid‑capture mutation / navigation** aborts the capture and restores the page rather
  than presenting a partial image as complete.

## Huge images

- **Single‑canvas bound + optional downscale.** The composited master image is bounded to a safe
  canvas size and the memory ceiling. If a page is so large that it cannot fit, the image is
  **downscaled** and the applied scale is shown (never silent). PDF export renders **page‑by‑page**
  and does not require a single giant canvas.
- Full internal tiling of the master representation (to avoid any downscale on extreme pages) is
  designed for but not yet enabled by default.

## Editor (P1)

- The annotation editor (arrow, rectangle, ellipse, freehand, text, highlight, blur/pixelate,
  numbered marker), undo/redo, and object selection are behind the **`enableEditor` feature flag** and
  are not part of the P0 release surface. Crop and rotate are available now.
- Local capture **history** is behind the `enableHistory` flag.

## Mobile capture

- **Chromium only.** Mobile emulation uses the `debugger` (`Emulation`) protocol, which does not exist
  on Firefox or Safari. The "capture as mobile" toggle is disabled there.
- **Client‑side responsive layout is emulated, not server‑side.** GetFullPage overrides the viewport
  width, device‑pixel‑ratio, touch, and user‑agent, so CSS media queries and viewport‑based layout
  switch to mobile. It does **not** reload the page, so sites that serve entirely different HTML based
  on the request user‑agent (server‑side UA sniffing) may still return their desktop document. Not
  reloading is a deliberate choice so your tab is restored exactly after capture.
- **Close DevTools first.** Only one debugger client can attach to a tab, so mobile capture fails with
  a friendly message if DevTools is open on the target page.
- While attached, the browser shows an informational "GetFullPage started debugging this browser"
  banner; the extension detaches as soon as the capture completes.

## Platform

- **Chromium is the fully verified target** (see the automated e2e capture test). Firefox and Safari
  share the same capture/editor/export code through typed adapters; validate `activeTab` capture,
  clipboard, downloads, and background/memory behaviour on those platforms before release.
- Auto‑download requires the optional `downloads` permission; if it is denied, GetFullPage falls back
  to opening the preview so you can still save manually.

## Smart PDF page breaks

- Smart breaks analyse per‑row content near each page boundary to avoid cutting text lines. For
  extremely tall images that exceed the row‑scoring canvas limit, GetFullPage falls back to fixed
  page breaks.
