# ADR 0003 — Huge‑image handling: bounded master + page‑by‑page PDF

## Status

Accepted.

## Context

Very tall (and wide) pages can exceed a browser’s maximum canvas dimension/area and reasonable memory.
Chromium caps a canvas around 16 384 px per side; a naive single bitmap for a 60 000 px page would be
gigabytes and would fail to allocate. The spec requires: never downscale silently, and PDF must render
without a single giant final canvas.

## Decision

- Estimate memory before compositing: `widthPx × heightPx × 4` plus a working overhead, against a
  configurable **soft ceiling (default 512 MiB)** and the safe canvas side/area limits
  (`capture/limits.ts`, unit‑tested).
- Composite into a single **master image bounded to safe limits**. If the target exceeds those limits,
  compute the largest scale that satisfies every constraint and **downscale**, surfacing the applied
  scale to the user (shown in the preview as a truncation/scale note). Never silent.
- All exports derive from the master:
  - **PNG/JPEG** encode the master directly.
  - **PDF** renders **page‑by‑page**: each page draws only its source rows onto a page‑sized canvas
    and embeds a JPEG, so a single giant canvas is never required (`export/pdf.ts` +
    `export/pdf-layout.ts` + `export/pdf-writer.ts`).
- Infinite/lazy growth is bounded by a max page height and slice count; results that hit the bound are
  labelled **truncated**.
- `tileRows()` provides safe horizontal bands for future full‑tiling of the master (designed, not yet
  enabled by default).

## Consequences

- Robust behaviour on extreme pages instead of a hard failure.
- Any resolution loss is explicit and visible.
- PDF output scales to arbitrarily tall pages within memory limits.
