// Placeholder for the Renderer, query engine glue, guideline engine, and
// bake() (ARCHITECTURE §2/§9, ADR-0005). Real content lands in M1 (issue #8)
// and M2 (#13). The DataSource layer (issue #7) is implemented in
// ./datasource — its interface/EgressPolicy (PR-A1) ship now; FileSource/
// UrlSource ingestion (PR-A2) depends on issue #8's real-WASM test basis.
// The theme layer (issue #9, PR-A) is implemented in ./theme. Subpath export
// separation (`@hyakkei/core/renderer` etc., keeping viewer bundles free of
// this package's duckdb-wasm/exceljs deps) is PR-B's task, not done here.
import { SCHEMA_PACKAGE_VERSION } from "@hyakkei/schema";

export const CORE_PACKAGE_VERSION = SCHEMA_PACKAGE_VERSION;

export * from "./datasource/index.js";
export * from "./theme/index.js";
