import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Editor build config (ARCHITECTURE §5, ADR-0004, ADR-0010). index.html is
// the product's single entry as of issue #11a (ADR-0010: single-SPA
// integration) -- the former separate intake.html entry (D7's ingestion UI)
// is gone; `IntakeApp` is now embedded directly in `App.tsx`'s editor shell.
// Three build inputs remain: golden.html (the pixel-golden/narrow-viewport
// test harness, packages/app/src/GoldenHarness.tsx) imports `bake` and
// `@hyakkei/core/golden-fixtures`; register-harness.html (the real
// DuckDB-WASM round-trip e2e harness, D11) imports the full `@hyakkei/core`
// datasource surface (duckdb-wasm, exceljs) statically. index.html's own
// entry chunk must still never STATICALLY contain that datasource surface
// (ADR-0005's viewer-bundle boundary) -- unlike the old intake.html, it
// legitimately reaches it, but only through `data-layer.ts`'s dynamic
// `import()` boundary (issue #54 Stage A, extended to the editor entry by
// Stage B, bundle-isolation.test.ts). `manifest: true` emits
// `dist/.vite/manifest.json`, whose `dynamicImports` field is what Stage B
// verifies that lazy edge against -- a structured, module-source-path-keyed
// alternative to grepping minified chunk text (PoC-verified against this
// exact build, 2026-07-21: register-harness.html's STATIC imports and
// index.html's dynamicImports are separate manifest fields, so the two
// entries sharing a chunk via Rollup dedup cannot be conflated).
export default defineConfig({
  // A relative base keeps generated script/preload references valid when the
  // static app is published beneath a GitHub Pages repository subpath.
  base: "./",
  plugins: [react()],
  build: {
    manifest: true,
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        golden: fileURLToPath(new URL("./golden.html", import.meta.url)),
        registerHarness: fileURLToPath(new URL("./register-harness.html", import.meta.url)),
      },
    },
  },
});
