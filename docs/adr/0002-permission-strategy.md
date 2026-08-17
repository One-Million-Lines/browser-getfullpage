# ADR 0002 — Permission strategy: minimal, activeTab‑first

## Status

Accepted.

## Context

Full‑page screenshot tools are often over‑permissioned (broad host access, `tabs`, clipboard, and
downloads by default), which harms privacy and complicates store review. GetFullPage’s promise is
"nothing uploaded, minimal access."

## Decision

Request only what maps 1:1 to implemented functionality:

- **`activeTab` + `scripting` + `storage`** are the only required permissions on all platforms. The
  extension has **no static content scripts** and **no host permissions**; the capture controller is
  injected on the active tab only, after the user’s click/shortcut.
- **`offscreen`** is added on Chromium only, solely to composite off the service worker (which has no
  DOM). Firefox/Safari do not declare it.
- **`downloads`** is **optional** and requested at runtime only when the user turns on auto‑download or
  a Downloads subfolder. Manual export from the preview uses a user‑gesture download and needs no
  permission.
- **Clipboard**: no `clipboardWrite` permission. Image copy uses the async Clipboard API from a direct
  user gesture, with a download‑PNG fallback if the platform rejects it.
- The active tab’s URL/title is read during the user gesture via `activeTab`, so `tabs` is unnecessary.

Manifests are generated from typed config (`src/config/manifest.ts`) and every build emits a
permission audit (`build-report.json`). The extension CSP forbids remote code (`script-src 'self'`).

## Consequences

- Users grant no permanent site access; the extension cannot read arbitrary pages in the background.
- Simpler, faster store review and a smaller attack surface.
- One platform’s needs never weaken permissions for the others — differences are isolated per target
  (Chromium adds `offscreen`; nobody adds host permissions).
