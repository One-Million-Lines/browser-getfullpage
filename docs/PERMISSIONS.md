# Permission audit

GetFullPage requests the smallest permission set that maps 1:1 to implemented functionality. A
machine‑readable version is emitted to `dist*/build-report.json` on every build.

## Required (all platforms)

| Permission | Why it is required | Privacy boundary |
|---|---|---|
| `activeTab` | Access and capture **only** the tab the user explicitly invokes GetFullPage on (toolbar click or shortcut). | No permanent access to any site; granted per‑invocation. |
| `scripting` | Inject the capture controller and temporary CSS on the active tab **after** the user gesture. | Used only on the active tab; there is no static `<all_urls>` content script. |
| `storage` | Persist local settings and transient capture metadata. | `storage.local` only — never `storage.sync`, never transmitted. |

## Required (Chromium only)

| Permission | Why it is required | Privacy boundary |
|---|---|---|
| `offscreen` | Composite captured slices with canvas access **off** the service worker, which has no DOM and can be terminated. | Local processing only; the offscreen document loads no remote code. Firefox/Safari do not use or declare this. |

## Optional (requested at runtime)

| Permission | When it is requested | Why |
|---|---|---|
| `downloads` | Only when the user enables **auto‑download** or sets a **Downloads subfolder** in Settings. | Needed to write to a chosen subfolder / save without opening the preview. Manual export from the preview uses a normal user‑gesture download and needs no permission. |
| `debugger` (Chromium only) | Only when the user enables **“capture as mobile”** in Settings or clicks **Capture as mobile** in the preview. | Emulate a mobile viewport, device‑pixel‑ratio, touch, and user‑agent **locally** during capture using the `Emulation` domain, then detach. Not declared on Firefox/Safari. |

## Explicitly NOT requested

`tabs`, `<all_urls>` / host permissions, `history`, `webRequest`, `cookies`, `identity`,
`unlimitedStorage`, `nativeMessaging`, `clipboardWrite`, and any persistent host access.

- Clipboard copy uses the modern async Clipboard API from a direct user gesture; if the platform
  rejects image writes, the UI falls back to downloading a PNG. No clipboard permission is declared.
- The active tab’s URL/title is obtained during the user gesture via `activeTab` — the `tabs`
  permission is not needed for this.
- The optional `debugger` permission (mobile capture) is not in the required set, is requested only
  when the user opts in, is used solely for local `Emulation` device metrics during a capture, and is
  detached immediately afterward. It is never used to read page data.

## Content Security Policy

`extension_pages: "script-src 'self'; object-src 'self'"` — only bundled first‑party scripts run. No
`eval`, no remotely hosted code, no remote fonts.
