# Privacy Policy — GetFullPage

_Last updated: 15 August 2026_

GetFullPage is designed so that **your screenshots and the pages you capture never leave your
device**. This is a hard architectural guarantee, not just a promise.

## What GetFullPage does

- Captures the currently active tab **only when you explicitly invoke it** (toolbar click or keyboard
  shortcut), using the browser’s `activeTab` mechanism.
- Scrolls the page, captures each viewport, and stitches the frames into one image **locally**.
- Lets you preview, crop, rotate, copy, and export the result as PNG, JPEG, or PDF — **locally**.

## What GetFullPage stores

- **Settings** (format, filename template, PDF defaults, engine limits, etc.) in the browser’s
  **local** extension storage (`storage.local`). Settings are never synced to a cloud or transmitted.
- **Transient capture data** (the slices of the capture in progress and the finished image) in an
  extension‑owned **IndexedDB** database. This data exists only for the current capture and is
  deleted after you export or close the preview, and on next startup if an interrupted capture is
  detected.

## What GetFullPage never does

- **No network requests.** There is no `fetch`, `XMLHttpRequest`, WebSocket, or beacon in production
  code. Nothing is uploaded, and no remote code is loaded (the extension’s Content Security Policy
  forbids remote scripts).
- **No accounts, no cloud, no sync, no share links.**
- **No analytics, telemetry, crash reporting, or advertising.**
- **No reading of page content.** GetFullPage inspects only the layout/style/geometry it needs to
  scroll and capture (dimensions, scroll position, and which elements are fixed/sticky). It does not
  read form values, cookies, local storage, DOM text, or network traffic.
- **No broad host access.** It does not request `<all_urls>`, `tabs`, `history`, `webRequest`,
  `cookies`, or persistent host permissions.

## Permissions

| Permission | Required? | Why |
|---|---|---|
| `activeTab` | Yes | Access and capture only the tab you invoke it on. No permanent access to sites. |
| `scripting` | Yes | Inject the capture controller and temporary CSS on the active tab after your click. |
| `storage` | Yes | Save local settings and transient capture metadata. Local only. |
| `offscreen` | Chromium only | Composite the image with canvas access off the service worker. |
| `downloads` | Optional | Requested at runtime **only** if you enable auto‑download or a Downloads subfolder. Manual export uses a normal in‑page download and needs no permission. |
| `debugger` | Optional (Chromium) | Requested at runtime **only** if you enable “capture as mobile”. Used solely to emulate a mobile viewport/user‑agent locally during capture, then detached. Never used to read page data. |

## Data retention & deletion

- Settings persist until you change them or click **Reset all settings**.
- Capture pixels are deleted automatically after export/preview close and on the next startup after an
  interrupted session. You can also clear all extension data from your browser’s settings at any time.

## Contact

GetFullPage is developed by One Million Lines (https://onemillionlines.com). Because the extension has
no backend, there is nothing for us to collect, see, or delete on your behalf.
