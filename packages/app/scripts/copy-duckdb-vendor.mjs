// PR-A1.5 containment wiring. Copies the 4 static assets DuckDB-WASM's
// MANUAL_BUNDLES self-host path needs (2 Worker scripts + 2 wasm binaries)
// from the already-pinned `@duckdb/duckdb-wasm` npm dependency into
// public/vendor/, so `vite build`/`vite dev` serve them same-origin instead
// of the package's own default (`getJsDelivrBundles()`, a third-party CDN
// load that would both defeat same-origin self-hosting and require
// widening `connect-src` past `'self'`).
//
// Not committed to git (.gitignore: packages/app/public/vendor/) — see that
// entry's comment. `@duckdb/duckdb-wasm`'s package.json publishes an exact
// subpath `exports` entry per file below (verified against the installed
// 1.32.0 package), so `import.meta.resolve` finds them the same way any
// other subpath import would, without needing to know pnpm's node_modules
// layout.
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// COI (multi-threaded) bundles are deliberately excluded: they require
// COOP/COEP response headers, which the `file://`/plain-static-hosting
// deployment targets this project supports can't provide (ADR-0005) —
// matching `spikes/lib/duckdb.mjs`'s MANUAL_BUNDLES, the reference
// implementation this copies from.
const VENDOR_FILES = [
  "duckdb-mvp.wasm",
  "duckdb-eh.wasm",
  "duckdb-browser-mvp.worker.js",
  "duckdb-browser-eh.worker.js",
];

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "vendor");
mkdirSync(outDir, { recursive: true });

for (const file of VENDOR_FILES) {
  const src = fileURLToPath(import.meta.resolve(`@duckdb/duckdb-wasm/dist/${file}`));
  copyFileSync(src, join(outDir, file));
}
