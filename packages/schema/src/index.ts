// Published JSON Schemas + generated TS types for the authoring `dashboard.json`
// (ADR-0002) and the exported `BakedDashboard` (ADR-0005) — the project's
// stable public contract (ARCHITECTURE §3). See docs/adr/0005-precomputed-export.md
// and .claude/plans/2026-07-04-hyakkei-v0.1-pr-issue6-shapes.md for the shape
// analysis behind these definitions.
import { CURRENT_VERSION } from "./common.js";

// Alias, not a second literal: CURRENT_VERSION (common.ts) is the one source
// of truth for "1", also used by the `Version` schema and validate.ts's
// rejection check.
export const SCHEMA_PACKAGE_VERSION = CURRENT_VERSION;

export * from "./common.js";
export * from "./dashboard.js";
export * from "./baked.js";
export * from "./validate.js";
