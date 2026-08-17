# Acceptance test report

This report maps the spec §10 acceptance criteria to the automated tests in this repository. Run it
yourself with `npm run verify` (typecheck + unit tests + build) and `npm run test:e2e`
(real‑Chromium capture).

## Automated results

- **Unit tests** (`npm test`): 65 tests across 8 suites — dimension/scroll planning, DPR/zoom
  coordinate conversions, last‑slice cropping & overlap, filename sanitisation, memory/canvas‑limit
  decisions, fixed/sticky classification, PDF pagination & smart‑break selection, the PDF writer, and
  settings migrations/message validation. **All passing.**
- **End‑to‑end capture** (`npm run test:e2e`): loads the built extension in real Chromium
  (Playwright), captures a deterministic tall fixture with a fixed header, and asserts on the
  **stitched pixels**. **All checks passing:**
  - extension loads; capture is triggered; a preview tab opens with the image.
  - image is a tall, multi‑viewport stitch at the layout‑viewport width.
  - the fixed header appears once at the top; the top green band and bottom blue band are correct,
    proving top‑to‑bottom coverage.
  - **no repeated header and no gaps** at 25 % / 50 % / 75 % of the page (correct fixed de‑dup and
    seamless stitching).
  - the original page is **restored**: scroll position back to top, overlay removed, fixed‑element
    visibility restored.
  - **zero external network requests** and **no console errors** during a successful capture.
  - **Mobile capture**: a responsive fixture is re‑captured with device emulation; the image width is
    390×3 = **1170 px**, the page’s **mobile media query is applied** (mobile colour, not desktop), the
    preview shows the device label, and the source tab is **restored to desktop width** after the
    debugger detaches.

## Criteria mapping

| # | Acceptance criterion (spec §10) | Where it is verified |
|---|---|---|
| 1 | Toolbar/shortcut capture the full page without permanent site access | e2e capture flow; manifest uses `activeTab` only (`docs/PERMISSIONS.md`) |
| 2 | Original page state restored (styles + scroll within 1 px) | e2e: scroll restored to 0, overlay removed, fixed visibility restored; `content/*` restore in `finally` |
| 3 | PNG/JPEG dimensions match expected physical pixels | e2e width == layout viewport; `capture/geometry.ts` + `plan.test.ts` + `geometry.test.ts` |
| 4 | PDF pages render without blank bands / repeated headers / boundary loss | `pdf-layout.test.ts` (full coverage, smart breaks), `pdf-writer.test.ts` (valid PDF); page‑by‑page render in `export/pdf.ts` |
| 5 | Cancel works at every state | `background/session.ts` state machine + `finally` cleanup; overlay Cancel wired to `CAPTURE_CANCEL` |
| 6 | Restricted pages fail safely with an explanation | `background/tab-validation.ts` + `shared/errors.ts`; preview error view with Retry |
| 7 | Network test reports zero outbound requests | e2e asserts zero external requests attributed to the extension |
| 8 | Store packages contain no remote code and only declared permissions | CSP `script-src 'self'`; `dist*/build-report.json` permission audit |

## Manual browser matrix (to run before release)

The automated e2e covers Chromium. Before a store release, manually verify on the target matrix
(Chrome, Edge, Firefox, Safari; Brave/Opera; Windows/macOS/Linux; DPR 1 & 2; zoom 80–200 %) using the
fixtures in `tests/fixtures/` (short, long, fixed‑sticky, lazy, infinite, nested‑scroll, transforms,
tall‑wide, rtl). Confirm no missed/duplicated content, seams ≤ 1 physical pixel, and correct
restoration in each case.
