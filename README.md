# GetFullPage — Full Page Screenshot

Capture an **entire webpage** — including everything below the fold — as one image or a
paginated PDF. Preview, crop, rotate, copy, and export locally.

> **One click, one complete page, nothing uploaded.**

GetFullPage is a privacy‑first browser extension. All capture, stitching, editing, and export
happen **on your device**. There is no backend, no account, no analytics, and no network request
in production code.

---

## Highlights

- **One‑click full‑page capture** from the toolbar or a keyboard shortcut (`Alt+Shift+P`, `⌘+Shift+P` on macOS).
- **Accurate scroll‑and‑stitch**: scrolls the page viewport‑by‑viewport, captures each frame, and
  composites them at physical‑pixel resolution using measured scale factors.
- **Handles hard pages**: fixed/sticky header/footer de‑duplication, sticky sidebars, floating chat
  widgets, lazy‑loaded content, nested scroll containers, and infinite scroll (bounded + labelled).
- **Progress overlay with Cancel**, and **guaranteed page restoration** (scroll position and every
  modified inline style) after success, cancel, or error.
- **Preview tab**: zoom (fit width/page, 25–400 %, `+ − 0`), crop, rotate, and rich metadata.
- **Export**: PNG (lossless), JPEG (quality control), and **paginated PDF** with smart page breaks,
  paper/orientation/margins, and an optional footer.
- **Copy to clipboard** where the platform supports image writes, with an automatic download fallback.
- **Capture as mobile**: emulate a phone (viewport width, device‑pixel‑ratio, touch, and mobile
  user‑agent) so responsive sites render their mobile layout — as a default setting **and** a one‑click
  toggle in the preview. Chromium‑based browsers; uses the optional `debugger` permission on demand.
- **Minimal permissions**: only `activeTab`, `scripting`, and `storage`. `downloads` and `debugger`
  are optional and requested at runtime only if you enable auto‑download or mobile capture.
- **One codebase → Chrome/Edge/Brave/Opera/Vivaldi/Arc, Firefox, and Safari (macOS)**.

See [`docs/`](docs/) for per‑browser guides, ADRs, the permission audit, known limitations, and the
acceptance report.

---

## Project layout

```text
src/
  background/    command/action handlers, capture state machine, tab validation, coordination
  content/       measurement, scrolling, page mutation (fixed/sticky), overlay, guaranteed cleanup
  capture/       plan, geometry, canvas/memory limits, fixed classification, stitching (compositor)
  offscreen/     Chromium offscreen document that composites off the service worker
  preview/       preview UI, zoom, crop/rotate, export actions
  export/        PNG/JPEG re‑encode, self‑contained PDF writer + pagination + smart breaks
  options/       settings UI and schema migrations
  platform/      typed cross‑browser API, IndexedDB, downloads, clipboard, offscreen adapters
  shared/        typed messages, error taxonomy, types, constants, settings, filenames
  config/        product identity + generated manifests (Chromium / Firefox / Safari)
scripts/         build pipeline (esbuild) and pure‑Node icon generator
tests/
  unit/          Vitest unit tests for the pure logic
  e2e/           real‑Chromium capture test (Playwright) that verifies stitched pixels
  fixtures/      deterministic local test pages (spec §10)
```

The architecture, message contract, and capture algorithm are documented inline and in
[`docs/adr`](docs/adr).

---

## Development

Requirements: **Node ≥ 20**.

```bash
npm install          # install dev dependencies
npm run build        # build the Chrome/Chromium package into dist/
npm run dev          # rebuild on change (watch mode)

npm run typecheck    # tsc --noEmit
npm test             # unit tests (Vitest)
npm run test:e2e     # build + real-Chromium capture test (Playwright)
npm run verify       # typecheck + unit tests + build
```

### Build targets

```bash
npm run build:chrome    # → dist/           (Chrome, Edge, Brave, Opera, Vivaldi, Arc)
npm run build:firefox   # → dist-firefox/   (Firefox, MV3 event page)
npm run build:all       # both, zipped into dist-zip/
node scripts/build.mjs --target=safari      # → dist-safari/ (shared code for the Xcode wrapper)
```

Manifests and icons are **generated**, never hand‑edited:

- `src/config/product.ts` — product identity and version.
- `src/config/manifest.ts` — the per‑target Manifest V3 document and the permission audit.
- `scripts/gen-icons.mjs` — brand icons, encoded as PNG in pure Node (no external deps).

Each build also writes `dist*/build-report.json`, a machine‑readable permission audit that lists
every required/optional permission and the reason it is needed.

---

## Manual install (unpacked)

**Chrome / Edge / Brave / Opera / Vivaldi / Arc**

1. `npm run build`
2. Open `chrome://extensions` (or the browser’s equivalent) and enable **Developer mode**.
3. **Load unpacked** → select the `dist/` folder.
4. Pin the toolbar icon. Click it (or press `Alt+Shift+P`) on any normal page to capture.

**Firefox**

1. `npm run build:firefox`
2. Open `about:debugging#/runtime/this-firefox` → **Load Temporary Add‑on** → select
   `dist-firefox/manifest.json`.

**Safari (macOS)** — see [`docs/safari.md`](docs/safari.md).

---

## Store submission (summary)

- **Chrome Web Store / Edge Add‑ons**: `npm run build:chrome && npm run build:zip`, then upload
  `dist-zip/getfullpage-chrome-<version>.zip`. The package contains no remote code and requests only
  the declared minimum permissions.
- **Firefox AMO**: `npm run build:firefox`, zip `dist-firefox/`, and submit; signing is performed by
  AMO. `browser_specific_settings.gecko.id` and `strict_min_version` are set from config.
- **Safari**: convert with Apple’s Safari Web Extension tooling and sign in Xcode — see
  [`docs/safari.md`](docs/safari.md).

Full per‑store guidance is in [`docs/chrome.md`](docs/chrome.md), [`docs/firefox.md`](docs/firefox.md),
and [`docs/safari.md`](docs/safari.md).

---

## Privacy

Screenshots and page data **never leave your device**. GetFullPage makes no network requests, has no
analytics, and stores only your local settings and the transient pixels of the current capture. See
[`PRIVACY.md`](PRIVACY.md).

## Mobile capture

Turn on **Settings → Mobile capture → “Capture as mobile by default”**, or use the **Capture as
mobile** button in the preview toolbar to re‑take the current page as a phone. GetFullPage emulates
the selected device’s viewport width, device‑pixel‑ratio, touch, and mobile user‑agent **locally**
(via the Chromium `debugger` protocol, requested on demand), captures the mobile layout with the same
scroll‑and‑stitch engine, then detaches and restores your tab. Available on Chromium‑based browsers;
close DevTools on the target page first. See [`docs/adr/0005-mobile-emulation.md`](docs/adr/0005-mobile-emulation.md).

## License

MIT — see [`LICENSE`](LICENSE).
