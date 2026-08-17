# Firefox

Firefox ships from the same codebase with a generated MV3 manifest variant.

## Build & load

```bash
npm run build:firefox        # → dist-firefox/
```

1. Open `about:debugging#/runtime/this-firefox`.
2. **Load Temporary Add‑on…** → select `dist-firefox/manifest.json`.
3. Use the toolbar button or the keyboard shortcut.

For a persistent (signed) install, submit to AMO (below).

## Browser differences handled

- **Background context**: Firefox MV3 uses a non‑persistent **event page** with DOM access rather
  than a service worker. GetFullPage detects this and **composites directly in the background page**
  instead of using an offscreen document (Firefox has no `chrome.offscreen`). The manifest therefore
  omits the `offscreen` permission and declares `background.scripts` instead of a service worker.
- **API namespace**: Firefox exposes `browser.*` promise APIs; the platform adapter resolves the
  correct root (`browser` or `chrome`) so the rest of the code is namespace‑agnostic.
- **Gecko settings**: `browser_specific_settings.gecko.id` and `strict_min_version` (126.0) are set
  from `src/config/product.ts`. Firefox 126+ is the baseline for modern `captureVisibleTab` behaviour.

Everything else — measurement, scrolling, fixed/sticky handling, stitching, preview, and export — is
shared with the Chromium build.

## Store submission (AMO)

```bash
npm run build:firefox
cd dist-firefox && zip -r ../dist-zip/getfullpage-firefox.zip . && cd ..
# submit dist-zip/getfullpage-firefox.zip at https://addons.mozilla.org/developers/
```

- AMO performs signing. The submitted package contains no remote code.
- If a reviewer requests sources, this repository builds reproducibly with `npm ci && npm run build:firefox`.

## Notes

- Confirm `activeTab` capture behaviour on your minimum supported Firefox version before release.
- The optional `downloads` permission is requested at runtime the same way as on Chromium.
