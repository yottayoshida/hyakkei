// The full editor-side surface (ARCHITECTURE §2/§9). The DataSource layer
// (issue #7) is in ./datasource — FileSource/UrlSource ingestion (PR-A2)
// ships now. The theme layer (issue #9) is in ./theme. The Renderer + bake()
// (issue #8, PR-B) are in ./renderer and ./bake. Guideline engine lands in
// M2 (#13).
//
// A viewer must import `@hyakkei/core/renderer` (package.json `exports`),
// NOT this file: this barrel re-exports ./datasource, whose real dependency
// (duckdb-wasm) and ./bake's (exceljs, via datasource) have no reason to
// exist in a viewer bundle that only ever displays an already-baked
// artifact. Symmetrically, an ingestion-only consumer (PR-B's intake.html)
// must import `@hyakkei/core/datasource`, NOT this file: this barrel also
// re-exports ./renderer, whose real dependency (echarts) has no reason to
// exist in a bundle that only ever registers tables and never renders a
// chart (confirmed empirically — importing from this root barrel instead
// pulled ECharts' ~1.37MB chunk into intake.html's own modulepreload list
// for zero functional benefit). `renderer/index.ts` and `datasource/
// index.ts` are the deliberately narrower subsets.
import { SCHEMA_PACKAGE_VERSION } from "@hyakkei/schema";

export const CORE_PACKAGE_VERSION = SCHEMA_PACKAGE_VERSION;

export * from "./bake/index.js";
export * from "./datasource/index.js";
export * from "./renderer/index.js";
export * from "./theme/index.js";
