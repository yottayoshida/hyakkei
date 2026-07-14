// The 4 static assets DuckDB-WASM's MANUAL_BUNDLES self-host path needs (2
// Worker scripts + 2 wasm binaries) — shared between copy-duckdb-vendor.mjs
// (which copies them) and src/csp-containment.test.ts (which asserts they
// landed in dist/vendor/), so the two can't silently drift apart if this
// set ever changes (e.g. a future COI bundle).
//
// COI (multi-threaded) bundles are deliberately excluded: they require
// COOP/COEP response headers, which the `file://`/plain-static-hosting
// deployment targets this project supports can't provide (ADR-0005) —
// matching `spikes/lib/duckdb.mjs`'s MANUAL_BUNDLES, the reference
// implementation this copies from.
export const VENDOR_FILES = [
  "duckdb-mvp.wasm",
  "duckdb-eh.wasm",
  "duckdb-browser-mvp.worker.js",
  "duckdb-browser-eh.worker.js",
];
