# Chromium (Chrome, Edge, Brave, Opera, Vivaldi, Arc)

The Chromium build is the primary, fully verified target.

## Build & load

```bash
npm run build            # → dist/
```

1. Open `chrome://extensions` (Edge: `edge://extensions`, Brave: `brave://extensions`, …).
2. Enable **Developer mode**.
3. **Load unpacked** → select `dist/`.
4. Pin the toolbar icon.

## Use

- Click the toolbar icon, or press **`Alt+Shift+P`** (capture full page) / **`⌘+Shift+P`** on macOS.
- A small overlay shows progress with a **Cancel** button.
- When capture finishes, a **preview tab** opens (or the file auto‑downloads if you enabled that in
  Settings). Export PNG/JPEG/PDF, copy to clipboard, crop, or rotate from the preview.
- Change the shortcut at `chrome://extensions/shortcuts`.

## Mobile capture

Enable **Settings → Mobile capture → "Capture as mobile by default"**, or click **Capture as mobile**
in the preview toolbar. GetFullPage emulates the chosen device (viewport width, device‑pixel‑ratio,
touch, mobile user‑agent) via the `debugger` `Emulation` protocol, captures the mobile layout with the
same scroll‑and‑stitch engine, then detaches and restores your tab. The optional `debugger` permission
is requested the first time you enable it. Close DevTools on the target page before capturing.

## How capture works on Chromium (MV3)

- The **service worker** coordinates capture and calls `tabs.captureVisibleTab` for each viewport.
- The injected **content script** measures the page, scrolls, hides repeated fixed/sticky elements on
  later slices, and restores everything afterward. A long‑lived **runtime Port** keeps coordination
  alive; if the service worker is recycled, the port disconnects and the page is restored cleanly.
- Compositing runs in an **offscreen document** (the `offscreen` permission) because the service
  worker has no DOM/canvas and can be terminated.
- Slices are written to an extension‑owned **IndexedDB** as they are captured, so a worker restart
  never loses progress. All transient data is deleted after export/preview close.

## Permissions

Required: `activeTab`, `scripting`, `storage`, `offscreen` (Chromium‑only, for compositing).
Optional: `downloads` (requested at runtime only for auto‑download / Downloads subfolder).
No `host_permissions`, no static content scripts, no `tabs`/`<all_urls>`.

## Store submission

```bash
npm run build:chrome && npm run build:zip
# upload dist-zip/getfullpage-chrome-<version>.zip to the Chrome Web Store / Edge Add-ons
```

- The package contains only bundled first‑party code; CSP is `script-src 'self'`.
- The listing’s permission justification is generated in `dist/build-report.json`.
