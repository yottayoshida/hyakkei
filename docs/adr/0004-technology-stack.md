# ADR-0004: Technology stack for v0.1

- **Status**: Accepted (2026-07-04, amended 2026-07-05) — chart-library row is provisional pending the M0 spike; Excel-parser row was amended pre-M0 by `/plan` investigation (below) and remains open to a further M0 amendment
- **Deciders**: yotta

## Amendment (2026-07-05)

`/plan` investigation (Architect + Codex proxy review) found two factual errors in the original Decision table below, corrected in place rather than left to stand:

1. **DuckDB-WASM cannot read `.xlsx` directly.** The WASM build's `excel` extension does not support `.xlsx` (`read_xlsx` is an [open DuckDB-WASM issue, #1956](https://github.com/duckdb/duckdb-wasm/issues/1956)). Every `.xlsx` file must be parsed by a JS library into rows first, then registered as a DuckDB table via `registerFileBuffer`/`registerFileText` — DuckDB only ever sees CSV/Parquet/already-tabular data, never raw `.xlsx` bytes. The Query engine row below is corrected accordingly.
2. **SheetJS CE is not a safe default.** It was withdrawn from npm in 2022 (published only via SheetJS's own CDN since; see [SheetJS/sheetjs#2667](https://github.com/SheetJS/sheetjs/issues/2667)), and the last npm-published version (0.18.5) carries known CVEs (prototype pollution, ReDoS) that will never be patched via npm/dependabot. A CDN-tarball dependency falls outside the supply-chain controls ARCHITECTURE §6 relies on (lockfile + dependabot). **ExcelJS (MIT, npm-standard, dependabot-covered) is promoted from "rejected alternative" to default candidate.** The M0 fidelity test (issue #3) now evaluates ExcelJS as the default with SheetJS CE only as a fallback requiring an explicit vendoring plan (pinned tarball + SRI + a documented manual-update procedure) if ExcelJS fails the corpus.
3. **DuckDB-WASM version pin.** `npm view @duckdb/duckdb-wasm` resolved `latest` to a dev prerelease (`1.33.1-dev57.0`) as observed 2026-07-04; the last stable release at that time was **1.32.0**. Pin explicitly — do not trust `latest` — and re-run `npm view` at M0 to confirm this is still current before pinning in `package.json`.

These corrections don't change ADR-0004's overall shape (TypeScript/React/ECharts/DuckDB-WASM/pnpm monorepo); they correct two rows and add a version pin. See also ADR-0005 (pre-computed export: the query engine's role is now editor/export-time only, never in the viewer) and ADR-0006 (the Excel-parser license question is separate from, and doesn't affect, ADR-0006's design-asset licensing track).

## Context

One maintainer, a product whose differentiators are (a) browser-complete execution and (b) Digital Agency design-system fidelity. Stack choices should maximize leverage from official MIT-licensed assets (design tokens, React example components, Tailwind theme plugin) and minimize exotic dependencies.

## Decision

| Layer | Choice | Rationale | Rejected alternatives |
|-------|--------|-----------|----------------------|
| Language | TypeScript | One language across schema/core/app/CLI; typed schema generation | — |
| UI framework | React 18 | The Digital Agency publishes React example components and a Tailwind theme plugin; adopting them directly is the whole point. Largest contributor pool | Vue/Svelte (smaller overlap with official assets); vanilla (editor complexity too high) |
| Charts | Apache ECharts | Covers every guidebook chart type incl. maps (v0.5); canvas performance; mature CJK label/wrap handling; Apache-2.0; huge ja-community knowledge base | Vega-Lite (elegant grammar, but theming to pixel-match the guidebook and CJK layout control are harder); Chart.js (missing chart types); D3-direct (maintenance cost) |
| Query engine | DuckDB-WASM **1.32.0 (explicit pin — `latest` resolves to a dev prerelease)** | SQL over CSV/Parquet entirely client-side, editor/export-time only (ADR-0005: never present in the viewer); Parquet snapshots for export; the enabling tech for ADR-0001. **Does not read `.xlsx` directly** — see Amendment above; `.xlsx` is parsed by the Excel-parsing library below and registered as a table | sql.js/SQLite-WASM (weaker file-format ingestion, no Parquet — kept as the ADR-0004 M0 escape hatch); Arquero/danfo (not SQL — SQL in dashboard.json is the developer escape hatch, ADR-0002); custom JS aggregation (reinventing a database, badly) |
| Excel parsing | **ExcelJS (default candidate — promoted 2026-07-05, see Amendment above)** | MIT, npm-standard, dependabot-covered; M0 fidelity test (issue #3) confirms on messy Japanese workbooks | SheetJS CE (npm-withdrawn since 2022, frozen npm version carries unpatched CVEs — only viable with an explicit vendoring+SRI+manual-update plan); DuckDB excel extension in WASM (confirmed unavailable for `.xlsx`, see Amendment) |
| Build | Vite | Boring default; WASM/worker support documented | — |
| Styling | Digital Agency design-tokens + tailwind-theme-plugin | Official, MIT, versioned upstream | Hand-copied token values (drift risk) |
| State | Zustand (or equally small) | The dashboard.json document IS the state; need undo/redo, not a framework | Redux (ceremony without benefit here) |
| Repo | pnpm monorepo: `schema` / `core` / `app` / `export` | `schema` and `core` publish to npm later for CLI/third parties without extraction surgery | Single package (would entangle editor with renderer, breaking the export/CLI reuse plan) |

## M0 escape hatches

- If ECharts cannot pixel-match guidebook samples or fails a11y needs → evaluate Vega-Lite before M1; amend this ADR.
- If DuckDB-WASM bundle/memory cost is unacceptable on the M0 test matrix (single-threaded build — see ADR-0005) → fall back to SQLite-WASM + custom CSV ingestion, and drop Parquet snapshots. This weakens but does not break ADR-0001.
- If ExcelJS fidelity disappoints on the Japanese-workbook corpus → evaluate SheetJS CE, but only with the vendoring+SRI+manual-update plan required by the Amendment above; a bare `npm install sheetjs` is not an option.

## Consequences

- (+) Every styling asset tracks the official design system by construction; token upgrades are dependency bumps.
- (+) All chosen **code** dependencies (MIT/Apache-2.0) are compatible with Hyakkei's MIT. This claim covers code only — the Digital Agency's *design reference assets* (theme color values, future map boundary data) are on a separate PDL 1.0 track; see ADR-0006. Re-derived color values carry no attribution burden (ADR-0006 §3).
- (−) React + ECharts + DuckDB-WASM is a heavy baseline bundle for the **editor**. Mitigation: per ADR-0005, the exported/viewed site never ships DuckDB-WASM at all — only the renderer + baked data. Measure the editor bundle in M0 and publish honest numbers.
- (−) ECharts theming is imperative config, not a design-token pipeline; the theme layer (ARCHITECTURE §5) owns the token→ECharts mapping in one place.
