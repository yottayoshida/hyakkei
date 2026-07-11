// Subpath entry (`@hyakkei/core/renderer`, package.json `exports`): what a
// viewer needs to display a `BakedDashboard` and nothing else. Deliberately
// does NOT re-export ./datasource or ./bake -- both are editor/export-time-
// only surfaces (ADR-0005) whose runtime code (duckdb-wasm, exceljs) must
// never reach a viewer bundle. `renderer/bundle-isolation.test.ts`'s bundle
// assert exists specifically to catch a future accidental import from this
// file back into datasource/.
export * from "../theme/index.js";
export * from "./accessible-table.js";
export * from "./build-options.js";
export * from "./mount.js";
export * from "./render-model.js";
