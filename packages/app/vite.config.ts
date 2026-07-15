import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Editor build config (ARCHITECTURE §5, ADR-0004). Real editor UI lands in M2 (#11-#16).
//
// Three build inputs, not one (PR-C /simplify Altitude finding, extended by
// PR-A2): golden.html (the pixel-golden/narrow-viewport test harness,
// packages/app/src/GoldenHarness.tsx) imports `bake` and
// `@hyakkei/core/golden-fixtures`, and register-harness.html (the real
// DuckDB-WASM round-trip e2e harness, D11) imports the full `@hyakkei/core`
// datasource surface (duckdb-wasm, exceljs) — neither of which index.html's
// real app must ever reach (ADR-0005's viewer-bundle boundary). Rollup's
// multi-entry build gives each HTML file its OWN dependency graph and
// output chunk, so this is a build-graph fact rather than something that
// merely happens to tree-shake away today.
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        golden: fileURLToPath(new URL("./golden.html", import.meta.url)),
        registerHarness: fileURLToPath(new URL("./register-harness.html", import.meta.url)),
      },
    },
  },
});
