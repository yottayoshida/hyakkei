// PR-A1.5 containment wiring. Copies the 4 static assets DuckDB-WASM's
// MANUAL_BUNDLES self-host path needs (duckdb-vendor-files.mjs) from the
// already-pinned `@duckdb/duckdb-wasm` npm dependency into public/vendor/,
// so `vite build`/`vite dev` serve them same-origin instead of the
// package's own default (`getJsDelivrBundles()`, a third-party CDN load
// that would both defeat same-origin self-hosting and require widening
// `connect-src` past `'self'`).
//
// Not committed to git (.gitignore: packages/app/public/vendor/) — see that
// entry's comment. `@duckdb/duckdb-wasm`'s package.json publishes an exact
// subpath `exports` entry per file below (verified against the installed
// 1.32.0 package), so `import.meta.resolve` finds them the same way any
// other subpath import would, without needing to know pnpm's node_modules
// layout.
import { copyFileSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { VENDOR_FILES } from "./duckdb-vendor-files.mjs";

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "vendor");
mkdirSync(outDir, { recursive: true });

for (const file of VENDOR_FILES) {
  const src = fileURLToPath(import.meta.resolve(`@duckdb/duckdb-wasm/dist/${file}`));
  const dest = join(outDir, file);
  // `/simplify` efficiency finding: this runs before every `dev`/`build`
  // invocation, and the 4 files total ~75MB — a pinned dependency's bytes
  // never change between runs, so skip the copy (a real, non-CoW-filesystem
  // I/O cost on CI) once the destination already matches the source size.
  // Size alone, not mtime: a `pnpm install` can touch node_modules file
  // mtimes without changing content, which would defeat an mtime check.
  let destSize = -1;
  try {
    destSize = statSync(dest).size;
  } catch {
    // dest doesn't exist yet — fall through to copy.
  }
  if (destSize !== statSync(src).size) copyFileSync(src, dest);
}
