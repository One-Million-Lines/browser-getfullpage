# GetFullPage — Product and Technical Specification

Version: 1.0  
Date: 15 August 2026  
Scope: client-side browser extension only; no backend, accounts, telemetry, or cloud storage

## 1. Product definition

GetFullPage is a privacy-first browser extension that captures an entire webpage, including content below the visible viewport, and lets the user preview, export, copy, crop, and optionally annotate the result. All image processing and persistence happen locally in the browser.

Primary promise: **one click, one complete page, nothing uploaded.**

### Supported desktop browsers

- Chrome and Chromium derivatives: Chrome, Edge, Brave, Opera, Vivaldi, Arc
- Firefox
- Safari 17+ on macOS, packaged as a Safari Web Extension through Xcode

Mobile browsers are out of scope for v1. Chrome/Edge mobile do not provide the normal desktop extension platform. Safari on iOS can be evaluated later as a separate target because memory, permissions, and store packaging differ.

## 2. Competitive analysis: what GoFullPage does

The researched GoFullPage product provides:

- One-click full-page capture from the toolbar.
- Keyboard shortcut (`Alt+Shift+P` is documented on its Chrome listing).
- Automatic scrolling, viewport-by-viewport capture, and local stitching.
- Capture progress shown while the page scrolls.
- A result/preview tab after capture.
- Image export, including PNG and JPEG/JPG.
- PDF export.
- Copy to clipboard.
- Crop, edit, and annotation tools in its current product; richer editing is positioned as premium.
- Annotation primitives documented by its product material: rectangle, oval, line, arrow, text, and blur.
- Formatting controls: color, stroke width, fill, transparency, padding, and border.
- Reusable editor theme defaults.
- PDF paper sizing and page splitting.
- “Smart” PDF page splitting intended to avoid cutting text lines.
- Optional URL and capture date/time in PDF output.
- Configurable download subdirectory within the browser's Downloads directory.
- Auto-download instead of opening the preview tab.
- Options/defaults retained locally.
- Handling for difficult pages, including fixed/sticky elements and complex layouts.
- Privacy positioning: capture without broad permanent host access and process locally.

Important implementation observation: full-page capture is not one native image call in Chromium. The extension scrolls the document, calls the visible-tab capture API for every viewport, and composes the slices into a final bitmap.

## 3. GetFullPage scope

### 3.1 v1 release requirements (P0)

1. One-click full-page capture.
2. Keyboard shortcut.
3. Accurate automatic scrolling and stitching.
4. Progress UI and cancel action.
5. Preview tab.
6. Export PNG, JPEG, and paginated PDF.
7. Copy final image to clipboard where supported.
8. Crop and rotate.
9. Local settings.
10. No network requests, analytics, account, or backend.
11. Chrome/Edge/Brave/Opera/Vivaldi/Arc and Firefox packages from one codebase.
12. Safari macOS package from the same shared capture/editor code.

### 3.2 v1.1 enhancements (P1)

- Capture visible viewport.
- Capture a user-selected region.
- Annotation: arrow, line, rectangle, ellipse, freehand pen, text, highlight, blur/pixelate, numbered marker.
- Undo/redo and object selection.
- Smart PDF page breaks.
- Optional URL/title/date/time footer.
- Auto-download.
- Custom filename template and Downloads subfolder.
- Capture a specific scrollable element chosen by the user.
- Capture history stored only locally, with configurable retention.

### 3.3 Explicitly out of scope

- Cloud uploads, share links, team workspaces, sync, accounts, subscriptions, remote logging, or analytics.
- Video/screen recording.
- OCR and searchable PDFs.
- Capturing browser internal pages, extension stores, browser chrome, DRM video, or cross-origin iframe content that the browser blanks or prevents from being captured.
- Automated capture of arbitrary URLs in the background.

## 4. User flows

### 4.1 Standard full-page capture

1. User opens a normal HTTP/HTTPS page.
2. User clicks the toolbar icon or presses the command shortcut.
3. Extension validates that the tab is capturable.
4. A small in-page overlay shows “Preparing capture…”.
5. Capture engine snapshots page state, detects scroll root and dimensions, and waits for fonts/images currently loading for a bounded period.
6. It scrolls through planned Y positions, captures each visible viewport, and reports progress.
7. It captures the final partial slice, restores the original scroll position and every temporary style.
8. The extension stitches slices locally.
9. It opens the preview page, or auto-downloads if that setting is enabled.
10. User exports, copies, crops, edits, or closes the result.

### 4.2 Cancel/error

- Cancel stops further screenshots and always restores the DOM and scroll position.
- A failed capture shows an actionable reason and a Retry button.
- Partial images are not silently presented as complete.

## 5. Functional requirements

### 5.1 Capture coordinator

- Only one active capture per tab; a second invocation focuses/cancels the active capture.
- Lock capture to the initiating `tabId`, `windowId`, URL, and document identity.
- Abort if the tab navigates, closes, changes window, or ceases to be active when the browser API only captures the active tab.
- Use a state machine: `idle -> preparing -> measuring -> capturing -> stitching -> ready`, with `cancelled` and `failed` terminal paths.
- Maintain a long-lived runtime Port during capture so a Manifest V3 service worker can restart without corrupting coordination.
- Always execute cleanup in `finally`.

### 5.2 Page preparation and measurement

- Run injected code in the isolated extension world.
- Determine the primary scroll root (`document.scrollingElement`, with fallback detection for app-style scroll containers).
- Calculate capture width/height using the maximum of scroll/client/offset dimensions for document element, body, and selected scroll root.
- Record:
  - original X/Y scroll position;
  - viewport CSS width/height;
  - `devicePixelRatio`;
  - browser zoom when exposed;
  - document dimensions;
  - style attributes modified by the extension;
  - fixed/sticky candidates and their original visibility/style state.
- Clamp dimensions against browser canvas limits and memory budget before starting.
- Detect meaningful dimension growth caused by lazy loading and extend the plan only up to configured safety limits.

### 5.3 Scroll and capture algorithm

- Capture in top-to-bottom order.
- Default step is the effective visible content height, with a 1–2 CSS-pixel overlap to prevent seams.
- For each position:
  1. Request scroll.
  2. Wait for two `requestAnimationFrame` cycles.
  3. Wait until actual scroll position stabilizes, with a timeout.
  4. Allow a short configurable settle delay for lazy-loaded/rendered content.
  5. Hide the progress overlay before the screenshot.
  6. Ask the background coordinator to call `tabs.captureVisibleTab` for the initiating window.
  7. Restore overlay and report progress.
- Use the returned bitmap's actual pixel dimensions—not assumptions—to calculate crop coordinates.
- Deduplicate identical consecutive slices, which may indicate a failed scroll.
- The last slice must be cropped to the remaining document height.
- Horizontal overflow: v1 captures the layout viewport width. P1 may support horizontal tiling behind a setting because it greatly increases memory and complexity.

### 5.4 Fixed, sticky, and floating UI

- Preserve fixed/sticky elements in the first slice by default.
- On later slices, temporarily hide elements whose computed position is `fixed` or `sticky` and that overlap a viewport edge, preventing repeated headers/chat widgets/cookie bars.
- Do not hide a fixed element that occupies most of the page or appears to be the actual application content; use heuristics and allow a “keep repeated fixed elements” setting.
- Restore exact inline styles after every capture, cancellation, and error.
- Detect CSS transforms on ancestors and avoid applying transforms to the page for scrolling.

### 5.5 Lazy loading, animations, and dynamic pages

- Trigger lazy content through real scrolling.
- Pause CSS animations/transitions and animated GIF/video frames only when safely possible; default is to freeze CSS animation and transition durations, not mutate media playback.
- After each scroll, wait for layout stability using repeated dimension/scroll-position checks rather than an unbounded network-idle wait.
- Stop dimension expansion after 3 stable checks or when limits are reached.
- Detect infinite-scroll behavior. Stop at user-configured maximum height/slices and clearly label the result as truncated; never loop indefinitely.
- Warn when the page changes substantially during capture.

### 5.6 Stitching and memory safety

- Decode captures with `createImageBitmap` when available.
- Perform composition in an extension page or offscreen document with DOM/canvas access, not directly in the MV3 service worker.
- Use `OffscreenCanvas` where supported; fall back to regular canvas.
- Composite at physical-pixel resolution using measured scale factors.
- Release each source bitmap immediately after drawing.
- Estimate memory before capture: `widthPx * heightPx * 4`, plus working overhead. Default soft ceiling: 512 MiB; make the engine configurable per platform.
- Respect implementation-specific maximum canvas dimension/area. If one bitmap is unsafe, use a tiled internal representation.
- PNG/JPEG export may require multiple images for extremely tall pages. PDF must always support page-by-page rendering without a single giant final canvas.
- Never downscale silently. If downscaling is offered, show the chosen scale.

### 5.7 Preview/editor

- Extension-owned full-tab page, responsive down to 800 px width.
- Toolbar: Download PNG, Download JPEG, Export PDF, Copy, Crop, Rotate, Edit, Retake, Settings.
- Show filename, pixel dimensions, estimated file size, capture URL, and timestamp.
- Zoom controls: fit width, fit page, 25–400%, keyboard `+`, `-`, `0`.
- Canvas is virtualized/tiled for very tall images.
- All edits are non-destructive until export.
- Warn before closing with unexported edits.

### 5.8 Editor (P1)

- Object model stored separately from source pixels.
- Tools: select/move/resize, crop, rectangle, ellipse, line, arrow, freehand, text, highlight, blur/pixelate, numbered marker.
- Properties: stroke/fill color, opacity, line width, font family/size/weight, arrowhead, blur strength.
- Undo/redo minimum 50 operations.
- Delete, duplicate, bring forward/send backward.
- Keyboard: Escape, Delete/Backspace, Cmd/Ctrl+Z, Shift+Cmd/Ctrl+Z, Cmd/Ctrl+C/V for editor objects.
- Export flattens source plus edits; editing state may be kept in session storage but is not a proprietary file requirement for v1.

### 5.9 Export

**PNG**
- Lossless, default format, preserve alpha where possible.

**JPEG**
- White background, quality setting 0.6–1.0, default 0.92.

**PDF**
- Paper: A4, Letter, Legal, Fit to image width, and custom.
- Orientation: auto, portrait, landscape.
- Margins: none, narrow, normal, custom.
- Split image into pages locally.
- P1 smart breaks examine a narrow band near each proposed break and move the break toward low-content horizontal rows, within a bounded tolerance.
- Optional footer/header: page title, sanitized URL, local capture date/time, and page number.

**Clipboard**
- Write `image/png` from a direct user gesture using `ClipboardItem` where available.
- If the browser/platform rejects image clipboard writes, show a clear fallback to download PNG.

**Filename**
- Default: `getfullpage-{sanitized-host}-{yyyyMMdd-HHmmss}.{ext}`.
- Template tokens: `{title}`, `{host}`, `{date}`, `{time}`, `{width}`, `{height}`.
- Sanitize invalid path characters and cap base filename length at 120 characters.

### 5.10 Settings

- Default format and JPEG quality.
- Post-capture behavior: open preview or auto-download.
- Filename template.
- Optional Downloads subfolder.
- Scroll settle delay: Auto/100/250/500/1000 ms.
- Freeze CSS animation/transitions.
- Fixed/sticky handling.
- Maximum page height/slice count.
- PDF defaults.
- Annotation defaults (P1).
- Reset all settings.

Settings use extension local storage. Do not request sync storage or transmit settings.

## 6. Minimal permission design

### 6.1 Required core permissions

| Permission | Why required | Privacy boundary |
|---|---|---|
| `activeTab` | Temporarily access and capture only the tab on which the user explicitly invokes the extension | No permanent access to every website |
| `scripting` | Inject the capture controller and temporary CSS after user invocation | Used only for the active tab; no static `<all_urls>` content script |
| `storage` | Save local preferences and optional local capture metadata | Local only; no sync or server |

Do **not** request `tabs`, `<all_urls>`, `history`, `webRequest`, `cookies`, `identity`, `unlimitedStorage`, `nativeMessaging`, or persistent host permissions.

The `tabs` permission is not needed merely to call most Tabs APIs. With `activeTab`, the extension can obtain the active tab's URL/title during the user gesture.

### 6.2 Optional permissions

- `downloads`: request at runtime only when the user enables auto-download or a Downloads subfolder. Manual export should use a user-gesture download from an extension page so the core product can avoid this permission where browser behavior permits.
- `clipboardWrite`: avoid as a required permission. First try the modern Clipboard API from a direct user action; request/add a browser-specific permission only if testing proves necessary.

### 6.3 Chromium manifest baseline (MV3)

```json
{
  "manifest_version": 3,
  "name": "GetFullPage",
  "version": "1.0.0",
  "permissions": ["activeTab", "scripting", "storage"],
  "optional_permissions": ["downloads"],
  "action": { "default_title": "Capture full page" },
  "background": { "service_worker": "background.js", "type": "module" },
  "options_ui": { "page": "options.html", "open_in_tab": true },
  "commands": {
    "capture-full-page": {
      "suggested_key": { "default": "Alt+Shift+P", "mac": "Command+Shift+P" },
      "description": "Capture the full page"
    }
  }
}
```

No `host_permissions` and no static content scripts.

### 6.4 Firefox

- Prefer MV3 if the target Firefox versions fully satisfy capture/service-worker behavior in final compatibility tests; otherwise maintain a generated Firefox manifest variant with the smallest required background-page adjustment.
- Use `browser.*` Promise APIs through a compatibility adapter.
- Confirm `activeTab` capture behavior on the minimum supported Firefox version; Firefox 126+ is a safe baseline for the modern `captureVisibleTab` permission behavior.
- Supply `browser_specific_settings.gecko.id` and minimum version.

### 6.5 Safari

- Convert/package the WebExtension using Apple's Safari Web Extension tooling and Xcode.
- Keep capture, editor, settings, and export code shared.
- Isolate API differences behind adapters.
- Add no native communication or native data processing in v1.
- Test App Store entitlements and Safari's `activeTab`, capture, clipboard, download, service-worker/background, and maximum-memory behavior independently.

## 7. Architecture

Recommended stack: TypeScript, WebExtension APIs, lightweight DOM UI or React/Preact for preview/editor, Canvas 2D, and a client-side PDF library that bundles without remote code. Use `webextension-polyfill` or a small typed internal adapter. Bundle all code and fonts locally; extension CSP must forbid remote scripts.

### Modules

```text
src/
  background/       command/action handlers, capture state, tab validation
  content/          measurement, scrolling, page mutation, cleanup
  capture/          plan, slice metadata, stitching, tiling, memory budget
  preview/          preview UI and export actions
  editor/           non-destructive annotation model (P1)
  export/           PNG, JPEG, PDF, clipboard, filenames
  options/          settings UI and schema migrations
  platform/         browser API, offscreen, downloads, clipboard adapters
  shared/           messages, errors, types, constants
  manifests/        Chromium, Firefox, Safari templates
```

### Message contract

All messages are typed and include `captureId` and `tabId` where relevant:

- `CAPTURE_START`, `CAPTURE_CANCEL`
- `PAGE_PREPARE`, `PAGE_MEASURED`
- `SCROLL_TO`, `SCROLL_STABLE`
- `CAPTURE_VIEWPORT`, `SLICE_READY`
- `CAPTURE_PROGRESS`
- `PAGE_CLEANUP`
- `STITCH_START`, `STITCH_COMPLETE`
- `CAPTURE_FAILED`

Reject stale messages whose capture ID does not match the active session.

### Data handling

- Slice bytes live in memory or temporary extension-owned IndexedDB only for the current capture.
- Delete temporary slices after export/preview close, and on next startup if an interrupted-session marker exists.
- Settings live in `storage.local`.
- Optional history (P1) uses IndexedDB with a user-defined count/size limit and an explicit Clear button.
- Never read page form values, cookies, local storage, DOM text, or network traffic. Page inspection is limited to layout/style/geometry needed for capture.
- No fetch/XHR/WebSocket/beacon calls in production code.

## 8. Error handling and restrictions

Use friendly errors for:

- Restricted URLs: `chrome://`, `edge://`, `about:`, browser stores, extension pages, view-source, and other non-injectable schemes.
- Local `file://` pages without user-enabled file access.
- Tab became inactive or navigated.
- Page too large for configured memory limit.
- Infinite scrolling/truncation.
- Scroll root cannot be moved.
- Capture API rate limit or transient error; retry a slice with bounded exponential backoff, maximum 3 attempts.
- Canvas/PDF encoding failure.
- Clipboard unsupported or denied.
- Download permission denied.

Never leave page styles, scroll position, animations, or overlays altered after failure.

## 9. Non-functional requirements

- First overlay visible within 150 ms of invocation on a normal page.
- No missed or duplicated content on the reference fixture suite at 100%, 125%, 150%, and 200% zoom/DPR combinations.
- Pixel seam mismatch no greater than 1 physical pixel where browser rounding makes exact alignment impossible.
- No network requests in automated integration tests.
- No console errors on successful capture.
- Extension idle memory below 25 MiB; release capture buffers after use.
- Accessible UI: WCAG 2.1 AA contrast, complete keyboard navigation, visible focus, meaningful labels, live progress announcements, reduced-motion support.
- Localization-ready strings; English first.
- CSP: only bundled scripts (`script-src 'self'`); no `eval`, remote code, or remotely hosted fonts.

## 10. Test plan

### Unit tests

- Dimension and scroll-position planning.
- DPR/zoom coordinate conversions.
- Last-slice cropping and overlap removal.
- Filename sanitization.
- Memory/canvas-limit decisions.
- Fixed/sticky classification.
- PDF pagination and smart-break selection.
- Settings migrations and message validation.

### Fixture pages

Build local deterministic fixtures for:

- Short page and exactly one viewport.
- Long static page.
- Fractional dimensions and browser zoom.
- Fixed header/footer, sticky sidebar, floating chat button.
- Lazy images and virtualized content.
- Infinite scrolling.
- Nested scroll container and body with `overflow:hidden`.
- CSS transforms, scroll snapping, smooth scrolling.
- Very tall and very wide pages.
- Canvas, SVG, video, WebGL, cross-origin iframe.
- RTL and vertical writing modes.
- Page mutation/navigation during capture.

### Browser matrix

- Latest and previous major: Chrome, Edge, Firefox, Safari.
- Latest Brave and Opera.
- Windows 11, current macOS, representative Linux distribution.
- DPR 1 and 2; zoom 80%, 100%, 125%, 150%, 200%.

### Acceptance criteria

1. Toolbar and shortcut capture the full reference page without requiring permanent site access.
2. Original page state is restored byte-for-byte for every inline style the extension modified and scroll position within 1 CSS pixel.
3. PNG/JPEG dimensions match expected physical pixels.
4. PDF pages render without blank bands, repeated headers caused by capture, or content loss at page boundaries.
5. Cancel works at every state.
6. Restricted pages fail safely with an explanation.
7. Network test reports zero outbound requests.
8. Store packages contain no remote code and request only the declared minimum permissions.

## 11. Implementation milestones

### Milestone 1 — Capture core

- Monorepo/build pipeline, manifests, API adapter.
- Toolbar/command invocation.
- Page prepare/measure/scroll/cleanup.
- Viewport capture and accurate stitching.
- Progress/cancel/error UI.
- Chromium fixture tests.

### Milestone 2 — Preview and exports

- Virtualized preview.
- PNG, JPEG, clipboard, PDF.
- Crop/rotate.
- Settings and filenames.
- Firefox support and cross-browser tests.

### Milestone 3 — Hard pages and release quality

- Fixed/sticky de-duplication.
- Lazy/infinite/nested-scroll handling.
- Memory tiling and extreme-page behavior.
- Accessibility, localization foundation, privacy audit.
- Store-ready Chrome/Edge/Firefox builds.

### Milestone 4 — Safari

- Xcode Safari Web Extension wrapper.
- Safari API adapters, memory tuning, signing, and store package.

### Milestone 5 — Editor/P1

- Annotation object model and tools.
- Undo/redo, theme defaults, smart PDF breaks.
- Scrollable-element and selection captures.

## 12. Definition of done for the coding agent

The coding agent must deliver:

- Complete TypeScript source and reproducible builds.
- Separate installable packages for Chromium, Firefox, and Safari macOS.
- No backend or network dependency.
- Manifest permission audit showing why every permission is needed.
- Unit, integration, and browser end-to-end tests.
- Local fixture site used by tests.
- README with development, build, signing, manual-install, and store-submission instructions.
- Privacy policy stating that screenshots and page data never leave the device.
- Architecture decision records for capture strategy, permission strategy, huge-image handling, and browser differences.
- Known-limitations document.
- Successful acceptance-test report for the browser matrix.
- Documentation under each browser, readme files to understand it.

## 13. Coding-agent instruction

Build **GetFullPage** exactly to this specification. Start with P0 and milestones 1–3; keep P1 features behind feature flags. Prioritize capture correctness, guaranteed cleanup, memory safety, privacy, and minimal permissions over UI polish. Do not introduce a server, analytics SDK, remote assets, runtime-loaded code, broad host permissions, or a framework that prevents Safari packaging. When browser behavior differs, implement a typed platform adapter and document the difference; do not weaken permissions for all browsers to simplify one platform. Treat every capture as sensitive data and keep it local.

## 14. Research basis

- GoFullPage product and FAQ: https://gofullpage.com/ and https://gofullpage.com/faq
- GoFullPage automation/options documentation: https://blog.gofullpage.com/2023/04/27/4-ways-to-automate-your-gofullpage-workflow/
- GoFullPage creator's technical description of scroll-and-stitch capture: https://mrcoles.com/full-page-screen-capture-chrome-extension/
- Chrome scripting/permission documentation: https://developer.chrome.com/docs/extensions/reference/api/scripting
- Chrome downloads documentation: https://developer.chrome.com/docs/extensions/reference/api/downloads
- Mozilla `tabs.captureVisibleTab` documentation: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabs/captureVisibleTab
- Apple Safari Web Extensions documentation: https://developer.apple.com/documentation/safariservices/safari-web-extensions

This specification describes observable capabilities and a clean-room implementation approach. Do not copy GoFullPage source code, branding, icons, text, or proprietary assets.
