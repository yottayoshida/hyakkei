// Placeholder for the Renderer, query engine glue, guideline engine, and
// bake() (ARCHITECTURE §2/§9, ADR-0005). Real content lands in M1 (issues
// #8, #9) and M2 (#13). The DataSource layer (issue #7) is implemented in
// ./datasource — its interface/EgressPolicy (PR-A1) ship now; FileSource/
// UrlSource ingestion (PR-A2) depends on issue #8's real-WASM test basis.
import { SCHEMA_PACKAGE_VERSION } from "@hyakkei/schema";

export const CORE_PACKAGE_VERSION = SCHEMA_PACKAGE_VERSION;

export * from "./datasource/index.js";
