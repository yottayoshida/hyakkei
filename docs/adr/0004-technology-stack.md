# ADR-0004: Technology stack for v0.1

- **Status**: Accepted (2026-07-04) — chart-library and Excel-parser rows are provisional pending the M0 spike; amend here if M0 overturns them
- **Deciders**: yotta

## Context

One maintainer, a product whose differentiators are (a) browser-complete execution and (b) Digital Agency design-system fidelity. Stack choices should maximize leverage from official MIT-licensed assets (design tokens, React example components, Tailwind theme plugin) and minimize exotic dependencies.

## Decision

| Layer | Choice | Rationale | Rejected alternatives |
|-------|--------|-----------|----------------------|
| Language | TypeScript | One language across schema/core/app/CLI; typed schema generation | — |
| UI framework | React 18 | The Digital Agency publishes React example components and a Tailwind theme plugin; adopting them directly is the whole point. Largest contributor pool | Vue/Svelte (smaller overlap with official assets); vanilla (editor complexity too high) |
| Charts | Apache ECharts | Covers every guidebook chart type incl. maps (v0.5); canvas performance; mature CJK label/wrap handling; Apache-2.0; huge ja-community knowledge base | Vega-Lite (elegant grammar, but theming to pixel-match the guidebook and CJK layout control are harder); Chart.js (missing chart types); D3-direct (maintenance cost) |
| Query engine | DuckDB-WASM | SQL over CSV/XLSX/Parquet entirely client-side; Parquet snapshots for export; the enabling tech for ADR-0001 | sql.js/SQLite-WASM (weaker file-format ingestion, no Parquet); Arquero/danfo (not SQL — SQL in dashboard.json is the developer escape hatch, ADR-0002); custom JS aggregation (reinventing a database, badly) |
| Excel parsing | SheetJS CE (provisional) | De-facto standard breadth of .xlsx quirks; Apache-2.0 | ExcelJS (MIT, cleaner API — M0 fidelity test on messy Japanese workbooks decides); DuckDB excel extension in WASM (availability unverified — check in M0) |
| Build | Vite | Boring default; WASM/worker support documented | — |
| Styling | Digital Agency design-tokens + tailwind-theme-plugin | Official, MIT, versioned upstream | Hand-copied token values (drift risk) |
| State | Zustand (or equally small) | The dashboard.json document IS the state; need undo/redo, not a framework | Redux (ceremony without benefit here) |
| Repo | pnpm monorepo: `schema` / `core` / `app` / `export` | `schema` and `core` publish to npm later for CLI/third parties without extraction surgery | Single package (would entangle editor with renderer, breaking the export/CLI reuse plan) |

## M0 escape hatches

- If ECharts cannot pixel-match guidebook samples or fails a11y needs → evaluate Vega-Lite before M1; amend this ADR.
- If DuckDB-WASM bundle/memory cost is unacceptable on the M0 test matrix → fall back to SQLite-WASM + custom CSV/XLSX ingestion, and drop Parquet snapshots (export embeds CSV instead). This weakens but does not break ADR-0001.
- If SheetJS CE fidelity disappoints on the Japanese-workbook corpus → ExcelJS.

## Consequences

- (+) Every styling asset tracks the official design system by construction; token upgrades are dependency bumps.
- (+) All chosen licenses (MIT/Apache-2.0) are compatible with Hyakkei's MIT.
- (−) React + ECharts + DuckDB-WASM is a heavy baseline bundle. Mitigation: editor and renderer split (exported sites carry renderer only); lazy-load DuckDB worker; measure in M0 and publish honest numbers.
- (−) ECharts theming is imperative config, not a design-token pipeline; the theme layer (ARCHITECTURE §5) owns the token→ECharts mapping in one place.
