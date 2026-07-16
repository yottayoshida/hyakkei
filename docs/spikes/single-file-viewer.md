# Spike: baked single-file viewer over file:// (issue #26 precondition ③)

**Status**: GO — the static viewing path exists with today's shipped code, no new mechanism needed.
**Date**: 2026-07-16
**Scope**: Precondition ③ of the MCP sequencing agreement (issue #26, comment of 2026-07-12): an MCP server that returns authoring `dashboard.json` is a dead end while nothing can *display* the result — neither the editor (M2, not started) nor the exporter (M3, `packages/export` is a placeholder) ships yet. This spike pulls the thinnest possible slice of #17/#18 forward: prove that a **real** `BakedDashboard` (produced by the real `bake()`) plus the **real** renderer (`@hyakkei/core/renderer`) inlined into ONE html file renders over `file://` with zero network requests, in all 3 engines. M0's integration demo (#5) proved a similar shape in 2026-07, but against hand-wired ECharts calls — schema v1, `bake()`, and the renderer core did not exist yet. This is the first verification through the current, shipped pipeline.

Spike code is throwaway (run-once scripts, not committed); this report carries the full method so it is reproducible from scratch.

## Method

1. **Bake a real sample through the real pipeline.** `GOLDEN_SAMPLES`' `applications` fixture (3 charts: bar + line + stat, CJK content) baked via the built `packages/core/dist/bake`'s `bake(doc, rowsByQuery, meta)` — the same call path the future exporter uses. Baked JSON: **1,387 bytes** for 3 charts.
2. **Bundle the real renderer as an IIFE.** esbuild (`packages/core`'s existing devDependency, same tool `bundle-isolation.test.ts` uses), entry importing `mount`/`normalizeBaked` from `./dist/renderer/index.js`, `format: "iife"`, minified. IIFE, not ESM: every browser treats a `file://` module script as an opaque-origin CORS failure, so no `import` may survive into the artifact.
3. **One html file.** The baked JSON rides in a `<script type="application/json">` island (the shape a future exporter would emit) with `</` escaped as `<\/` so data cannot terminate the script element; the bundled renderer follows in a plain inline `<script>` that reads the island and calls `mount(root, normalizeBaked(BAKED))`.
4. **Verify over `file://` in chromium + firefox + webkit** (Playwright): expected-count-first assertions (the e2e suite's pattern) — 3 `.hyakkei-tile`, 2 `.hyakkei-chart-canvas svg` (stat is plain DOM), 3 a11y fallback tables, 0 error tiles — plus real `boundingBox()` on every SVG, `page.on("request")` capturing any non-`file://` request, and `pageerror` capturing any uncaught exception. Screenshot taken for visual confirmation.

## Results

| Check | chromium | firefox | webkit |
| --- | --- | --- | --- |
| Renders over `file://` (2 SVG canvases, real boxes 624×~280) | ✅ | ✅ | ✅ |
| 3 tiles, 3 a11y fallback tables, 0 error tiles | ✅ | ✅ | ✅ |
| Non-`file://` network requests | **0** | **0** | **0** |
| Uncaught page errors | 0 | 0 | 0 |

Visual: bar chart with decal patterns, line chart with all six 令和 CJK category labels visible (no label dropping), stat tile, per-chart 「データを表で見る」 fallback — matching the served golden rendering.

### Size

| Piece | Bytes |
| --- | --- |
| Total single html | 1,283,005 (1.22 MiB) |
| — bundled renderer JS (ECharts-dominated) | 1,281,307 |
| — baked JSON (3 charts) | 1,387 |
| gzip -9 of the whole file | 407,266 (398 KiB) |

Two structural facts fall out of the breakdown:

- **The renderer bundle is a fixed cost; data is marginal.** The document's own data is ~0.1% of the file. #18's size-triggered fallback (single-file → folder) is a *data*-scaling concern (large baked `rows`), not a renderer concern — the 1.28 MB floor doesn't grow with dashboard count or size.
- **The `./renderer` subpath isolation holds in a real artifact.** The bundle lands at ~1.28 MB ≈ ECharts alone; DuckDB-WASM (~10s of MB) and exceljs (~1.1 MB) are absent, exactly what `bundle-isolation.test.ts` pins at the import-graph level, now confirmed at the shipped-artifact level.

## What this means for issue #26 (MCP)

Precondition ③ is satisfiable with zero new mechanism: `bake()` + esbuild-IIFE + JSON island is the whole recipe, and every ingredient already ships. An MCP server returning `dashboard.json` would NOT be a dead end — a thin "bake and wrap" step (this spike's ~70-line build script, productized) turns its output into a viewable artifact. The WHETHER review (step ④) can proceed on that basis.

Two facts the WHETHER review should carry:

1. **file:// works today because the renderer needs no fetch/worker.** The moment a viewer artifact needs DuckDB (live re-query) this breaks — file:// has no worker/WASM story across engines. Baked-rows-only viewing is the file://-safe envelope, which is exactly ADR-0005's precomputed-export contract.
2. **1.22 MiB raw / 398 KiB gzipped is the minimum shippable artifact** with today's full-ECharts import. If #17 wants smaller artifacts, the lever is ECharts modular imports (per-chart-type tree shaking), not data trimming.

## Caveats

- This is not #17: no CLI, no packaging UX, no folder fallback, no CSP hardening of the artifact itself (a `file://` document has no origin to police; the served-deployment story stays M3's).
- `viewport` metadata and print styling untested (M3/M4 scope).
- Single sample (`applications`); `budget`/`regional` exercise the same code paths via the served golden e2e, so per-sample re-verification here would duplicate existing coverage.
