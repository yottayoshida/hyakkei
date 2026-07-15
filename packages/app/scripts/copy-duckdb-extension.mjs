// PR-A2 prerequisite, surfaced by Phase 3 PoC: parquet support in
// DuckDB-WASM is NOT statically compiled into the core eh/mvp bundle —
// `LOAD parquet` (explicit or auto) fetches a separate
// `parquet.duckdb_extension.wasm` binary from `extensions.duckdb.org` the
// first time it runs, exactly like `httpfs` (ARCHITECTURE §6, ADR-0007).
// Under this project's shipped CSP (`connect-src 'self'`), that fetch is
// blocked — parquet, a first-class `Source.format` (packages/schema/src/
// dashboard.ts), would be completely non-functional without self-hosting
// this extension the same way copy-duckdb-vendor.mjs self-hosts the core
// worker/wasm bundle.
//
// Unlike that core-bundle copy (which copies files already inside the
// pnpm-lockfile-verified `@duckdb/duckdb-wasm` npm package -- no network
// call, no separate integrity concern), this extension is a genuinely
// different distribution channel: DuckDB's own extension CDN, entirely
// outside npm/pnpm's integrity chain. yotta chose (2026-07-15) build-time
// fetch + SHA-256 verification over committing the ~3MB binary to git:
// this keeps the same "gitignored, size-verified, skip-if-unchanged"
// shape as copy-duckdb-vendor.mjs, but a hash match is the actual
// integrity anchor here (a byte-count match alone is not a meaningful
// check for content arriving over the network from a non-lockfile-covered
// source) -- a hash MISMATCH throws and fails the build loudly rather
// than silently vendoring altered content.
//
// The exact version path (`v1.4.3`) is not a guess: it is the literal
// path DuckDB-WASM 1.32.0 requests at runtime, observed directly from the
// network request its own `LOAD parquet` call makes (verified empirically
// during PoC, both under `connect-src 'self'` -- where it correctly
// 403s -- and unrestricted, where the request succeeds). DuckDB's core
// *engine* version (this `v1.4.3`) is independent of the npm package's own
// version number (`@duckdb/duckdb-wasm@1.32.0`) -- same distinction
// `packages/schema/src/validate.ts`'s reserved-keyword-list comment
// already documents for the same underlying reason. Re-verify this path
// (and the pinned hashes below) on any `@duckdb/duckdb-wasm` version bump.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DUCKDB_ENGINE_VERSION = "v1.4.3";

// bundle -> { url, sha256 }. Both eh and mvp variants are vendored because
// `duckdb.selectBundle()` (packages/app/src/duckdb/factory.ts) picks
// whichever the browser supports -- WebKit has landed EH support only
// recently and M0 observed real per-engine variance, so neither variant
// can be assumed absent.
const EXTENSIONS = {
  eh: {
    url: `https://extensions.duckdb.org/${DUCKDB_ENGINE_VERSION}/wasm_eh/parquet.duckdb_extension.wasm`,
    sha256: "22765c8f7dc741cda2b571a66ac7bb355295d7d69a6c37e5315b265672984f55",
  },
  mvp: {
    url: `https://extensions.duckdb.org/${DUCKDB_ENGINE_VERSION}/wasm_mvp/parquet.duckdb_extension.wasm`,
    sha256: "0785c6c95d003eff4faa7b3b4b660f02c9c92f6d68d135ddf330d42e3a650600",
  },
};

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

const appRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

for (const [bundle, { url, sha256: expectedHash }] of Object.entries(EXTENSIONS)) {
  const destDir = join(
    appRoot,
    "public",
    "vendor",
    "extensions",
    DUCKDB_ENGINE_VERSION,
    `wasm_${bundle}`,
  );
  const dest = join(destDir, "parquet.duckdb_extension.wasm");
  mkdirSync(destDir, { recursive: true });

  if (existsSync(dest) && sha256(readFileSync(dest)) === expectedHash) {
    continue; // already vendored, content matches -- skip the network fetch
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `copy-duckdb-extension.mjs: fetch failed for ${bundle} bundle's parquet extension (${response.status} ${response.statusText}): ${url}`,
    );
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  const actualHash = sha256(bytes);
  if (actualHash !== expectedHash) {
    throw new Error(
      `copy-duckdb-extension.mjs: SHA-256 mismatch for ${bundle} bundle's parquet extension -- ` +
        `expected ${expectedHash}, got ${actualHash}. Refusing to vendor unverified content. ` +
        `If this is an intentional DuckDB engine version bump, update DUCKDB_ENGINE_VERSION and the pinned hash after independently verifying the new binary.`,
    );
  }
  writeFileSync(dest, bytes);
}
