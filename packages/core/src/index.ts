// The full editor-side surface (ARCHITECTURE §2/§9). The DataSource layer
// (issue #7) is in ./datasource — FileSource/UrlSource ingestion (PR-A2)
// still pending, its interface/EgressPolicy (PR-A1) ship now. The theme
// layer (issue #9) is in ./theme. The Renderer + bake() (issue #8, PR-B) are
// in ./renderer and ./bake. Guideline engine lands in M2 (#13).
//
// A viewer must import `@hyakkei/core/renderer` (package.json `exports`),
// NOT this file: this barrel re-exports ./datasource, whose real dependency
// (duckdb-wasm) and ./bake's (exceljs, via datasource) have no reason to
// exist in a viewer bundle that only ever displays an already-baked
// artifact. `renderer/index.ts` is the deliberately narrower subset.
import { SCHEMA_PACKAGE_VERSION } from "@hyakkei/schema";

export const CORE_PACKAGE_VERSION = SCHEMA_PACKAGE_VERSION;

export * from "./bake/index.js";
export * from "./datasource/index.js";
export * from "./renderer/index.js";
export * from "./theme/index.js";
