# Safari (macOS 17+)

Safari support reuses the shared capture/editor/export code and is packaged as a **Safari Web
Extension** through Apple’s converter and Xcode. No native messaging or native data processing is
added in v1 — everything stays in the WebExtension, local to the device.

## 1. Produce the shared web assets

```bash
node scripts/build.mjs --target=safari    # → dist-safari/
```

`dist-safari/` contains the same bundled JS/HTML/CSS as the other targets, with a Safari‑appropriate
generated manifest.

## 2. Convert to a Safari Web Extension

Use Apple’s converter (Xcode command‑line tools required):

```bash
xcrun safari-web-extension-converter dist-safari \
  --app-name "GetFullPage" \
  --bundle-identifier com.onemillionlines.getfullpage \
  --macos-only
```

This generates an Xcode project wrapping the extension.

## 3. Build & sign in Xcode

1. Open the generated project.
2. Set your development team and a unique bundle identifier.
3. Build and run; enable the extension in **Safari → Settings → Extensions**.
4. Enable **Allow Unsigned Extensions** (Develop menu) for local testing, or sign with your
   Developer ID / App Store distribution profile for release.

## Things to verify independently on Safari

Safari’s implementations differ, so validate these before shipping:

- `activeTab` capture and `tabs.captureVisibleTab` behaviour and rate limits.
- Clipboard image writes (`ClipboardItem`) — fall back to download PNG if rejected.
- The `downloads` optional permission flow.
- Background/service‑worker lifecycle and maximum memory for very tall pages (tune the memory ceiling
  in Settings if needed).
- Offscreen compositing is **not** available on Safari; the code composites in the preview page (and,
  where a background DOM exists, in the background) via the same shared compositor.

## App Store

Package and submit through Xcode with the appropriate entitlements. The extension requests only the
minimum permissions and contains no remote code, which simplifies review.
